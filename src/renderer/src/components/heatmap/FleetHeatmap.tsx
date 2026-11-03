import { HelpLink } from '../ui/HelpLink'
import React, { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ChartNoAxesCombined, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { useFleetMetrics, useFleetThresholdAlerts } from '../../api/queries'
import { buildHeatmapRows, formatRate, sortHeatmapRows, type HeatmapCell, type HeatmapMetric, type HeatmapSort } from '../../lib/heatmap'
import { MEMORY_GRAPH_KB } from '../../lib/metrics'
import { describeStatus } from '../../lib/serverStatus'
import { ThresholdAlertMarker } from './ThresholdAlertMarker'

type Server = components['schemas']['Server']

interface Props {
  client: BinaryLaneClient | null
  servers: Server[]
  serversLoading: boolean
  onSelectServer: (server: Server) => void
  /** Opens the server's alert settings, from the alert marker. */
  onOpenAlerts: (server: Server) => void
}

const COLUMNS: Array<{ key: HeatmapMetric; label: string; kind: 'ratio' | 'rate' }> = [
  { key: 'cpu', label: 'CPU', kind: 'ratio' },
  { key: 'ram', label: 'RAM', kind: 'ratio' },
  { key: 'disk', label: 'Disk', kind: 'ratio' },
  { key: 'netIn', label: 'Net in', kind: 'rate' },
  { key: 'netOut', label: 'Net out', kind: 'rate' },
  { key: 'ioRead', label: 'IO read', kind: 'rate' },
  { key: 'ioWrite', label: 'IO write', kind: 'rate' }
]

/** Cool is near-neutral on purpose: a heatmap only works if the hot cells are the ones that draw the eye. */
const BUCKET_CLASS = [
  'bg-[#f1f3f5] text-[#6c757d] dark:bg-white/5 dark:text-slate-400',
  'bg-sky-500/15 text-sky-900 dark:bg-sky-400/20 dark:text-sky-100',
  'bg-amber-400/40 text-amber-950 dark:bg-amber-400/30 dark:text-amber-50',
  'bg-orange-500/55 text-orange-950 dark:bg-orange-500/50 dark:text-orange-50',
  'bg-rose-600/80 text-white dark:bg-rose-600/70'
]

/** Row-wide states: every metric cell would say the same thing, so say it once. */
const SPAN_STATES = new Set(['off', 'error', 'no-sample', 'pending', 'capacity-unknown'])
const SPAN_LABEL: Record<string, (tooltip: string) => string> = {
  off: (t) => `${t} — no metrics while the server is not running`,
  error: (t) => `Metrics request failed: ${t}`,
  'no-sample': () => 'No samples yet — BinaryLane publishes the first one a few minutes after boot',
  pending: () => 'Loading…',
  'capacity-unknown': () => 'Capacity unknown for this server'
}

function Cell({ cell, kind }: { cell: HeatmapCell; kind: 'ratio' | 'rate' }) {
  if (cell.state === 'off') return <td className="px-2 py-2 text-center text-xs text-slate-400" title={cell.tooltip}>{cell.tooltip}</td>
  if (cell.state === 'error') return <td className="px-2 py-2 text-center text-xs text-rose-500" title={cell.tooltip}>Error</td>
  if (cell.state === 'not-reported') return <td className="px-2 py-2 text-center text-xs text-slate-500" title={cell.tooltip}>Not reported</td>
  if (cell.state === 'no-sample') return <td className="px-2 py-2 text-center text-xs text-slate-500" title={cell.tooltip}>No samples yet</td>
  if (cell.state === 'pending') return <td className="px-2 py-2 text-center text-xs text-slate-400" title="Loading">…</td>
  if (cell.state === 'capacity-unknown') return <td className="px-2 py-2 text-center text-xs text-slate-500" title={cell.tooltip}>Capacity unknown</td>
  const value = kind === 'ratio' ? `${Math.round((cell.ratio ?? 0) * 100)}%` : formatRate(cell.raw ?? 0)
  return (
    <td className="p-1.5" title={cell.tooltip}>
      <div className={`min-w-[78px] rounded px-2 py-2 text-center text-xs font-semibold ${BUCKET_CLASS[cell.bucket ?? 0]} ${cell.state === 'stale' ? 'opacity-50' : ''}`}>
        {value}{cell.state === 'stale' && <span className="block text-[9px] font-normal">stale</span>}
      </div>
    </td>
  )
}

export const FleetHeatmap: React.FC<Props> = ({ client, servers, serversLoading, onSelectServer, onOpenAlerts }) => {
  const activeIds = useMemo(() => servers.filter((server) => server.status === 'active').map((server) => server.id), [servers])
  const fleet = useFleetMetrics(client, activeIds)
  // BinaryLane can list a stopped server too (a locked backup slot alerts whatever the power state), so every row is asked about, not only the ones with metrics.
  const allIds = useMemo(() => servers.map((server) => server.id), [servers])
  const alerts = useFleetThresholdAlerts(client, allIds)
  const [sort, setSort] = useState<HeatmapSort>('name')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const rows = useMemo(
    () => sortHeatmapRows(buildHeatmapRows(servers, fleet.data ?? new Map()), sort, direction),
    [servers, fleet.data, sort, direction]
  )
  const activeResults = activeIds.map((id) => fleet.data?.get(id)).filter((result) => result != null)
  const allFailed = activeIds.length > 0 && activeResults.length === activeIds.length && activeResults.every((result) => result.error)
  const firstError = activeResults.find((result) => result.error)?.error
  const hasPending = !!client && !fleet.data && (fleet.isLoading || fleet.fetchStatus === 'fetching')

  const chooseSort = (next: HeatmapSort) => {
    if (sort === next) setDirection((value) => value === 'asc' ? 'desc' : 'asc')
    else { setSort(next); setDirection('asc') }
  }
  const SortIcon = direction === 'asc' ? ArrowUp : ArrowDown
  const header = (key: HeatmapSort, label: string) => (
    <button type="button" onClick={() => chooseSort(key)} className="inline-flex items-center gap-1 hover:text-[#017cb6]">
      {label}{sort === key && <SortIcon className="h-3 w-3" />}
    </button>
  )

  return (
    <div className="h-full min-w-0 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#212529] dark:text-white flex items-center gap-2"><ChartNoAxesCombined className="w-5 h-5 text-[#017cb6]" />Fleet Heatmap</h2>
            <p className="text-xs text-[#6c757d] dark:text-slate-400">Live utilisation: CPU, RAM and disk against each server's own capacity; network and IO rates against the busiest server in the fleet right now.</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#6c757d] dark:text-slate-400">
            <span>Updated {fleet.dataUpdatedAt ? new Date(fleet.dataUpdatedAt).toLocaleTimeString() : 'not yet'}</span>
            <button onClick={() => void Promise.all([fleet.refetch(), alerts.refresh()])} disabled={fleet.isFetching} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#ced4da] dark:border-[#495057] hover:border-[#017cb6] disabled:opacity-50 text-[#212529] dark:text-white">
              <RefreshCw className={`h-3.5 w-3.5 ${fleet.isFetching ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <HelpLink slug="heatmap" />
          </div>
        </div>

        {allFailed && <div className="flex items-center gap-2 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300"><AlertTriangle className="h-4 w-4" />Metrics could not be loaded for any server{firstError ? `: ${firstError}` : '.'}</div>}
        {alerts.error && <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" />Threshold alert status could not be loaded ({alerts.error}), so a server without an alert marker may still have one.</div>}
        {(serversLoading || (hasPending && activeIds.length > 0)) && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading fleet metrics…</div>}
        {!serversLoading && (!client || (!fleet.isLoading && servers.length === 0)) && <div className="rounded border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 dark:border-slate-600">No servers to display.</div>}

        {!serversLoading && !!client && servers.length > 0 && (
          <div className="min-w-0 overflow-x-auto rounded-lg border border-[#ced4da] bg-white shadow-sm dark:border-[#373b3e] dark:bg-[#2b3035]">
            <table className="w-full min-w-[1050px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-[#f8f9fa] text-[10px] font-semibold uppercase tracking-wider text-[#6c757d] dark:bg-[#212529] dark:text-slate-400">
                <tr>
                  <th className="px-3 py-3" aria-sort={sort === 'name' ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>{header('name', 'Server')}</th>
                  <th className="px-3 py-3" aria-sort={sort === 'region' ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>{header('region', 'Region')}</th>
                  {COLUMNS.map((column) => <th key={column.key} className="px-2 py-3 text-center" aria-sort={sort === column.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>{header(column.key, column.label)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e9ecef] dark:divide-[#373b3e]">
                {rows.map((row) => {
                  const status = describeStatus(row.server.status)
                  const rowState = row.cells.cpu.state
                  const spans = SPAN_STATES.has(rowState) && COLUMNS.every((column) => row.cells[column.key].state === rowState)
                  return (
                  <tr
                    key={row.server.id}
                    onClick={() => onSelectServer(row.server)}
                    className="cursor-pointer hover:bg-[#f8f9fa] dark:hover:bg-white/5"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-medium">
                      <button
                        type="button"
                        aria-label={`Open usage metrics for ${row.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelectServer(row.server)
                        }}
                        className="rounded text-left focus:outline-none focus:ring-2 focus:ring-[#017cb6]"
                      >
                        <span className={`mr-2 inline-block h-2 w-2 rounded-full ${status.dot}`} />{row.name}
                        <span className="ml-2 text-[10px] font-normal text-slate-400">{status.label}</span>
                      </button>
                      {alerts.ids.includes(row.server.id) && (
                        <ThresholdAlertMarker serverName={row.name} detail={alerts.details.get(row.server.id)} onOpenSettings={() => onOpenAlerts(row.server)} />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-[#6c757d] dark:text-slate-400">{row.region}</td>
                    {spans
                      ? <td colSpan={COLUMNS.length} className={`px-3 py-2 text-center text-xs ${rowState === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-[#adb5bd] dark:text-slate-500'}`} title={row.cells.cpu.tooltip}>{SPAN_LABEL[rowState](row.cells.cpu.tooltip)}</td>
                      : COLUMNS.map((column) => <Cell key={column.key} cell={row.cells[column.key]} kind={column.kind} />)}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#6c757d] dark:text-slate-400">
          <span>Under 50%</span>{BUCKET_CLASS.map((className, index) => <span key={index} className={`h-4 w-8 rounded ${className}`} title={['under 50%', '50–70%', '70–85%', '85–95%', '95% and above'][index]} />)}<span>95%+</span>
          <span className="ml-2">Rate colours are relative to the fleet's current maximum, once it is above about 40 Mbit/s of network or 10 MB/s of disk; below that a quiet fleet stays neutral.</span>
          <button onClick={() => window.bldeskApi?.openExternal?.(MEMORY_GRAPH_KB)} className="inline-flex items-center gap-1 text-[#017cb6] hover:underline">Memory reporting help <ExternalLink className="h-3 w-3" /></button>
        </div>
      </div>
    </div>
  )
}
