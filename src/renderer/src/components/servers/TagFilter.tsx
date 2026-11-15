import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TagDot } from '../tags/TagChip'
import { safeAreaInsets } from '../../lib/safeArea'
import { usePhoneLayout } from '../../lib/usePhoneLayout'
import { FILTER_CONTROL, FilterShell } from './FilterControl'

export interface TagFilterOption {
  tag: string
  count: number
  color?: string | null
}

interface Props {
  options: TagFilterOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  mode: 'any' | 'all'
  onModeChange: (mode: 'any' | 'all') => void
}

const WIDTH = 288
const GAP = 4

/**
 * The Servers page's tag filter: a button that opens a list with a tick box for each tag in use (colour, name, how
 * many servers), a Clear button, and an Any | All switch. Any keeps servers with at least one ticked tag, All those
 * with every ticked tag. The list is placed against the viewport from the button, so no card clips it.
 */
export const TagFilter: React.FC<Props> = ({ options, selected, onChange, mode, onModeChange }) => {
  const [open, setOpen] = useState(false)
  // On a phone every row and the buttons in the list are at least 40 px tall (and at least 36 px wide), so a fingertip
  // can pick one; the button that opens it is 36 px tall on every screen, like the Regions and Status filters.
  const phone = usePhoneLayout()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const label = selected.length === 0 ? 'All Tags' : selected.length === 1 ? `@${selected[0]}` : `${selected.length} tags`

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) button.current?.focus()
  }, [])

  const place = useCallback(() => {
    const b = button.current
    const p = panel.current
    if (!b || !p) return false
    const a = b.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    if (a.bottom < 0 || a.top > vh) return false
    const width = Math.min(WIDTH, vw - 16)
    const h = p.offsetHeight
    const left = Math.max(8, Math.min(a.right - width, vw - width - 8))
    // Never under the status bar or the gesture bar on a phone.
    const inset = safeAreaInsets()
    let top = a.bottom + GAP
    if (top + h > vh - 8 - inset.bottom) top = a.top - GAP - h
    setPos({ top: Math.max(Math.max(8, inset.top + 4), Math.min(top, vh - 8 - inset.bottom - h)), left })
    return true
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    place()
    const p = panel.current
    if (!p || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => place())
    ro.observe(p)
    return () => ro.disconnect()
  }, [open, place])

  // The first tick box takes focus, so Space ticks at once; with no tag in use, the Any switch does.
  useEffect(() => {
    if (!open) return
    ;(panel.current?.querySelector<HTMLElement>('input[type=checkbox]') ?? panel.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus()
  }, [open])

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

  const toggle = (tag: string) => onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag])

  return (
    <>
      <FilterShell>
        <button
          ref={button}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Filter by tag: ${label}`}
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex items-center max-w-[11rem] ${FILTER_CONTROL}`}
        >
          <span className="truncate">{label}</span>
        </button>
      </FilterShell>
      {open && (
        <div
          ref={panel}
          role="dialog"
          // Escape closes it, so the app's Back (which sends Escape to a dismissible dialog) closes it too.
          data-dismissible="true"
          aria-label="Filter by tag"
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: Math.min(WIDTH, document.documentElement.clientWidth - 16), maxHeight: 'calc(100vh - max(0.5rem, env(safe-area-inset-top, 0px) + 0.25rem) - 0.5rem - env(safe-area-inset-bottom, 0px))', opacity: pos ? 1 : 0 }}
          className="!m-0 z-50 flex flex-col rounded-lg border border-[#ced4da] dark:border-[#495057] bg-white dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] shadow-xl text-xs"
        >
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
            <span className="font-semibold text-[0.8125rem]">Filter by tag</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className={`text-fg-link hover:underline disabled:opacity-40 disabled:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#017cb6] rounded ${phone ? 'min-h-[40px] min-w-[48px] px-2 -my-2 -mr-2 inline-flex items-center justify-center' : ''}`}
            >
              Clear
            </button>
          </div>

          <div className="px-3 pb-2">
            <div role="radiogroup" aria-label="Match" className="inline-flex rounded border border-[#ced4da] dark:border-[#495057] overflow-hidden">
              {(['any', 'all'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => onModeChange(m)}
                  className={`${phone ? 'px-4 min-h-[40px] min-w-[56px] inline-flex items-center justify-center' : 'px-3 py-1'} focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#017cb6] ${
                    mode === m ? 'bg-[#017cb6] text-white font-medium' : 'text-[#495057] dark:text-[#ced4da] hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  {m === 'any' ? 'Any' : 'All'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[0.6875rem] text-fg-muted dark:text-slate-400">
              {mode === 'any' ? 'Servers with at least one ticked tag.' : 'Servers with every ticked tag.'}
            </p>
          </div>

          {options.length === 0 ? (
            <p className="px-3 pb-3 text-fg-muted dark:text-slate-400">No server has a tag yet.</p>
          ) : (
            <ul className="min-h-0 overflow-y-auto border-t border-[#ced4da] dark:border-[#495057] py-1">
              {options.map((o) => (
                <li key={o.tag}>
                  <label className={`flex items-center gap-2 px-3 ${phone ? 'min-h-[44px]' : 'py-1.5'} cursor-pointer hover:bg-black/[0.05] dark:hover:bg-white/[0.06]`}>
                    <input type="checkbox" checked={selected.includes(o.tag)} onChange={() => toggle(o.tag)} className={`${phone ? 'w-5 h-5' : 'w-3.5 h-3.5'} accent-[#017cb6]`} />
                    <TagDot color={o.color} />
                    <span className="truncate flex-1 min-w-0">@{o.tag}</span>
                    <span className="text-fg-muted dark:text-slate-400 shrink-0">{o.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
