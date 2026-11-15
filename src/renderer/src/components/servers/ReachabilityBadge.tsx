import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, HelpCircle, Loader2, RotateCw, Route } from 'lucide-react'
import type { TcpProbeResult, TracerouteHop } from '@shared/ipc-types'
import type { BinaryLaneClient } from '../../api/client'
import { useFirewallRules } from '../../api/queries'
import { Modal, isModalOpen } from '../ui/Modal'
import { explainUnreachablePort, describeRule, type FirewallVerdict } from '../../lib/firewallMatch'

/**
 * Reachability from the user's own machine (FEATURES.md #11).
 *
 * mPanel can say a server is running; only something running where the customer
 * is can say whether *they* can reach it. That difference is the whole point, so
 * this reports what happened from here and does not dress it up as a verdict
 * about the server.
 *
 * Split into a chip and a notice on purpose. The chip is one line and leads the
 * action cluster it qualifies - "Launch SSH" is only worth clicking if 22 answers
 * from here - while the explanation can run to three lines and would squeeze
 * those buttons if it shared their row.
 *
 * The three probe outcomes are kept distinct because they have different fixes:
 *   connected -> latency
 *   refused   -> something answered; the host is up, sshd is not
 *   timeout   -> silently dropped, which is what a firewall does
 *
 * Electron only. The Android build has no raw sockets and no child_process, so
 * `probeTcp` is absent there and both pieces render nothing rather than offering
 * a control that cannot work.
 */
export interface Reachability {
  supported: boolean
  result: TcpProbeResult | null
  busy: boolean
  /** Increments per completed probe; keys the one-shot blink. */
  seq: number
  port: number
  probe: () => Promise<void>
  verdict: FirewallVerdict
  hops: TracerouteHop[] | null
  tracing: boolean
  runTrace: () => Promise<void>
  clearHops: () => void
}

export function useReachability(
  ip: string | undefined,
  port: number,
  client?: BinaryLaneClient | null,
  serverId?: number
): Reachability {
  const api = typeof window !== 'undefined' ? window.bldeskApi : undefined
  const supported = typeof api?.probeTcp === 'function'

  const [result, setResult] = useState<TcpProbeResult | null>(null)
  const [busy, setBusy] = useState(false)
  /* Bumped per completed probe. Used as the "?" React key so a fresh failure
   * re-mounts it and blinks again, while an unchanged one stays still. */
  const [seq, setSeq] = useState(0)
  const [hops, setHops] = useState<TracerouteHop[] | null>(null)
  const [tracing, setTracing] = useState(false)

  /*
   * The previous result stays on screen while re-probing. Clearing it swapped
   * the pill for a grey "Checking" one and back, which read as a flash and
   * shifted the row width for the duration of the probe.
   */
  const probe = useCallback(async () => {
    if (!supported || !ip) return
    setBusy(true)
    try {
      const next = (await api!.probeTcp!(ip, port, 4000)) ?? null
      setResult(next)
      setSeq((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }, [api, ip, port, supported])

  useEffect(() => {
    setResult(null)
    setHops(null)
    void probe()
  }, [probe])

  const timedOut = !!result && !result.ok && result.error === 'timeout'
  // Fetched only once a timeout has happened, so a healthy server never pulls
  // firewall rules it has no use for.
  const rulesQuery = useFirewallRules(client ?? null, timedOut && serverId ? serverId : null)
  const verdict = explainUnreachablePort(timedOut ? rulesQuery.data : undefined, port, ip)

  const runTrace = useCallback(async () => {
    if (!supported || !ip) return
    setTracing(true)
    try {
      setHops((await api!.traceroute!(ip, 12)) ?? [])
    } finally {
      setTracing(false)
    }
  }, [api, ip, supported])

  const clearHops = useCallback(() => setHops(null), [])

  return { supported, result, busy, seq, port, probe, verdict, hops, tracing, runTrace, clearHops }
}

const pill = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[0.6875rem] font-medium'

/** Re-probe. An icon rather than a word: the row is tight, the label goes on hover. */
const ReloadButton: React.FC<{ r: Reachability; busy: boolean }> = ({ r, busy }) => (
  <button
    type="button"
    onClick={() => void r.probe()}
    disabled={busy}
    title="Re-check"
    aria-label="Re-check"
    className="inline-flex text-current opacity-60 hover:opacity-100 disabled:opacity-30"
  >
    <RotateCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
  </button>
)

/**
 * One sentence for the "?" card, or null when there is nothing to explain.
 *
 * Only a timeout can be explained by a rule, and only when a rule actually
 * covers the port - saying "check your firewall rules" when none do sends the
 * reader hunting for something that does not exist.
 */
function explainTimeout(r: Reachability): string | null {
  const { result, port, verdict } = r
  if (!result || result.ok || result.error !== 'timeout') return null
  switch (verdict.kind) {
    case 'blocked':
      return `A firewall rule drops this: ${describeRule(verdict.rule)}${
        verdict.rule.description ? ` — “${verdict.rule.description}”` : ''
      } (rule ${verdict.index + 1}).`
    case 'no-rules':
      return `No BinaryLane firewall rules are set for this server, so nothing is filtered at their end. The drop is the server's own firewall or the path in between.`
    case 'no-matching-rule':
      return `No BinaryLane rule blocks port ${port}, so check the server's own firewall — ufw or nftables on Linux, Windows Defender Firewall on Windows.`
    default:
      return `Port ${port} did not answer from this network. Nothing was refused, which is what a drop looks like.`
  }
}

/** One line, leading the action buttons. */
export const ReachabilityChip: React.FC<{
  r: Reachability
  ip?: string
  sshHost?: string
  onOpenFirewall?: () => void
}> = ({ r, ip, sshHost, onOpenFirewall }) => {
  if (!r.supported || !ip) return null
  const { result, busy, port } = r
  const explanation = explainTimeout(r)

  const failed = !!result && !result.ok

  return (
    <span className="inline-flex items-center gap-2" title={sshHost ? `Checks the public address; SSH connects to ${sshHost}` : undefined}>
      {/* No result yet: the only time the pill is a placeholder. */}
      {!result && busy && (
        <span className={`${pill} bg-[#e9ecef] dark:bg-[#343a40] text-fg-muted dark:text-slate-400`}>
          <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          Checking {port}…
        </span>
      )}

      {result?.ok && (
        <span
          title={sshHost ? `Checks the public address; SSH connects to ${sshHost}` : `TCP connect to port ${port} from this machine`}
          className={`${pill} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300`}
        >
          {busy ? (
            <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          ) : (
            <Activity className="w-3 h-3 shrink-0" />
          )}
          {result.latencyMs?.toFixed(0)} ms from here
          <ReloadButton r={r} busy={busy} />
        </span>
      )}

      {failed && (
        <span
          className={`${pill} ${
            result!.error === 'refused'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
          }`}
        >
          {busy ? (
            <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          ) : (
            <AlertTriangle className="w-3 h-3 shrink-0" />
          )}
          {result!.error === 'refused'
            ? `Port ${port} refused`
            : result!.error === 'invalid-target'
              ? 'Not probeable'
              : `Port ${port} unreachable`}

          {/*
            * The "?" sits inside the bubble it explains, and blinks once when a
            * failure lands so it is noticed without a looping animation in the
            * header. Keyed by probe sequence, so a fresh failure blinks again
            * and an unchanged one does not.
            */}
          {explanation && (
            <WhyToggletip key={r.seq}>
              {(close) => (
                <>
                  <span className="block">{explanation}</span>
                  <span className="flex items-center gap-3">
                    {onOpenFirewall && r.verdict.kind === 'blocked' && (
                      <button
                        type="button"
                        onClick={() => {
                          close()
                          onOpenFirewall()
                        }}
                        className="text-fg-link hover:underline"
                      >
                        Open firewall rules
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void r.runTrace()}
                      disabled={r.tracing}
                      className="inline-flex items-center gap-1 text-fg-link hover:underline disabled:opacity-50"
                    >
                      {r.tracing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Route className="w-3 h-3" />}
                      <span>{r.tracing ? 'Tracing…' : 'Trace route'}</span>
                    </button>
                  </span>
                </>
              )}
            </WhyToggletip>
          )}

          {/* Inside the bubble, beside the state it refreshes. */}
          <ReloadButton r={r} busy={busy} />
        </span>
      )}

      {/*
        * Traceroute overlays to the side of the header rather than rendering in
        * flow. Inline it pushed the whole page down when a trace finished, which
        * moved what the reader was looking at; and it is output you read and copy
        * rather than a permanent part of the header.
        */}
      <TraceDialog r={r} ip={ip} />

    </span>
  )
}

/**
 * The "?" in a failed pill, a disclosure: hovering shows the card, and a click, Enter or Space keeps it open, so it can be
 * reached by keyboard, touch and screen reader (the card holds the only route to the firewall link and the traceroute
 * action). The card is a non-modal dialog, not a tooltip, because it has buttons in it: the "?" says whether it is
 * expanded, focus is not moved into it or held there, and Tab goes on from the "?" into its buttons. Escape (and so
 * Android's Back, as it says it closes on Escape), a click elsewhere or focus leaving it closes it, and Escape also hides a
 * card shown by hovering. Opening the firewall rules closes it too. Centred under the "?" unless that would run off the
 * window, when it is nudged in or shown above.
 *
 * The "?" sits inside the bubble it explains, and blinks once when a failure lands so it is noticed without a looping
 * animation in the header. Keyed by probe sequence, so a fresh failure blinks again and an unchanged one does not.
 */
const WhyToggletip: React.FC<{ children: (close: () => void) => React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const [place, setPlace] = useState({ dx: 0, up: false })
  const wrap = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const shown = open || hover

  const hide = () => {
    setOpen(false)
    setHover(false)
  }
  // Closed by a button in the card: focus goes back to the "?" rather than being lost with the card.
  const closeFromCard = () => {
    if (wrap.current?.contains(document.activeElement)) button.current?.focus()
    hide()
  }

  useLayoutEffect(() => {
    if (!shown) return setPlace({ dx: 0, up: false })
    const c = card.current?.getBoundingClientRect()
    const w = wrap.current?.getBoundingClientRect()
    if (!c || !w) return
    const right = document.documentElement.clientWidth - 8
    const dx = c.left < 8 ? 8 - c.left : c.right > right ? right - c.right : 0
    const up = c.bottom > window.innerHeight - 8 && w.top - c.height >= 8
    setPlace({ dx, up })
  }, [shown])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isModalOpen() || wrap.current?.closest('[inert]')) return
      e.preventDefault()
      e.stopPropagation()
      if (wrap.current?.contains(document.activeElement)) button.current?.focus()
      hide()
    }
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) hide()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [shown])

  return (
    <span
      ref={wrap}
      className="relative inline-flex p-1.5 -m-1.5 blink-once"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label="Why is this unreachable?"
        aria-expanded={shown}
        aria-controls={shown ? id : undefined}
        onClick={() => (open ? hide() : setOpen(true))}
        className="inline-flex text-current opacity-70 hover:opacity-100 focus-ring rounded-full"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {/*
        * The gap between the "?" and the card is padding on this wrapper, not margin outside it. With `mt-` the 6px was
        * dead space owned by neither element, so moving the mouse toward the card left the hover target and it closed
        * before you could reach the link.
        */}
      {shown && (
        <span
          ref={card}
          id={id}
          role="dialog"
          aria-label="Why is this unreachable?"
          data-dismissible="true"
          style={{ transform: `translateX(calc(-50% + ${place.dx}px))` }}
          className={`absolute left-1/2 ${place.up ? 'bottom-full pb-2' : 'top-full pt-2'} z-30 w-80 max-w-[calc(100vw-16px)]`}
        >
          <span className="block p-2.5 rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035] shadow-lg text-[0.6875rem] font-normal text-[#495057] dark:text-slate-300 space-y-1.5">
            {children(closeFromCard)}
          </span>
        </span>
      )}
    </span>
  )
}

/**
 * Traceroute output, as an overlay dialog.
 *
 * Rendered through a portal with a dimmed backdrop, like the app's other
 * dialogs. A trace takes seconds to run and is output you read and copy into a
 * ticket, so it wants the foreground and an explicit dismissal - an anchored
 * popover read as a passing notification, and inline it pushed the page down and
 * moved what the reader was looking at.
 *
 * Not a confirmation and not a mutation: nothing here changes anything, so it
 * does not belong in ConfirmContext.
 */
const TraceDialog: React.FC<{ r: Reachability; ip?: string }> = ({ r, ip }) => {
  const { hops, tracing, clearHops } = r
  const open = r.supported && (tracing || !!hops)

  if (!open) return null

  return (
    <Modal
      title="Route from this machine"
      icon={Route}
      headTone="text-[#212529] dark:text-white [&>svg]:text-fg-link"
      onClose={clearHops}
      size="sm"
      footer={
        <div className="px-4 py-2.5 text-[0.6875rem] text-fg-muted dark:text-slate-400">
          A <span className="font-mono">*</span> is a hop that did not answer, which is normal. Paste this into a
          support ticket to show where the path stops.
        </div>
      }
    >
      <div className="p-4">
        {tracing && (
          <p className="flex items-center gap-2 text-xs text-fg-muted dark:text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Tracing to {ip}…
          </p>
        )}

        {!tracing && hops && hops.length > 0 && (
          <table className="text-xs font-mono w-full">
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {hops.map((h) => (
                <tr key={h.hop} className="text-[#495057] dark:text-slate-300">
                  <td className="py-1 pr-3 text-right w-8 text-fg-muted dark:text-slate-500">{h.hop}</td>
                  <td className="py-1 pr-3">{h.timedOut ? '*' : h.host || '—'}</td>
                  <td className="py-1 text-right whitespace-nowrap">{h.latencyMs !== undefined ? `${h.latencyMs} ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!tracing && hops && hops.length === 0 && (
          <p className="text-xs text-fg-muted dark:text-slate-400">Traceroute returned nothing — the system tool may be unavailable here.</p>
        )}
      </div>
    </Modal>
  )
}
