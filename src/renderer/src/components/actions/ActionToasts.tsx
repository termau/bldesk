import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Receipt, X } from 'lucide-react'
import { TrackedAction, TrackedActionState, useTrackedActions } from '../../context/ActionTrackerContext'
import { RESTART_TOAST, restartsServer } from '../../lib/actionLabels'
import { FailureToastItems, useFailures } from './FailureToasts'

/**
 * Toast host for actions being tracked to completion, and for failures reported
 * with `notifyFailure` (`FailureToasts`). Deliberately in-house: the app carries
 * no toast dependency, and this needs only four states.
 *
 * Mounted at the app shell so a tracked action outlives the view that started
 * it — the point of tracking is that you can navigate away from a rebuild.
 */

const TONE: Record<TrackedActionState, { icon: typeof Loader2; className: string; spin?: boolean }> = {
  running: { icon: Loader2, className: 'text-[#017cb6]', spin: true },
  completed: { icon: CheckCircle2, className: 'text-emerald-500' },
  errored: { icon: AlertTriangle, className: 'text-red-500' },
  'awaiting-interaction': { icon: HelpCircle, className: 'text-[#f1ca00]' },
  'blocked-by-invoice': { icon: Receipt, className: 'text-[#f1ca00]' },
  lost: { icon: AlertTriangle, className: 'text-amber-500' }
}

function statusLine(action: TrackedAction): string {
  switch (action.state) {
    case 'running':
      // The server goes down for part of these, and nothing else on screen says so: its status stays active.
      if (restartsServer(action.actionType)) return RESTART_TOAST
      return typeof action.percentComplete === 'number' && action.percentComplete > 0
        ? `In progress — ${action.percentComplete}%`
        : 'In progress on BinaryLane…'
    case 'completed':
      return action.detail || 'Completed'
    case 'errored':
      return action.detail || 'BinaryLane reported an error'
    case 'awaiting-interaction':
      return 'Waiting for your answer — see the prompt'
    case 'blocked-by-invoice':
      // Says what BinaryLane reports and no more: the spec states only that the
      // action is blocked by an invoice requiring payment. Whether paying it
      // resumes this action is not something to promise on its behalf.
      return action.detail || 'Blocked by an invoice that requires payment'
    case 'lost':
      // Careful wording: losing track of an action says nothing about whether
      // it applied. Claiming either way here would be a guess.
      return action.detail || 'Lost track of this action — check the server before retrying'
  }
}

export function ActionToasts() {
  const { tracked: all, dismiss } = useTrackedActions()
  const tracked = all.filter((a) => !a.dismissed)
  const failures = useFailures()
  if (tracked.length === 0 && failures.length === 0) return null

  return (
    /*
     * Above the mobile navigation bar, not behind it.
     *
     * `BottomNav` is `md:hidden fixed bottom-0` and stands
     * `3.5rem + env(safe-area-inset-bottom)` tall, so a toast at `bottom-4`
     * sat underneath it and, on a phone with gesture navigation, ran off the
     * bottom of the screen as well - the close button with it. The offset
     * matches the bar's own height expression so the two cannot drift apart,
     * and it applies only where the bar exists.
     *
     * Below the dialogs (`Modal` is 70, and 80 when nested), so the column never
     * covers a dialog's buttons. A failure raised while a dialog is open shows
     * inside that dialog (`DialogFailures`), not here. The column sits at the
     * bottom right, where it covers the page's own controls least: the header
     * actions at the top right are what people reach for next.
     */
    <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)] md:bottom-4 right-4 z-[55] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      <FailureToastItems />
      {tracked.map((action) => {
        const tone = TONE[action.state]
        const Icon = tone.icon
        return (
          <div
            key={action.actionId}
            className="pointer-events-auto bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-2xl p-3 text-xs flex items-start gap-2.5 animate-in slide-in-from-bottom-2 fade-in duration-150"
          >
            <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${tone.className} ${tone.spin ? 'animate-spin' : ''}`} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[#212529] dark:text-white truncate">
                {action.label}
                {action.resourceName && (
                  <span className="font-normal text-[#495057] dark:text-[#adb5bd]"> · {action.resourceName}</span>
                )}
              </div>
              <div className="text-[11px] text-[#495057] dark:text-[#adb5bd] break-words">{statusLine(action)}</div>
              {action.state === 'running' && (action.stepDetail || (restartsServer(action.actionType) && action.step)) && (
                <div className="text-[11px] text-[#6c757d] dark:text-[#8b9299] break-words mt-0.5">
                  {action.stepDetail || action.step}
                </div>
              )}
            </div>
            <button
              onClick={() => dismiss(action.actionId)}
              aria-label={`Dismiss ${action.label} notification`}
              className="p-0.5 text-[#6c757d] hover:text-[#212529] dark:hover:text-white rounded flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
