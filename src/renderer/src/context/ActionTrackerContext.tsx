import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../api/client'
import { describeActionFailure, pollActionToSettled } from '../api/queries'
import { getChangeLogProfile, getChangeProfile, updateChange } from '../lib/changelog'
import { clearFailures } from '../lib/failures'

type ServerAction = components['schemas']['Action']

export type TrackedActionState =
  | 'running'
  | 'completed'
  | 'errored'
  | 'awaiting-interaction'
  | 'blocked-by-invoice'
  | 'lost'

export interface TrackedAction {
  actionId: number
  /** What the user asked for, in their words: "Rebuild Server OS". */
  label: string
  /** Which machine, when we know it. */
  resourceName?: string
  /** The server the action runs on and what it does, so a screen can tell that its own change is still being applied. */
  resourceId?: number
  actionType?: string
  state: TrackedActionState
  /** Populated once settled, for the failure case. */
  detail?: string
  percentComplete?: number
  /**
   * BinaryLane's own description of the current step, e.g. "Backup of SYSTEM:
   * 38.5GB of 40.0 GB (310MB/s) - less than 1 minute remaining". Preferred over
   * `current_step`, which is only ever the bare step name.
   */
  stepDetail?: string
  /**
   * BinaryLane's name for the step it is on ("Shutting down server"), the last one it reported. For some actions it is
   * all there is to say, because they report no `stepDetail`.
   */
  step?: string
  startedAt: number
  /**
   * The person closed the toast while the action was still being worked on. It is still followed, out of sight, so a
   * screen can tell its change is not finished; a failure shows the toast again.
   */
  dismissed?: boolean
}

interface ActionTrackerValue {
  tracked: TrackedAction[]
  /**
   * Register a submitted action so its real outcome gets reported. Pass the
   * change-log id from `confirm()` and the log's outcome follows the action.
   * Another History id for an existing watch joins that action and its result.
   */
  track: (action: ServerAction, label: string, resourceName?: string, changeId?: string) => void
  dismiss: (actionId: number) => void
}

const ActionTrackerContext = createContext<ActionTrackerValue | null>(null)

/**
 * Background tracking cadence. Deliberately not the blocking mutation's 2s: a
 * region migration or rebuild runs for minutes, and 2s would mean hundreds of
 * requests for one operation. Attentive early, then easing off.
 */
function backgroundInterval(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 3000
  if (elapsedMs < 120_000) return 8000
  return 15_000
}

/** Completed toasts clear themselves; failures stay until acknowledged. */
const COMPLETED_TOAST_TTL_MS = 8000

/** Server actions whose whole point is a power-state change. */
const POWER_ACTION_TYPES = new Set(['power_on', 'power_off', 'shutdown', 'reboot', 'power_cycle'])
/** What History says about an action BLDesk stopped following because the account (or its token) it was started under is no longer the one in use. */
const TRACKING_STOPPED_DETAIL = 'BLDesk stopped following this action when the account or its token changed. Its result is on BinaryLane: check the account\'s actions there.'

interface FollowedAction {
  controller: AbortController
  entries: { changeId: string; profileId: string }[]
  result: Parameters<typeof updateChange>[1]
}

function updateHistory(watch: FollowedAction, patch: Parameters<typeof updateChange>[1]): void {
  watch.result = { ...watch.result, ...patch }
  for (const { changeId, profileId } of watch.entries) void updateChange(changeId, patch, profileId)
}

export function ActionTrackerProvider({
  client,
  confirmPowerState,
  children
}: {
  client: BinaryLaneClient | null
  /**
   * Ask the hypervisor whether a server is up, once, after a power action
   * settles. The API's `status` field will not tell us.
   */
  confirmPowerState?: (serverId: number) => Promise<'on' | 'off' | 'unknown'>
  children: React.ReactNode
}) {
  const [tracked, setTracked] = useState<TrackedAction[]>([])
  const queryClient = useQueryClient()
  /**
   * One watch can own several confirmed History entries. Keep its settled result until the toast is dismissed so a
   * caller arriving just after settlement can join without starting another poll. Each client owns its own watches;
   * a callback retained by the previous account must never join a new account's action with the same id.
   */
  const scope = useMemo(() => ({ watches: new Map<number, FollowedAction>(), active: true }), [client])
  const currentScope = useRef(scope)
  useLayoutEffect(() => { currentScope.current = scope }, [scope])

  const update = useCallback((actionId: number, patch: Partial<TrackedAction>) => {
    setTracked((prev) => prev.map((t) => (t.actionId === actionId ? { ...t, ...patch } : t)))
  }, [])

  /** One auto-dismiss timer per completed action; see the effect below for why. */
  const dismissTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const trackedRef = useRef<TrackedAction[]>([])
  trackedRef.current = tracked

  const dismiss = useCallback((actionId: number) => {
    const entry = trackedRef.current.find((t) => t.actionId === actionId)
    // An action still being worked on keeps being followed: stopping would lose the one record that says a change is
    // still being applied, and the list on screen would be edited as if it had landed.
    if (entry && (entry.state === 'running' || entry.state === 'awaiting-interaction' || entry.state === 'blocked-by-invoice')) {
      setTracked((prev) => prev.map((t) => (t.actionId === actionId ? { ...t, dismissed: true } : t)))
      return
    }
    scope.watches.get(actionId)?.controller.abort()
    scope.watches.delete(actionId)
    const timer = dismissTimers.current.get(actionId)
    if (timer) {
      clearTimeout(timer)
      dismissTimers.current.delete(actionId)
    }
    setTracked((prev) => prev.filter((t) => t.actionId !== actionId))
  }, [scope])

  const track = useCallback(
    (action: ServerAction, label: string, resourceName?: string, changeId?: string) => {
      if (!client || !action?.id) return
      // The account the change was recorded in, which is not the active one if it was switched since the confirmation.
      const profileId = getChangeProfile(changeId) ?? getChangeLogProfile()
      const existing = scope.watches.get(action.id)
      const stopped = !scope.active || currentScope.current !== scope
      const watch: FollowedAction = existing ?? {
        controller: new AbortController(),
        entries: [],
        result: stopped
          ? { actionId: action.id, outcome: 'lost', detail: TRACKING_STOPPED_DETAIL }
          : { actionId: action.id }
      }
      if (changeId && profileId && !watch.entries.some(entry => entry.changeId === changeId && entry.profileId === profileId)) {
        watch.entries.push({ changeId, profileId })
        void updateChange(changeId, watch.result, profileId)
      }
      if (existing || stopped) return
      scope.watches.set(action.id, watch)
      const { controller } = watch

      setTracked((prev) => [
        ...prev.filter((t) => t.actionId !== action.id),
        {
          actionId: action.id,
          label,
          resourceName,
          resourceId: action.resource_id ?? undefined,
          actionType: action.type,
          state: 'running',
          percentComplete: action.progress?.percent_complete,
          startedAt: Date.now()
        }
      ])

      const trackingStartedAt = Date.now()

      void (async () => {
        try {
          const pollOptions = {
            // No deadline: this is the long-operation path. A rebuild that takes
            // twenty minutes should say "still going", never "timed out".
            timeoutMs: null,
            // Measured from when tracking began, not from each call below, so a
            // resumed watch does not drop back to the 3s opening cadence.
            intervalMs: () => backgroundInterval(Date.now() - trackingStartedAt),
            signal: controller.signal,
            onProgress: (fresh: ServerAction) => {
              if (controller.signal.aborted || currentScope.current !== scope) return
              update(action.id, {
                percentComplete: fresh.progress?.percent_complete,
                stepDetail: fresh.progress?.current_step_detail ?? undefined,
                // Empty between two steps, so the last one named stays.
                ...(fresh.progress?.current_step ? { step: fresh.progress.current_step } : {})
              })
            }
          }

          let settled = await pollActionToSettled(client, action.id, { ...pollOptions, initial: action })

          // `awaiting-interaction` settles the poll — the blocking mutation needs
          // that, so it can release the UI lock instead of burning its timeout on
          // a question no amount of waiting will answer. Background tracking
          // wants the opposite: keep watching, because the operator is about to
          // answer and the action will carry on. Without this the toast would
          // sit on "waiting for your answer" forever, still pointing at a prompt
          // that vanished the moment the answer was accepted.
          let promptRequested = false
          while (
            (settled.state === 'awaiting-interaction' || settled.state === 'blocked-by-invoice') &&
            !controller.signal.aborted
          ) {
            if (settled.state === 'awaiting-interaction') {
              update(action.id, { state: 'awaiting-interaction' })
              if (!promptRequested) {
                promptRequested = true
                void window.bldeskApi?.sendNotification?.({
                  title: `${resourceName ? `${label} · ${resourceName}` : label} needs an answer`,
                  body: 'BinaryLane paused this action with a question. Open BLDesk to respond.',
                  kind: 'action'
                })
                // The toast tells the user to see the prompt, but the account-wide
                // watch that renders it polls on its own 20s cycle. Pull it forward
                // so the two never disagree about whether there is a question.
                void queryClient.invalidateQueries({ queryKey: ['actions-awaiting-interaction'] })
              }
            } else {
              update(action.id, {
                state: 'blocked-by-invoice',
                detail: `Blocked by invoice #${settled.action.blocking_invoice_id}, which requires payment.`
              })
            }
            // No `initial`: pass the stale stalled action back in and it would
            // classify the same way again without ever asking BinaryLane.
            settled = await pollActionToSettled(client, action.id, pollOptions)
          }

          if (controller.signal.aborted || currentScope.current !== scope) return

          // The toast is only useful while the window is visible; the native
          // notification is what reaches someone who closed it to the tray.
          const subject = resourceName ? `${label} · ${resourceName}` : label
          if (settled.state === 'completed') {
            // A completed `shutdown` means the ACPI signal was delivered, not
            // that the guest obeyed it — BinaryLane reports the action done
            // within seconds either way, and the server stays `active` until
            // the OS actually halts. Say so, or "Completed" reads as "it's off".
            const signalOnly = settled.action.type === 'shutdown'
            const detail = signalOnly
              ? 'Shutdown signal sent. The server shows as off once its OS halts; if it stays running, the OS ignored the signal — use Power off for a hard stop.'
              : undefined
            update(action.id, { state: 'completed', percentComplete: 100, detail })
            updateHistory(watch, { outcome: 'completed', detail })
            void window.bldeskApi?.sendNotification?.({
              title: signalOnly ? `${subject}: signal sent` : `${subject} completed`,
              body: signalOnly ? 'Waiting for the OS to halt — you will be told when it is off.' : 'Finished on BinaryLane.',
              kind: 'action'
            })

            // The action is done; whether the server is now in the state the
            // user wanted is a separate question the API cannot answer. Ask
            // the hypervisor once and put the verdict on the toast.
            const type = settled.action.type
            const resourceId = settled.action.resource_id
            if (confirmPowerState && resourceId && POWER_ACTION_TYPES.has(type)) {
              void confirmPowerState(resourceId).then((verdict) => {
                if (controller.signal.aborted || currentScope.current !== scope || verdict === 'unknown') return
                const wantedOff = type === 'power_off' || type === 'shutdown'
                const asExpected = wantedOff ? verdict === 'off' : verdict === 'on'
                const line = verdict === 'off' ? 'Server is off.' : 'Server is running.'
                updateHistory(watch, { detail: asExpected ? line : `${line} Not the expected state.` })
                update(action.id, {
                  detail: asExpected
                    ? line
                    : type === 'shutdown'
                      ? 'Server is still running — the OS ignored the shutdown signal. Use Power off for a hard stop.'
                      : `${line} That is not what "${label}" should have left it in — check the server.`
                })
                if (!asExpected) {
                  void window.bldeskApi?.sendNotification?.({
                    title: `${subject}: ${verdict === 'off' ? 'server is off' : 'server is still running'}`,
                    body: type === 'shutdown' ? 'The OS ignored the shutdown signal. Use Power off for a hard stop.' : 'Not the state this action should have left it in.',
                    kind: 'action'
                  })
                }
              })
            }
          } else if (settled.state === 'errored') {
            const detail = describeActionFailure(settled.action) ?? undefined
            update(action.id, { state: 'errored', detail, dismissed: false })
            updateHistory(watch, { outcome: 'errored', detail })
            void window.bldeskApi?.sendNotification?.({ title: `${subject} failed`, body: detail || 'BinaryLane reported an error.', kind: 'action' })
          } else {
            update(action.id, { state: 'running' })
          }

          // Whatever happened, the cached view of the account is now stale.
          void queryClient.invalidateQueries({ queryKey: ['servers'] })
          if (settled.action?.resource_id) {
            const resourceId = settled.action.resource_id
            void queryClient.invalidateQueries({ queryKey: ['server', resourceId] })
            // Backups are cached under their own key, so a completed
            // take_backup or restore would otherwise leave the list showing
            // what it held before the action ran.
            void queryClient.invalidateQueries({ queryKey: ['serverBackups', resourceId] })
            // Likewise the licences a resize's `change_licenses` just altered.
            void queryClient.invalidateQueries({ queryKey: ['server-software', resourceId] })
            // A firewall write is applied when the action completes, not when it is queued, so a read made at queue time
            // still shows the old list. Read it again now, or the next edit is built from that list and writes it back.
            if (settled.action.type === 'change_advanced_firewall_rules') {
              void queryClient.invalidateQueries({ queryKey: ['firewallRules', resourceId] })
              void queryClient.invalidateQueries({ queryKey: ['fleet-firewalls'] })
            }
          }
        } catch (err) {
          if (controller.signal.aborted) return
          update(action.id, {
            state: 'lost',
            detail: err instanceof Error ? err.message : String(err),
            dismissed: false
          })
          // Whether a firewall write landed is not known now, so the lists are read again rather than trusted.
          if (action.type === 'change_advanced_firewall_rules' && action.resource_id) {
            void queryClient.invalidateQueries({ queryKey: ['firewallRules', action.resource_id] })
            void queryClient.invalidateQueries({ queryKey: ['fleet-firewalls'] })
          }
          updateHistory(watch, { outcome: 'lost', detail: err instanceof Error ? err.message : String(err) })
        }
      })()
    },
    [client, scope, queryClient, update, confirmPowerState]
  )

  /**
   * Auto-clear successes only — an error nobody saw is worse than a stale toast.
   *
   * Scheduled once per action and deliberately NOT torn down on re-render. A
   * naive `return () => timers.forEach(clearTimeout)` here looks correct but
   * never fires while any other action is still polling: each progress update
   * makes a new `tracked` array, which would clear and restart this timer every
   * few seconds. Successes would then sit on screen indefinitely, which is the
   * opposite of the intent.
   */
  useEffect(() => {
    for (const action of tracked) {
      if (action.state !== 'completed') continue
      const watch = scope.watches.get(action.actionId)
      if (watch?.result.outcome !== 'completed') continue
      if (dismissTimers.current.has(action.actionId)) continue
      const timer = setTimeout(() => {
        // These checks deliberately overlap: scope activity covers teardown, watch identity covers retirement or
        // replacement of this action, and timer identity covers cancellation or rescheduling of this callback.
        // Keep the queued callback tied to all three owners, even where one check currently implies another.
        if (!scope.active || scope.watches.get(action.actionId) !== watch || dismissTimers.current.get(action.actionId) !== timer) return
        dismissTimers.current.delete(action.actionId)
        dismiss(action.actionId)
      }, COMPLETED_TOAST_TTL_MS)
      dismissTimers.current.set(action.actionId, timer)
    }
  }, [tracked, dismiss, scope])

  useEffect(() => {
    const timers = dismissTimers.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  // Switching profile (or unmounting) must not leave polls running against the old token.
  useEffect(() => {
    scope.active = true
    return () => {
      scope.active = false
      // Their History entries would otherwise stay at "submitted" for ever: nothing follows them now.
      scope.watches.forEach(watch => {
        watch.controller.abort()
        if (!watch.result.outcome) updateHistory(watch, { outcome: 'lost', detail: TRACKING_STOPPED_DETAIL })
      })
      dismissTimers.current.forEach(clearTimeout)
      dismissTimers.current.clear()
      // The polls are gone, so their entries must go too: one left as "running" would never be updated again.
      setTracked([])
      // A failure shown for one account must not sit over another's screens with nothing to say which it was.
      clearFailures()
    }
  }, [scope])

  const value = useMemo<ActionTrackerValue>(() => ({ tracked, track, dismiss }), [tracked, track, dismiss])

  return <ActionTrackerContext.Provider value={value}>{children}</ActionTrackerContext.Provider>
}

/**
 * Register long-running actions so the UI reports what actually happened.
 * Returns a no-op tracker outside the provider so a component can call it
 * without needing to know whether it is mounted inside one.
 */
export function useTrackedActions(): ActionTrackerValue {
  const ctx = useContext(ActionTrackerContext)
  return ctx ?? { tracked: [], track: () => {}, dismiss: () => {} }
}
