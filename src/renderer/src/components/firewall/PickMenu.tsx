import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { PickChoice } from '../../lib/firewallPicks'

const WIDTH = 288
const MAX_HEIGHT = 320

/**
 * The magnifier and caret under a rule's source, destination or ports. It opens a list of ready-made values, and the one chosen is
 * added to what the field holds (the caller does that: `withChoice`). The list is placed against the window, so a row at the bottom of a scrolling list does not clip it.
 *
 * Opening it asks BinaryLane for nothing: the list is what BLDesk already holds (its server list refreshes on its own), as in mPanel,
 * where a server created in another tab is not in the menu until the page is loaded again. It is taken as the menu opens and kept until it
 * closes, so a refresh landing while one is being chosen from does not move the entries under the pointer.
 */
export const PickMenu: React.FC<{
  /** What the field is, for the button's name: "rule 3 source addresses". */
  label: string
  choices: readonly PickChoice[]
  onPick: (choice: PickChoice) => void
  disabled?: boolean
}> = ({ label, choices, onPick, disabled }) => {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<readonly PickChoice[]>(choices)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // Below the button, or above it when there is more room there.
  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect()
    if (!b || b.bottom < 0 || b.top > window.innerHeight) return false
    const below = window.innerHeight - b.bottom - 8
    const above = b.top - 8
    const up = below < 200 && above > below
    const width = Math.min(WIDTH, document.documentElement.clientWidth - 16)
    setPos({
      left: Math.max(8, Math.min(b.left, document.documentElement.clientWidth - width - 8)),
      ...(up ? { bottom: window.innerHeight - b.top + 4 } : { top: b.bottom + 4 }),
      maxHeight: Math.max(120, Math.min(MAX_HEIGHT, up ? above : below))
    })
    return true
  }, [])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setPos(null)
    if (refocus) button.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    panel.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !button.current?.contains(t)) close(false)
    }
    const onKey = (e: KeyboardEvent) => {
      // Not while a dialog, the palette or the drawer sits above it (it is inert then): that layer's Escape comes first.
      if (e.key === 'Escape' && !panel.current?.closest('[inert]')) {
        e.stopPropagation()
        close(true)
      }
    }
    const onMove = (e: Event) => {
      if (e.target instanceof Node && panel.current?.contains(e.target)) return
      if (!place()) close(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, close, place])

  const move = (e: React.KeyboardEvent) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (to === null || items.length === 0) return
    e.preventDefault()
    items[(to + items.length) % items.length].focus()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Choose ${label}`}
        title={`Choose ${label}`}
        disabled={disabled || choices.length === 0}
        onClick={() => {
          if (open) return close(false)
          setShown(choices)
          setOpen(true)
        }}
        className="mt-0.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[#495057] dark:text-slate-300 hover:text-fg-link hover:bg-sky-50 dark:hover:bg-sky-950/40 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#495057] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center"
      >
        <Search className="w-3.5 h-3.5" aria-hidden="true" />
        <ChevronDown className="w-3 h-3" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label={label}
          // Escape closes it, so the app's Back (which sends Escape to a dismissible dialog) closes it too.
          data-dismissible="true"
          onKeyDown={move}
          // A rule is dragged by any part that is not a control: the menu's own padding is not one, and must not start a drag of the rule under it.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top, bottom: pos?.bottom, width: Math.min(WIDTH, document.documentElement.clientWidth - 16), maxHeight: pos?.maxHeight ?? MAX_HEIGHT, opacity: pos ? 1 : 0 }}
          className="!m-0 z-50 overflow-y-auto rounded-lg border border-[#ced4da] dark:border-[#495057] bg-white dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] shadow-xl text-xs py-1"
        >
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              title={c.values.join(', ')}
              onClick={() => {
                onPick(c)
                close(true)
              }}
              className="block w-full text-left px-3 py-1.5 [@media(pointer:coarse)]:py-2.5 truncate hover:bg-black/[0.05] dark:hover:bg-white/[0.08] focus:bg-black/[0.06] dark:focus:bg-white/[0.1] focus:outline-none"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
