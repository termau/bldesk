/**
 * The Enter key that opens a dialog must not also answer it.
 *
 * A `keydown` handler that opens a dialog does so before the browser has finished with that keystroke: React mounts the
 * dialog (and the dialog focuses its Confirm button) inside the `keydown`, and the browser then sends the same
 * keystroke's `keypress` to whatever has focus. A button is activated by an Enter key press, and a form is submitted by
 * one, so the dialog was answered before anyone could read it. Handlers that call `preventDefault()` on the `keydown`
 * cancel the key press and never met this; the inline editors did not.
 *
 * `watchEnter` says whether Enter is down. A dialog asks it when it opens, and its `enterKeyGuard` then cancels the
 * `keypress` of that Enter until the key is released. A later, separate Enter is not touched, and neither is a click
 * made by assistive technology (no key is down, so nothing is armed).
 */

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

export interface EnterWatch {
  isDown(): boolean
  stop(): void
}

/** Track Enter from the capture phase, so it is known before any handler (and any dialog) reacts to the same key. */
export function watchEnter(doc: Listenable, win: Listenable): EnterWatch {
  let down = false
  const onKeyDown = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') down = true
  }
  const onKeyUp = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') down = false
  }
  // A key released while another window had focus never reaches this one.
  const onBlur = () => {
    down = false
  }
  doc.addEventListener('keydown', onKeyDown, true)
  doc.addEventListener('keyup', onKeyUp, true)
  win.addEventListener('blur', onBlur)
  return {
    isDown: () => down,
    stop: () => {
      doc.removeEventListener('keydown', onKeyDown, true)
      doc.removeEventListener('keyup', onKeyUp, true)
      win.removeEventListener('blur', onBlur)
    }
  }
}

// Started when the app loads, which is before any key is pressed.
const watch: EnterWatch | null = typeof document === 'undefined' || typeof window === 'undefined' ? null : watchEnter(document, window)

/** Whether Enter is down right now. */
export function isEnterDown(): boolean {
  return watch?.isDown() ?? false
}

/**
 * For one dialog: armed when it opened while Enter was down, and disarmed once that key is released.
 * While armed, the dialog cancels the `keypress` of Enter.
 */
export function enterKeyGuard(enterWasDown: boolean) {
  let armed = enterWasDown
  return {
    /** Whether this `keypress` is the opening keystroke's, to be cancelled. */
    cancelsKeyPress: (e: { key: string }) => armed && e.key === 'Enter',
    keyUp: (e: { key: string }) => {
      if (e.key === 'Enter') armed = false
    },
    reset: () => {
      armed = false
    }
  }
}
