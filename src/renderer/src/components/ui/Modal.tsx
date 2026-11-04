import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, type LucideIcon } from 'lucide-react'
import { enterDialog, leaveDialog } from '../../lib/failures'
import { DialogFailures } from '../actions/FailureToasts'
import { enterKeyGuard, isEnterDown } from '../../lib/enterKey'

/**
 * The one modal shell. Every dialog in the app — the confirm dialog, the
 * create-server form, the traceroute viewer, whatever comes next — is this
 * component with different insides, so they all look and behave the same:
 * same backdrop, same panel, same header with a close button, Escape and
 * backdrop-click to dismiss, body that scrolls when tall.
 *
 * Dialogs that *change* something still go through `useConfirm()`; this is
 * the shell underneath it. The mutation guard fails any `createPortal` outside
 * this file, so a new dialog has to be a `<Modal>` (AGENTS.md rule 2).
 *
 * The shell also owns the keyboard while it is open: focus moves into the
 * dialog, Tab and Shift+Tab stay inside it, a held Enter key does not repeat,
 * the Enter that opened it cannot also activate something in it (lib/enterKey.ts),
 * and focus goes back to what opened it. Where dialogs are stacked, only the
 * top one does this.
 *
 * A failure reported while a dialog is open (`notifyFailure`) shows inside it,
 * between the header and the body, so it never covers the dialog's buttons.
 */

/** The dialogs that are open, oldest first. */
const openModals: symbol[] = []

/** Whether any dialog is open, for things that must not start while one is (the command palette). */
export function isModalOpen(): boolean {
  return openModals.length > 0
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// Where a dialog's focus goes first: a text field if it has one (a select or a checkbox first would take typing as a
// choice), then any field.
const TEXT_FIELDS = 'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea:not([disabled])'
const FIELDS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'

const focusablesIn = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)

export interface ModalProps {
  title: React.ReactNode
  icon?: LucideIcon
  /** Tailwind classes for the icon and title, e.g. a rose tone for danger. */
  headTone?: string
  /**
   * Called for Escape, the backdrop and the close button. Leave it out for a dialog that has to be answered: it then has
   * no close button, and Escape and the backdrop do nothing.
   */
  onClose?: () => void
  /** Panel width. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Centre (default) or hang from the top, which suits tall forms. */
  align?: 'center' | 'top'
  /** While true, Escape, the backdrop and the close button do nothing. */
  busy?: boolean
  /** Render the panel as a form so Enter submits and the footer can hold a submit button. */
  as?: 'div' | 'form'
  onSubmit?: (e: React.FormEvent) => void
  /** Bordered strip under the body: buttons, or a note. */
  footer?: React.ReactNode
  /** Extra content in the header, left of the close button. */
  headerRight?: React.ReactNode
  /** Disable text selection on the shell (confirm dialogs). Body keeps select-text. */
  noSelect?: boolean
  /** Stacking order; the default sits above the palette and the toasts (`ActionToasts`), which stay below every dialog. */
  z?: number
  labelledBy?: string
  children: React.ReactNode
}

const WIDTH: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl'
}

export const Modal: React.FC<ModalProps> = ({
  title,
  icon: Icon,
  headTone = 'text-[#212529] dark:text-white',
  onClose,
  size = 'md',
  align = 'center',
  busy = false,
  as = 'div',
  onSubmit,
  footer,
  headerRight,
  noSelect = false,
  z = 70,
  labelledBy = 'modal-title',
  children
}) => {
  const id = useRef<symbol>(Symbol('modal')).current
  // The key listeners are added once, when the dialog mounts, so that an older dialog's listener always runs before a
  // newer one's. Re-adding them on each render (an inline onClose is a new function every time) moved a listener to the
  // end of the line, and then Escape could be heard by the dialog beneath after the one on top had closed.
  const latest = useRef({ onClose, busy })
  latest.current = { onClose, busy }
  const panelRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // Read while rendering: by the time an effect runs, an autofocused field inside the dialog has already taken focus.
  const opener = useRef<Element | null | undefined>(undefined)
  if (opener.current === undefined) opener.current = document.activeElement
  // Whether Enter was down when this dialog opened, read while rendering for the same reason: it is the key that opened it.
  const enterGuard = useRef<ReturnType<typeof enterKeyGuard> | undefined>(undefined)
  if (enterGuard.current === undefined) enterGuard.current = enterKeyGuard(isEnterDown())

  useEffect(() => {
    openModals.push(id)
    enterDialog(id)
    const panel = panelRef.current

    // Take focus into the dialog, unless something in it has already asked for it (a field with autoFocus, the confirm
    // button). A touch screen gets the panel itself, so opening a form does not raise the on-screen keyboard.
    if (panel && !panel.contains(document.activeElement)) {
      const touch = window.matchMedia?.('(pointer: coarse)').matches
      const visible = (el: HTMLElement) => el.getClientRects().length > 0
      const inBody = (selector: string) => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(selector) ?? []).find(visible)
      const field = touch ? undefined : (inBody(TEXT_FIELDS) ?? inBody(FIELDS))
      ;(field ?? (touch ? undefined : bodyRef.current && focusablesIn(bodyRef.current)[0]) ?? panel).focus()
    }

    const onKeyCapture = (e: KeyboardEvent) => {
      if (!panel || openModals[openModals.length - 1] !== id) return
      // A held Enter repeats. The one that opened a dialog would otherwise land on its focused confirm button, and one
      // held on a side action would run it again and again. A text area keeps its repeats: they are new lines.
      if (e.key === 'Enter' && e.repeat && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusablesIn(panel)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!panel.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyCapture, true)

    // The key press of the Enter that opened this dialog arrives after the dialog has focused its button, and would
    // activate it, or submit a form whose field it focused. It is cancelled, until that key is released.
    const guard = enterGuard.current!
    const onKeyPressCapture = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== id || !guard.cancelsKeyPress(e)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onKeyUpCapture = (e: KeyboardEvent) => guard.keyUp(e)
    document.addEventListener('keypress', onKeyPressCapture, true)
    document.addEventListener('keyup', onKeyUpCapture, true)
    window.addEventListener('blur', guard.reset)

    const onEscape = (e: KeyboardEvent) => {
      // Escape closes the dialog on top, not the ones beneath it, and not one that something else has already answered.
      if (e.key !== 'Escape' || e.defaultPrevented || openModals[openModals.length - 1] !== id) return
      const { onClose: close, busy: isBusy } = latest.current
      if (!close || isBusy) return
      e.preventDefault()
      close()
    }
    document.addEventListener('keydown', onEscape)

    return () => {
      document.removeEventListener('keydown', onKeyCapture, true)
      document.removeEventListener('keypress', onKeyPressCapture, true)
      document.removeEventListener('keyup', onKeyUpCapture, true)
      window.removeEventListener('blur', guard.reset)
      document.removeEventListener('keydown', onEscape)
      openModals.splice(openModals.indexOf(id), 1)
      leaveDialog(id)
      // Give focus back to what opened the dialog, unless it has gone or focus has since been put somewhere on purpose.
      const back = opener.current
      const now = document.activeElement
      if (back instanceof HTMLElement && back.isConnected && (!now || now === document.body || panel?.contains(now))) back.focus()
    }
  }, [])

  const Panel: any = as
  const panelProps = as === 'form' ? { onSubmit } : {}

  return createPortal(
    <div
      className={`fixed inset-0 flex ${align === 'top' ? 'items-start' : 'items-center'} justify-center bg-black/60 overlay-safe ${noSelect ? 'select-none' : ''}`}
      // Panels start below the app's title bar (2.75rem) rather than over it,
      // so a tall dialog's header does not collide with the window's own and
      // the drag region and window controls stay reachable.
      style={{ zIndex: z, paddingTop: 'calc(2.75rem + max(1rem, env(safe-area-inset-top, 0px)))' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.()
      }}
    >
      <Panel
        {...panelProps}
        ref={panelRef}
        tabIndex={-1}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        className={`w-full ${WIDTH[size]} max-h-full flex flex-col bg-white dark:bg-[#2b3035] border border-[#ced4da] dark:border-[#373b3e] rounded-lg shadow-2xl overflow-hidden outline-none`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Whether Escape (and so the Android back button) can close it: a dialog that has to be answered cannot.
        data-dismissible={onClose ? 'true' : 'false'}
      >
        <div className="flex-shrink-0 flex items-start justify-between gap-3 p-4 border-b border-[#ced4da] dark:border-[#373b3e]">
          <div className={`flex items-center gap-2 min-w-0 ${headTone}`}>
            {Icon && <Icon className="w-5 h-5 flex-shrink-0" />}
            <h3 id={labelledBy} className="font-bold text-sm truncate">
              {title}
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerRight}
            {onClose && (
              <button
                type="button"
                onClick={() => !busy && onClose()}
                disabled={busy}
                className="text-[#6c757d] hover:text-[#212529] dark:hover:text-white transition disabled:opacity-40"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <DialogFailures token={id} />

        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto select-text">
          {children}
        </div>

        {footer && <div className="flex-shrink-0 border-t border-[#ced4da] dark:border-[#373b3e]">{footer}</div>}
      </Panel>
    </div>,
    document.body
  )
}
