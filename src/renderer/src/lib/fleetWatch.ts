import { useEffect, useRef } from 'react'
import { components } from '@shared/api/schema'
import { TrayFleetSummary } from '@shared/ipc-types'
import { remoteServiceProbeForImage } from '@shared/remote-service'
import { primaryIpv4 } from './deeplinks'

type ServerResponse = components['schemas']['Server']

/** Below this much prepaid credit, and falling, the tray says so. */
const LOW_CREDIT_AUD = 20

interface FleetWatchInput {
  servers: ServerResponse[]
  /**
   * True once the list has been fetched from BinaryLane in this session — not
   * merely rehydrated from the local cache. Diffing against the cache would
   * announce every change that happened while the app was closed, which for a
   * box deliberately powered off days ago is not news.
   */
  isFetchedAfterMount: boolean
  inProgress: number
  /** Ids of actions paused on a question, from the account-wide watcher. */
  awaitingAnswerIds: number[]
  /** Ids of actions this app is tracking itself — those already notify on pause. */
  trackedIds: number[]
  failedInvoices: number
  accountName?: string
  availableCredit?: number
  /** Identifies the account so a profile switch resets the baselines. */
  profileId?: string
}

function describeStatus(status: string): string {
  switch (status) {
    case 'active':
      return 'running'
    case 'off':
      return 'off'
    case 'new':
      return 'being provisioned'
    case 'archive':
      return 'archived'
    default:
      return status
  }
}

/**
 * Keeps the tray in step with the fleet and raises native notifications on
 * changes the user would want to hear about while the window is hidden:
 * a server changing state, appearing, or disappearing, and prepaid credit
 * dropping below a floor.
 *
 * Runs in the renderer because that is where the data already is (the 15 s
 * server poll, tracked actions, the balance query). Main only renders.
 */
export function useFleetWatch(input: FleetWatchInput): void {
  const { servers, isFetchedAfterMount, inProgress, awaitingAnswerIds, trackedIds, failedInvoices, accountName, availableCredit, profileId } = input

  const lastPushed = useRef<string>('')
  const baseline = useRef<Map<number, { name: string; status: string }> | null>(null)
  const baselineProfile = useRef<string | undefined>(undefined)
  const creditWasAbove = useRef<boolean | null>(null)
  const seenAwaiting = useRef<Set<number> | null>(null)
  const failedInvoicesWas = useRef<number | null>(null)

  // Profile switch: forget every baseline so the new account is observed afresh.
  // Declared first on purpose — effects run in order, and the diffs below must
  // see the cleared refs in the same render, not one render later.
  useEffect(() => {
    creditWasAbove.current = null
    seenAwaiting.current = null
    failedInvoicesWas.current = null
  }, [profileId])

  // --- Tray summary
  useEffect(() => {
    const api = window.bldeskApi
    if (!api?.updateTray) return

    let running = 0
    let off = 0
    let other = 0
    for (const s of servers) {
      if (s.status === 'active') running++
      else if (s.status === 'off') off++
      else other++
    }
    const summary: TrayFleetSummary = {
      accountName,
      running,
      off,
      other,
      inProgress,
      awaitingAnswer: awaitingAnswerIds.length,
      failedInvoices,
      availableCredit,
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        ip: primaryIpv4(s),
        remoteService: remoteServiceProbeForImage(s.image).kind
      }))
    }
    const key = JSON.stringify(summary)
    if (key === lastPushed.current) return
    lastPushed.current = key
    api.updateTray(summary).catch(() => {})
  }, [servers, inProgress, awaitingAnswerIds, failedInvoices, accountName, availableCredit])

  // --- Actions paused on a question that were started elsewhere (mPanel, another
  // machine). Ones started here already notify from the tracker, so skip those.
  useEffect(() => {
    const now = new Set(awaitingAnswerIds)
    const prev = seenAwaiting.current
    seenAwaiting.current = now
    if (!prev) return // first observation is the baseline
    const tracked = new Set(trackedIds)
    const fresh = awaitingAnswerIds.filter((id) => !prev.has(id) && !tracked.has(id))
    if (fresh.length === 0) return
    window.bldeskApi?.sendNotification?.({
      title: fresh.length === 1 ? 'An action needs your answer' : `${fresh.length} actions need your answer`,
      body: `BinaryLane paused ${fresh.length === 1 ? 'it' : 'them'} with a question. Open BLDesk to respond.`,
      kind: 'action'
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingAnswerIds])

  // --- Failed payments: say so when the count rises, once per rise.
  useEffect(() => {
    const was = failedInvoicesWas.current
    failedInvoicesWas.current = failedInvoices
    if (was === null || failedInvoices <= was) return
    window.bldeskApi?.sendNotification?.({
      title: failedInvoices === 1 ? 'An invoice payment failed' : `${failedInvoices} invoice payments failed`,
      body: `Check Billing on ${accountName ?? 'this account'} before services are affected.`,
      kind: 'balance'
    }).catch(() => {})
  }, [failedInvoices, accountName])

  // --- Server state changes
  useEffect(() => {
    if (!isFetchedAfterMount) return

    // New account → new baseline, silently.
    if (baselineProfile.current !== profileId) {
      baselineProfile.current = profileId
      baseline.current = null
    }

    const now = new Map(servers.map((s) => [s.id, { name: s.name, status: s.status as string }]))
    const prev = baseline.current
    baseline.current = now
    if (!prev) return

    const notify = (title: string, body: string) =>
      window.bldeskApi?.sendNotification?.({ title, body, kind: 'server-state' }).catch(() => {})

    for (const [id, cur] of now) {
      const was = prev.get(id)
      if (!was) {
        notify(`${cur.name} appeared`, `New server on ${accountName ?? 'this account'} — ${describeStatus(cur.status)}.`)
      } else if (was.status !== cur.status) {
        notify(`${cur.name} is now ${describeStatus(cur.status)}`, `Was ${describeStatus(was.status)}.`)
      }
    }
    for (const [id, was] of prev) {
      if (!now.has(id)) notify(`${was.name} is gone`, `No longer listed on ${accountName ?? 'this account'}.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, isFetchedAfterMount, profileId])

  // --- Low credit: only on the way down, so postpaid accounts (credit always 0)
  // and accounts that are simply low never get nagged every launch.
  useEffect(() => {
    if (typeof availableCredit !== 'number') return
    const above = availableCredit >= LOW_CREDIT_AUD
    const was = creditWasAbove.current
    creditWasAbove.current = above
    if (was === true && !above) {
      window.bldeskApi?.sendNotification?.({
        title: 'Prepaid credit is running low',
        body: `$${availableCredit.toFixed(2)} AUD available on ${accountName ?? 'this account'}.`,
        kind: 'balance'
      }).catch(() => {})
    }
  }, [availableCredit, accountName])
}
