import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BellRing, ExternalLink, X } from 'lucide-react'
import type { FleetAlertDetail } from '../../api/queries'
import { alertSummary, describeRaisedAlert, raisedAlerts } from '../../lib/thresholdAlerts'

interface Props {
  serverName: string
  detail: FleetAlertDetail | undefined
  onOpenSettings: () => void
}

const WIDTH = 320
const GAP = 6
const MARGIN = 8

/**
 * A bell on a heatmap row for a server BinaryLane lists as having an exceeded threshold alert. Hovering it says
 * which alert; clicking or tapping it opens a small popup with the same detail and a button to the server's alert
 * settings. The popup closes with its X, Escape, a click or tap outside it, and Android's Back button (it is a
 * `data-dismissible` dialog, which Back closes before it leaves the screen), so Back never takes the page away.
 */
export const ThresholdAlertMarker: React.FC<Props> = ({ serverName, detail, onOpenSettings }) => {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const raised = detail?.status === 'ready' ? raisedAlerts(detail.alerts) : null
  const summary = alertSummary(raised)

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) anchorRef.current?.focus()
  }, [])

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${serverName}: ${summary}`}
        title={summary}
        onClick={(e) => {
          // The row's own click opens the server's Usage tab.
          e.stopPropagation()
          setOpen((value) => !value)
        }}
        // The hover fill only where there is a pointer that can hover: on a touch screen :hover sticks after a tap and leaves a filled circle.
        className="ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-rose-600 dark:text-rose-400 [@media(hover:hover)]:hover:bg-rose-100 dark:[@media(hover:hover)]:hover:bg-rose-500/20"
      >
        <BellRing aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && anchorRef.current && (
        <AlertPopup
          anchor={anchorRef.current}
          serverName={serverName}
          detail={detail}
          onOpenSettings={() => {
            close(false)
            onOpenSettings()
          }}
          onClose={close}
        />
      )}
    </>
  )
}

const AlertPopup: React.FC<{
  anchor: HTMLElement
  serverName: string
  detail: FleetAlertDetail | undefined
  onOpenSettings: () => void
  onClose: (restoreFocus: boolean) => void
}> = ({ anchor, serverName, detail, onOpenSettings, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Below the bell, or above it when there is no room, and always inside what can be seen: phones are narrower than the popup.
  const place = useCallback((): boolean => {
    const panel = panelRef.current
    if (!panel || !anchor.isConnected) return false
    const a = anchor.getBoundingClientRect()
    const viewportW = document.documentElement.clientWidth
    const viewportH = document.documentElement.clientHeight
    const width = Math.min(WIDTH, viewportW - MARGIN * 2)
    const height = panel.offsetHeight
    const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - width / 2), viewportW - width - MARGIN)
    const below = a.bottom + GAP
    const top = below + height + MARGIN <= viewportH ? below : Math.max(MARGIN, a.top - GAP - height)
    setPos({ top, left })
    return true
  }, [anchor])

  useLayoutEffect(() => {
    place()
  }, [place, detail])

  // The panel is hidden until it has a position, and a hidden button cannot take focus, so focus waits for the first placement.
  const placed = pos !== null
  useEffect(() => {
    if (placed) closeRef.current?.focus()
  }, [placed])

  useEffect(() => {
    const onDown = (e: Event) => {
      const target = e.target as Node
      if (panelRef.current && !panelRef.current.contains(target) && !anchor.contains(target)) onClose(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose(true)
      }
    }
    // Fixed against the viewport, so it follows the bell when the page or the table scrolls, and goes when the bell does.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return
      if (!place()) onClose(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [anchor, onClose, place])

  const raised = detail?.status === 'ready' ? raisedAlerts(detail.alerts) : null

  return (
    <div
      ref={panelRef}
      role="dialog"
      // Escape closes it, so the app's Back (which sends Escape to a dismissible dialog) closes it too.
      data-dismissible="true"
      aria-label={`Threshold alert on ${serverName}`}
      // It sits inside the heatmap row, so none of these is the row's own click, double click or menu.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: Math.min(WIDTH, document.documentElement.clientWidth - MARGIN * 2), visibility: pos ? 'visible' : 'hidden' }}
      className="z-50 whitespace-normal rounded-lg border border-[#ced4da] bg-white p-3 text-left text-xs font-normal text-[#212529] shadow-xl dark:border-[#495057] dark:bg-[#2b3035] dark:text-[#f8f9fa]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold"><BellRing aria-hidden="true" className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />Threshold alert</div>
          <div className="truncate text-[11px] text-[#6c757d] dark:text-slate-400">{serverName}</div>
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={() => onClose(true)}
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#6c757d] hover:bg-[#e9ecef] dark:text-slate-400 dark:hover:bg-white/10"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {detail?.status === 'failed' && <p className="text-rose-700 dark:text-rose-300">BinaryLane reports a threshold alert on this server, but its alert details could not be loaded{detail.error ? `: ${detail.error}` : '.'}</p>}
        {!detail || (detail.status === 'loading') ? <p className="text-[#6c757d] dark:text-slate-400">BinaryLane reports a threshold alert on this server. Loading its alert details…</p> : null}
        {raised && raised.length > 0 && (
          <ul className="space-y-1.5">
            {raised.map((alert) => (
              <li key={alert.type} className="rounded bg-rose-50 px-2 py-1.5 dark:bg-rose-500/10">
                <div className="font-semibold">{describeRaisedAlert(alert)}</div>
                {alert.lastRaised && <div className="text-[11px] text-[#6c757d] dark:text-slate-400">Last raised {new Date(alert.lastRaised).toLocaleString()}</div>}
              </li>
            ))}
          </ul>
        )}
        {raised && raised.length === 0 && <p>BinaryLane reports a threshold alert on this server, but none of its enabled alerts is at its threshold in the latest reading. Its alert settings show each rule.</p>}
      </div>

      <p className="mt-2 text-[10px] leading-snug text-[#6c757d] dark:text-slate-400">BinaryLane lists the server; BLDesk compares the latest reading with each enabled threshold to show which alert.</p>

      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded bg-[#017cb6] px-3 py-2 text-xs font-semibold text-white hover:bg-[#016a9c]"
      >
        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />Open alert settings
      </button>
    </div>
  )
}
