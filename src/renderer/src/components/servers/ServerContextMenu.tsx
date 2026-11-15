import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExternalLink, Terminal, Link2, Copy, RotateCw, Power, Play, Radio } from 'lucide-react'
import { components } from '@shared/api/schema'
import { formatDeepLink } from '@shared/deeplink'
import { primaryIpv4 } from '../../lib/deeplinks'
import { isModalOpen } from '../ui/Modal'

type ServerResponse = components['schemas']['Server']

export interface ContextMenuState {
  server: ServerResponse
  x: number
  y: number
}

/**
 * Where a context menu opens for the element whose onContextMenu asked for it (the currentTarget). A right-click or a long press
 * opens it where the pointer is. The keyboard's menu key and Shift+F10 have no pointer: Chromium sends them with button -1 and the
 * middle of the focused element as the point (the spec's pointerType is ''), so the menu would cover the row's own text. It hangs
 * from the element's bottom-left corner instead, as it does for a point that is not on the element at all (a made-up event).
 * Used by the DNS zone menu, and meant for any row that opens a menu.
 */
export function menuPoint(e: React.MouseEvent<HTMLElement>): { x: number; y: number } {
  const box = e.currentTarget.getBoundingClientRect()
  const keys = e.button === -1 || (e.nativeEvent as Partial<PointerEvent>).pointerType === ''
  const onIt = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom
  return keys || !onIt ? { x: box.left, y: box.bottom } : { x: e.clientX, y: e.clientY }
}

interface ServerContextMenuProps {
  state: ContextMenuState
  onClose: () => void
  onOpen: (server: ServerResponse) => void
  onSsh: (ip: string) => void
  onCopyLink: (serverId: number) => void
  onAction: (serverId: number, type: 'power_on' | 'reboot' | 'shutdown') => void
  actionInProgress: boolean
}

/**
 * Lightweight in-renderer context menu for a server row. Rendered fixed at the
 * point it is given (menuPoint gives the click point, or under the row for the
 * keyboard), nudged back on-screen if it would overflow, closed on outside
 * click / Escape (and so Android's Back) / Tab / scroll. Focus moves to its
 * first item, the arrow keys, Home and End move between items, and closing it
 * puts focus back where it was.
 */
export const ServerContextMenu: React.FC<ServerContextMenuProps> = ({
  state,
  onClose,
  onOpen,
  onSsh,
  onCopyLink,
  onAction,
  actionInProgress
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: state.x, y: state.y })
  const { server } = state
  const ip = primaryIpv4(server)
  const isRunning = server.status === 'active'
  // What had focus when the menu opened, read while rendering, before the menu takes focus.
  const opener = useRef<Element | null | undefined>(undefined)
  if (opener.current === undefined) opener.current = document.activeElement
  const refocus = () => {
    const back = opener.current
    if (back instanceof HTMLElement && back !== document.body && back.isConnected) back.focus()
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(8, state.x + r.width > innerWidth - 8 ? Math.min(state.x - r.width, innerWidth - r.width - 8) : state.x),
      y: state.y + r.height > innerHeight - 8 ? Math.max(8, innerHeight - r.height - 8) : state.y
    })
  }, [state.x, state.y])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    return () => {
      // Closed by a click elsewhere, a scroll or the window losing focus: focus had nowhere to go once the menu went.
      const now = document.activeElement
      if (!now || now === document.body) refocus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      // A dialog opened above the menu (one that needs an answer, say) makes it inert, and then Escape is the dialog's.
      if (e.key === 'Escape' && !e.defaultPrevented && !isModalOpen() && !ref.current?.closest('[inert]')) {
        e.preventDefault()
        refocus()
        onClose()
      }
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  // Focus goes back before the item runs, so a dialog the item opens returns focus there too.
  const run = (fn: () => void) => () => {
    refocus()
    onClose()
    fn()
  }

  const move = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      refocus()
      onClose()
      return
    }
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (to === null || items.length === 0) return
    e.preventDefault()
    items[(to + items.length) % items.length].focus()
  }

  const item =
    'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08] focus:bg-black/[0.06] dark:focus:bg-white/[0.1] focus-ring transition disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${server.name} #${server.id}`}
      // Escape closes it, so the app's Back (which sends Escape to a dismissible menu) closes it too.
      data-dismissible="true"
      onKeyDown={move}
      style={{ left: pos.x, top: pos.y, maxHeight: 'calc(100vh - 16px)' }}
      className="fixed z-[60] w-56 max-w-[calc(100vw-16px)] overflow-y-auto p-1 bg-white dark:bg-[#2b3035] text-[#212529] dark:text-[#f8f9fa] border border-[#ced4da] dark:border-[#373b3e] rounded-md shadow-xl select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div aria-hidden="true" className="px-2.5 py-1.5 text-[0.6875rem] font-semibold text-fg-muted dark:text-slate-400 truncate border-b border-[#ced4da]/60 dark:border-[#373b3e] mb-1">
        {server.name} <span className="font-mono font-normal">#{server.id}</span>
      </div>

      <button role="menuitem" tabIndex={-1} className={item} onClick={run(() => onOpen(server))}>
        <ExternalLink className="w-3.5 h-3.5 text-fg-link" /> Open
      </button>
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(() => onSsh(ip || ''))}>
        <Terminal className="w-3.5 h-3.5 text-fg-link" /> SSH as root
      </button>

      <div role="separator" className="my-1 border-t border-[#ced4da]/60 dark:border-[#373b3e]" />

      <button role="menuitem" tabIndex={-1} className={item} disabled={!ip} onClick={run(() => ip && navigator.clipboard.writeText(ip))}>
        <Copy className="w-3.5 h-3.5" /> Copy IP {ip && <span className="ml-auto font-mono text-[0.625rem] text-fg-muted">{ip}</span>}
      </button>
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(() => onCopyLink(server.id))} title={formatDeepLink({ kind: 'server', serverId: server.id })}>
        <Link2 className="w-3.5 h-3.5" /> Copy bldesk:// link
      </button>
      <button
        role="menuitem"
        tabIndex={-1}
        className={item}
        onClick={run(() => navigator.clipboard.writeText(formatDeepLink({ kind: 'console', serverId: server.id })))}
        title={formatDeepLink({ kind: 'console', serverId: server.id })}
      >
        <Radio className="w-3.5 h-3.5" /> Copy console link
      </button>

      <div role="separator" className="my-1 border-t border-[#ced4da]/60 dark:border-[#373b3e]" />

      {isRunning ? (
        <>
          <button role="menuitem" tabIndex={-1} className={item} disabled={actionInProgress} onClick={run(() => onAction(server.id, 'reboot'))}>
            <RotateCw className="w-3.5 h-3.5 text-amber-500" /> Reboot…
          </button>
          <button role="menuitem" tabIndex={-1} className={item} disabled={actionInProgress} onClick={run(() => onAction(server.id, 'shutdown'))}>
            <Power className="w-3.5 h-3.5 text-rose-500" /> Shutdown…
          </button>
        </>
      ) : (
        <button role="menuitem" tabIndex={-1} className={item} disabled={actionInProgress} onClick={run(() => onAction(server.id, 'power_on'))}>
          <Play className="w-3.5 h-3.5 text-emerald-500" /> Power on…
        </button>
      )}
    </div>
  )
}
