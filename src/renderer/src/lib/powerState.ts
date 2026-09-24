import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../api/client'
import { describeApiError, pollActionToSettled } from '../api/queries'

type ServerResponse = components['schemas']['Server']

/**
 * Power state, inferred client-side.
 *
 * `Server.status` on the BinaryLane API does not track power: a server that
 * has been powered off — by `power_off`, or far more commonly by `sudo
 * poweroff` inside the guest — keeps reporting `active`.
 *
 * What the API does publish is a five-minute performance sample per server,
 * produced host-side only while the VM runs. A running server's latest
 * sample period is always the current or previous bucket; a stopped server's
 * simply stops advancing. So "latest period ended more than STALE_AFTER_MS
 * ago" is a read-only, guest-independent way to know a server is off, at the
 * cost of a few minutes' latency. It catches the guest-initiated case the
 * platform itself cannot see.
 *
 * For the seconds after a power action, when a few minutes is too long, one
 * `is_running` diagnostic gives a hypervisor-level answer: it completes on a
 * running VM and errors on a stopped one. One per user action is acceptable;
 * polling it across a fleet would litter the action log, and `ping` depends on
 * the guest's firewall, so neither is used as the sweep.
 */

export type PowerState = 'on' | 'off' | 'unknown'

/** Latest bucket is five minutes and publishes shortly after it closes; three buckets is comfortably past that. */
export const STALE_AFTER_MS = 15 * 60 * 1000
/** How often the fleet sweep re-reads every server's latest sample. */
export const SWEEP_INTERVAL_MS = 2 * 60 * 1000
/** Concurrent sample reads during a sweep — gentle on the API, still quick for a few dozen servers. */
const SWEEP_CONCURRENCY = 4
/** An `is_running` verdict outranks the sweep for this long, then the sweep takes over again. */
const OVERRIDE_TTL_MS = 20 * 60 * 1000
/** Let the hypervisor finish before asking whether the VM is up. */
const CONFIRM_DELAY_MS = 8_000

export interface PowerObservation {
  state: PowerState
  /** Where the verdict came from, for a tooltip. */
  source: 'sample' | 'diagnostic' | 'api'
  /** End of the latest sample period, when known. */
  lastSampleEnd?: string
  observedAt: number
}

/** Pure: classify a latest-sample period end against now. */
export function inferFromSample(periodEnd: string | null | undefined, now: number): PowerState {
  if (!periodEnd) return 'unknown'
  const end = Date.parse(periodEnd)
  if (Number.isNaN(end)) return 'unknown'
  return now - end > STALE_AFTER_MS ? 'off' : 'on'
}

/**
 * Pure: the status a view should show. API `new`/`archive` are trusted (the
 * platform does set those); for `active`/`off` the inferred power state wins
 * when there is one.
 */
export function effectiveStatus(apiStatus: ServerResponse['status'], inferred: PowerState | undefined): ServerResponse['status'] {
  if (apiStatus === 'new' || apiStatus === 'archive') return apiStatus
  if (inferred === 'off') return 'off'
  if (inferred === 'on') return 'active'
  return apiStatus
}

/** The fields this module adds to a server object handed to views. */
export interface PowerAnnotations {
  /** What the API said before the inference was applied. */
  _apiStatus: ServerResponse['status']
  _power?: PowerObservation
}

export type AnnotatedServer = ServerResponse & PowerAnnotations

export function annotateServers(servers: ServerResponse[], observations: Map<number, PowerObservation>): AnnotatedServer[] {
  return servers.map((s) => {
    const obs = observations.get(s.id)
    return { ...s, _apiStatus: s.status, _power: obs, status: effectiveStatus(s.status, obs?.state) }
  })
}

/** Run `fn` over `items` with at most `limit` in flight. Failures are per-item. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

interface UsePowerStateResult {
  observations: Map<number, PowerObservation>
  /**
   * After a power action settles, ask the hypervisor once and record the
   * answer. Resolves to the verdict so the caller can word its report.
   */
  confirmPowerState: (serverId: number) => Promise<PowerState>
}

export function usePowerState(client: BinaryLaneClient | null, servers: ServerResponse[], profileId?: string): UsePowerStateResult {
  const [sampleObs, setSampleObs] = useState<Map<number, PowerObservation>>(new Map())
  const [overrides, setOverrides] = useState<Map<number, PowerObservation>>(new Map())
  const sweeping = useRef(false)
  const serverIds = useMemo(() => servers.map((s) => s.id), [servers])
  const idsKey = serverIds.join(',')

  // Forget everything on a profile switch; the ids mean nothing on another account.
  useEffect(() => {
    setSampleObs(new Map())
    setOverrides(new Map())
  }, [profileId])

  // --- The sweep
  useEffect(() => {
    if (!client || serverIds.length === 0) return
    let cancelled = false

    const sweep = async () => {
      if (sweeping.current) return
      sweeping.current = true
      try {
        const now = Date.now()
        const results = await mapLimit(serverIds, SWEEP_CONCURRENCY, async (id) => {
          try {
            const { data, error } = await client.GET('/v2/samplesets/{server_id}/latest', {
              params: { path: { server_id: id } },
              signal: AbortSignal.timeout(15_000)
            })
            if (error) return null
            const end = data?.sample_set?.period?.end ?? null
            return { id, obs: { state: inferFromSample(end, now), source: 'sample', lastSampleEnd: end ?? undefined, observedAt: now } as PowerObservation }
          } catch {
            return null
          }
        })
        if (cancelled) return
        setSampleObs((prev) => {
          const next = new Map(prev)
          for (const r of results) if (r) next.set(r.id, r.obs)
          // Drop servers that are gone.
          for (const id of next.keys()) if (!serverIds.includes(id)) next.delete(id)
          return next
        })
      } finally {
        sweeping.current = false
      }
    }

    void sweep()
    const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, idsKey])

  // --- One diagnostic after a power action
  const confirmPowerState = useCallback(
    async (serverId: number): Promise<PowerState> => {
      if (!client) return 'unknown'
      await new Promise((r) => setTimeout(r, CONFIRM_DELAY_MS))
      let state: PowerState = 'unknown'
      try {
        const submitted = await client.POST('/v2/servers/{server_id}/actions', {
          params: { path: { server_id: serverId } },
          body: { type: 'is_running' } as never,
          signal: AbortSignal.timeout(15_000)
        })
        if (submitted.error) throw new Error(describeApiError(submitted.error))
        const queued = submitted.data?.action
        if (!queued?.id) throw new Error('no action returned')
        const settled = await pollActionToSettled(client, queued.id, { initial: queued, timeoutMs: 30_000, intervalMs: 1000 })
        // Measured: completes (result_data null) on a running VM, errors (no message) on a stopped one.
        if (settled.state === 'completed') state = 'on'
        else if (settled.state === 'errored') state = 'off'
      } catch (err) {
        console.warn('[PowerState] is_running check failed:', err)
      }
      if (state !== 'unknown') {
        const obs: PowerObservation = { state, source: 'diagnostic', observedAt: Date.now() }
        setOverrides((prev) => new Map(prev).set(serverId, obs))
      }
      return state
    },
    [client]
  )

  // --- Merge: a fresh diagnostic outranks the sweep; an old one yields to it.
  const observations = useMemo(() => {
    const merged = new Map(sampleObs)
    const now = Date.now()
    for (const [id, o] of overrides) {
      if (now - o.observedAt > OVERRIDE_TTL_MS) continue
      const sample = sampleObs.get(id)
      // Once the sweep has a sample newer than the diagnostic, the sweep is the
      // better witness (it will have seen the VM start or stop producing data).
      if (sample?.lastSampleEnd && Date.parse(sample.lastSampleEnd) > o.observedAt) continue
      merged.set(id, o)
    }
    return merged
  }, [sampleObs, overrides])

  return { observations, confirmPowerState }
}
