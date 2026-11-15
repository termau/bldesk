import { useSyncExternalStore } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { dismissFailure, getDialogFailures, getFloatingFailures, subscribeFailures, type Failure } from '../../lib/failures'

/** The failures for the corner of the window: those raised with no dialog open (see `lib/failures.ts`). */
export function useFailures() {
  return useSyncExternalStore(subscribeFailures, getFloatingFailures, getFloatingFailures)
}

/** One failure: what failed, why, any guidance and command, and a button to close it. The text can be selected: the reason is what someone pastes into a support request. */
function FailureCard({ failure: f, inline }: { failure: Failure; inline?: boolean }) {
  return (
    <div
      role="alert"
      className={`pointer-events-auto bg-white dark:bg-[#2b3035] border border-rose-300 dark:border-rose-900 rounded-lg text-xs flex items-start gap-2.5 animate-in fade-in duration-150 ${inline ? 'p-3 [@media(max-height:560px)]:p-2' : 'p-3 shadow-2xl slide-in-from-bottom-2'}`}
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
      <div className="flex-1 min-w-0 space-y-1 select-text">
        <div className="font-semibold text-[#212529] dark:text-white break-words">
          {f.title}
          {f.count > 1 && <span className="ml-1.5 font-normal text-fg-muted dark:text-[#adb5bd]">×{f.count}</span>}
        </div>
        {f.detail && <div className="text-[0.6875rem] text-[#495057] dark:text-[#adb5bd] break-words">{f.detail}</div>}
        {f.note && <div className="text-[0.6875rem] text-[#495057] dark:text-[#adb5bd] break-words">{f.note}</div>}
        {f.code && (
          <code className="block text-[0.6875rem] font-mono bg-[#f1f3f5] dark:bg-[#1f2326] rounded px-2 py-1 break-all select-text">
            {f.code}
          </code>
        )}
      </div>
      <button
        type="button"
        // A click must not take focus from what the user was in (the command palette's search box, a dialog's field):
        // the palette closes on Escape through its input, which would stop hearing it, and on a phone the keyboard would drop.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => dismissFailure(f.id)}
        aria-label={`Dismiss: ${f.title}`}
        // The icon is small; the padding (pulled back with a negative margin) is what a finger has to hit.
        className="p-2.5 -m-2 text-fg-muted hover:text-[#212529] dark:hover:text-white rounded flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/**
 * Rendered by `ActionToasts` in the same column, ahead of the tracked actions, so a failure and an action stack
 * instead of covering each other. Failures stay until dismissed, like a failed action.
 */
export function FailureToastItems() {
  const failures = useFailures()
  return (
    <>
      {failures.map((f) => (
        <FailureCard key={f.id} failure={f} />
      ))}
    </>
  )
}

/**
 * The failures raised while a dialog is open, shown inside that dialog between its header and its body: in the flow
 * of the dialog, so they never cover its buttons, whatever the window size, zoom, orientation or on-screen keyboard;
 * reachable with Tab; and announced as part of the dialog. Only the dialog on top shows them. The newest is first, so
 * it is the one in view when several are showing. In a short window (a phone in landscape, or with the keyboard up) the
 * strip is one compact card high and scrolls, so the form keeps its room. `Modal` renders this.
 */
export function DialogFailures({ token }: { token: symbol }) {
  const failures = useSyncExternalStore(
    subscribeFailures,
    () => getDialogFailures(token),
    () => getDialogFailures(token)
  )
  if (failures.length === 0) return null
  return (
    <div className="flex-shrink-0 max-h-[28vh] [@media(max-height:560px)]:max-h-16 overflow-y-auto p-2 [@media(max-height:560px)]:p-1.5 space-y-1.5 bg-rose-50 dark:bg-rose-950/20 border-b border-rose-200 dark:border-rose-900/50">
      {[...failures].reverse().map((f) => (
        <FailureCard key={f.id} failure={f} inline />
      ))}
    </div>
  )
}
