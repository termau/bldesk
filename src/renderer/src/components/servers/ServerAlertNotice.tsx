import React from 'react'
import { AlertCircle } from 'lucide-react'
import { useFleetThresholdAlerts, type FleetAlertDetail } from '../../api/queries'
import type { BinaryLaneClient } from '../../api/client'
import { alertCountLabel, describeReachedAlert, raisedAlerts, type RaisedAlert } from '../../lib/thresholdAlerts'

/** What a server page knows about its threshold alerts: BinaryLane lists the server, and `detail` is its own alert list. */
export interface ServerAlertNotice {
  detail: FleetAlertDetail | undefined
  /** The alerts at or over their threshold; null while the server's own alert list is loading or could not be read. */
  raised: RaisedAlert[] | null
}

/**
 * Whether BinaryLane lists this server as having a current exceeded threshold alert, and which alerts. null when it does not.
 * The same two reads as the Fleet heatmap's marker, so both share a cache; a failed read shows nothing here rather than a
 * warning on every server page.
 */
export function useServerAlertNotice(client: BinaryLaneClient | null, serverId: number): ServerAlertNotice | null {
  const fleet = useFleetThresholdAlerts(client, [serverId])
  if (!fleet.ids.includes(serverId)) return null
  const detail = fleet.details.get(serverId)
  return { detail, raised: detail?.status === 'ready' ? raisedAlerts(detail.alerts) : null }
}

const SUMMARY_FALLBACK = 'BinaryLane reports a threshold alert on this server'

/** The yellow "1 alert triggered" pill under the server's name, like mPanel's: it opens that server's Alerts settings. */
export const ServerAlertPill: React.FC<{ notice: ServerAlertNotice; onOpen: () => void }> = ({ notice, onOpen }) => {
  const label = alertCountLabel(notice.raised)
  const detail = notice.raised && notice.raised.length > 0 ? notice.raised.map(describeReachedAlert).join('; ') : SUMMARY_FALLBACK
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${detail}. Open the alert settings.`}
      aria-label={`${label}: ${detail}. Open the alert settings.`}
      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25 [@media(pointer:coarse)]:py-2"
    >
      <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  )
}

/** The yellow banner at the top of the Alerts settings, one line per alert, in mPanel's words. */
export const ServerAlertBanner: React.FC<{ notice: ServerAlertNotice }> = ({ notice }) => {
  const { detail, raised } = notice
  // Nothing to say while the server's own alerts are still loading.
  if (!detail || detail.status === 'loading') return null
  const lines = raised && raised.length > 0
    ? raised.map(describeReachedAlert)
    : detail.status === 'failed'
      ? [`${SUMMARY_FALLBACK}, but its alert details could not be loaded${detail.error ? `: ${detail.error}` : '.'}`]
      : [`${SUMMARY_FALLBACK}, but none of its enabled alerts is at its threshold in the latest reading.`]
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-0.5 font-medium">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  )
}
