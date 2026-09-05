import React, { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, HelpCircle, Loader2, RotateCw, Route, X } from 'lucide-react'
import type { TcpProbeResult, TracerouteHop } from '@shared/ipc-types'
import type { BinaryLaneClient } from '../../api/client'
import { useFirewallRules } from '../../api/queries'
import { Modal } from '../ui/Modal'
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
  const verdict = explainUnreachablePort(timedOut ? rulesQuery.data : undefined, port)

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

const pill = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium'

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
  onOpenFirewall?: () => void
}> = ({ r, ip, onOpenFirewall }) => {
  /*
   * Dismissal has to be state rather than CSS. Android leaves a sticky :hover
   * after a tap, so `group-hover` holds the card open however focus moves -
   * blurring alone looked right in a scripted test and did nothing on a finger.
   *
   * Declared above the early return: it is a hook.
   */
  const [dismissed, setDismissed] = useState(false)

  if (!r.supported || !ip) return null
  const { result, busy, port } = r
  const explanation = explainTimeout(r)

  const failed = !!result && !result.ok

  return (
    /*
     * `shrink-0` because the title row does not wrap: the hostname truncates to
     * make room, and the pill has to keep its full width or the "?" and the
     * re-check control are the first things squeezed out.
     */
    <span className="inline-flex shrink-0 items-center gap-2">
      {/* No result yet: the only time the pill is a placeholder. */}
      {!result && busy && (
        <span className={`${pill} bg-[#e9ecef] dark:bg-[#343a40] text-[#6c757d] dark:text-slate-400`}>
          <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          Checking {port}…
        </span>
      )}

      {result?.ok && (
        <span
          title={`TCP connect to port ${port} from this machine`}
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
            <span
              key={r.seq}
              className="relative group inline-flex p-1.5 -m-1.5 blink-once"
            >
              <button
                type="button"
                aria-label="Why is this unreachable?"
                onClick={(e) => {
                  // Focus explicitly: after a dismissal the card needs hover or
                  // focus to come back, and a tap gives neither reliably.
                  setDismissed(false)
                  e.currentTarget.focus()
                }}
                className="inline-flex text-current opacity-70 hover:opacity-100"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
              {/*
                * The gap between the "?" and the card is padding on this wrapper,
                * not margin outside it. With `mt-` the 6px was dead space owned
                * by neither element, so moving the mouse toward the card left the
                * hover target and it closed before you could reach the link.
                */}
              {/* focus-within as well as hover: a hover-only tooltip is
                  unreachable by keyboard, and the card holds the only route to
                  the firewall link and the traceroute action. */}
              {!dismissed && (
              <span
                role="tooltip"
                className="pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto invisible group-hover:visible group-focus-within:visible opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition pt-2 z-30 w-[min(20rem,calc(100vw-1.5rem))] fixed left-1/2 -translate-x-1/2 top-28 sm:absolute sm:top-full sm:translate-x-[-50%]"
              >
                <span className="block relative p-2.5 rounded border border-[#ced4da] dark:border-[#373b3e] bg-white dark:bg-[#2b3035] shadow-lg text-[11px] font-normal text-[#495057] dark:text-slate-300 space-y-1.5">
                {/*
                  * A touch has no hover to leave. The card opens on focus and
                  * would otherwise sit there until you found something else to
                  * tap, so it needs a way out: blurring drops focus-within and
                  * closes it.
                  */}
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    setDismissed(true)
                    ;(document.activeElement as HTMLElement | null)?.blur()
                  }}
                  className="absolute top-1 right-1 p-1 text-[#6c757d] hover:text-[#212529] dark:hover:text-white sm:hidden"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <span className="block pr-5">{explanation}</span>
                <span className="flex items-center gap-3">
                  {onOpenFirewall && r.verdict.kind === 'blocked' && (
                    <button type="button" onClick={onOpenFirewall} className="text-[#017cb6] hover:underline">
                      Open firewall rules
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void r.runTrace()}
                    disabled={r.tracing}
                    className="inline-flex items-center gap-1 text-[#017cb6] hover:underline disabled:opacity-50"
                  >
                    {r.tracing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Route className="w-3 h-3" />}
                    <span>{r.tracing ? 'Tracing…' : 'Trace route'}</span>
                  </button>
                </span>
                </span>
              </span>
              )}
            </span>
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
      headTone="text-[#212529] dark:text-white [&>svg]:text-[#017cb6]"
      onClose={clearHops}
      size="sm"
      labelledBy="trace-title"
      footer={
        <div className="px-4 py-2.5 text-[11px] text-[#6c757d] dark:text-slate-400">
          A <span className="font-mono">*</span> is a hop that did not answer, which is normal. Paste this into a
          support ticket to show where the path stops.
        </div>
      }
    >
      <div className="p-4">
        {tracing && (
          <p className="flex items-center gap-2 text-xs text-[#6c757d] dark:text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Tracing to {ip}…
          </p>
        )}

        {!tracing && hops && hops.length > 0 && (
          <table className="text-xs font-mono w-full">
            <tbody className="divide-y divide-[#ced4da]/60 dark:divide-[#373b3e]">
              {hops.map((h) => (
                <tr key={h.hop} className="text-[#495057] dark:text-slate-300">
                  <td className="py-1 pr-3 text-right w-8 text-[#6c757d] dark:text-slate-500">{h.hop}</td>
                  <td className="py-1 pr-3">{h.timedOut ? '*' : h.host || '—'}</td>
                  <td className="py-1 text-right whitespace-nowrap">{h.latencyMs !== undefined ? `${h.latencyMs} ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!tracing && hops && hops.length === 0 && (
          <p className="text-xs text-[#6c757d] dark:text-slate-400">Traceroute returned nothing — the system tool may be unavailable here.</p>
        )}
      </div>
    </Modal>
  )
}
