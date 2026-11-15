import React, { memo, useState, useMemo } from 'react'
import {
  Loader2,
  Calendar,
  Info,
  Activity, AlertTriangle, ExternalLink} from 'lucide-react'
import { components } from '@shared/api/schema'
import { BinaryLaneClient } from '../../api/client'
import { useSampleSets, useServerMetrics } from '../../api/queries'
import { MEMORY_GRAPH_KB } from '../../lib/metrics'

type Server = components['schemas']['Server']
type SampleSet = components['schemas']['SampleSet']

interface ServerUsageProps {
  client: BinaryLaneClient | null
  server: Server
}

type TimeWindow = 'Day' | 'Week' | 'Month' | 'Year'

interface DataPoint {
  time: number
  value: number
}

interface MetricSummary {
  data: DataPoint[]
  avg: number
  max: number
  current: number
}

function emptySummary(): MetricSummary {
  return { data: [], avg: 0, max: 0, current: 0 }
}

function pushSample(summary: MetricSummary, time: number, val: number) {
  summary.avg = summary.data.length === 0 ? val : (summary.avg * summary.data.length + val) / (summary.data.length + 1)
  summary.max = Math.max(summary.max, val)
  summary.current = val
  summary.data.push({ time, value: val })
}

// Formatters
const fmtPercent = (v: number) => `${(v).toFixed(1)}%`
const fmtGB = (v: number) => `${(v).toFixed(2)} GB`
const fmtKBpsOrMBps = (v: number) => {
  if (v >= 1024) {
    return `${(v / 1024).toFixed(2)} MBps`
  }
  return `${v.toFixed(2)} KBps`
}
const fmtRps = (v: number) => `${Math.round(v)} rps`

/**
 * Series sharing a unit share a scale; different units get their own.
 *
 * The chart previously had two fixed axes and put CPU (%), network (KBps) and
 * disk throughput (KBps) on the same one, capped at 100. Disk activity of a few
 * thousand KBps clamped to the ceiling while CPU at 2% sat on the floor, and the
 * axis was labelled "%" while carrying three different units. Grouping by unit
 * keeps like-for-like series comparable — four CPU cores still share one scale —
 * without squashing a percentage against a data rate.
 */
type ChartUnit = 'percent' | 'gb' | 'rate' | 'rps'

interface ChartSeries {
  name: string
  color: string
  summary: MetricSummary
  formatter: (v: number) => string
  unit: ChartUnit
  maxScale?: number
  /** Render this unit's axis labels on the right edge rather than the left. */
  isSecondaryAxis?: boolean
}

/**
 * Marker size for a series' data points.
 *
 * A day at five-minute resolution is ~288 points across an 800-unit viewBox, so
 * they sit roughly 2.8 units apart: anything larger than a pixel merges into a
 * band, and the dark outline each marker used to carry turned that band into
 * visible noise. Sparse windows keep readable dots; above MAX_MARKERS a series
 * draws none (the line carries the shape, and one element per sample per series
 * was the bulk of the chart's DOM). The hover readout gives every point's value.
 */
const MAX_MARKERS = 120
function markerRadius(count: number): number {
  if (count <= 12) return 3
  if (count <= 40) return 2
  return 1.4
}

/** The point of a series nearest a time; samples are few enough per series to scan. */
function nearestPoint(data: DataPoint[], time: number): DataPoint | undefined {
  let best: DataPoint | undefined
  for (const p of data) if (!best || Math.abs(p.time - time) < Math.abs(best.time - time)) best = p
  return best
}

/**
 * One readout for the whole chart: a guide line at the sample nearest the pointer, with every series' value there.
 * Its own component, so moving the pointer re-renders this and not the lines and axes.
 */
const ChartHover: React.FC<{
  seriesList: ChartSeries[]
  x0: number
  x1: number
  y0: number
  y1: number
  minTime: number
  timeSpan: number
  getY: (value: number, s: ChartSeries) => number
}> = ({ seriesList, x0, x1, y0, y1, minTime, timeSpan, getY }) => {
  const [time, setTime] = useState<number | null>(null)
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const ctm = e.currentTarget.ownerSVGElement?.getScreenCTM()
    if (!ctm) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    setTime(minTime + ((Math.min(Math.max(p.x, x0), x1) - x0) / (x1 - x0)) * timeSpan)
  }
  const rows = time == null ? [] : seriesList.flatMap((s) => {
    const p = nearestPoint(s.summary.data, time)
    return p ? [{ s, p }] : []
  })
  const at = rows[0]?.p.time
  const x = at == null ? 0 : x0 + ((at - minTime) / timeSpan) * (x1 - x0)
  const lines = at == null ? [] : [
    new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    ...rows.map(({ s, p }) => `${s.name}: ${s.formatter(p.value)}`)
  ]
  const boxW = Math.max(...lines.map((l) => l.length), 0) * 5.4 + 14
  const boxH = lines.length * 11 + 8
  const boxX = x > (x0 + x1) / 2 ? x - boxW - 8 : x + 8
  return (
    <g>
      {at != null && (
        <g pointerEvents="none">
          <line x1={x} y1={y0} x2={x} y2={y1} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3,3" />
          {rows.map(({ s, p }) => (
            <circle key={s.name} cx={x0 + ((p.time - minTime) / timeSpan) * (x1 - x0)} cy={getY(p.value, s)} r={3} fill={s.color} stroke="#1e2227" strokeWidth="1" />
          ))}
          <rect x={boxX} y={y0} width={boxW} height={boxH} rx={4} fill="#111418" fillOpacity="0.92" stroke="#373b3e" />
          {lines.map((l, i) => (
            <text key={i} x={boxX + 7} y={y0 + 13 + i * 11} fontSize="9" fontFamily="monospace" fill={i === 0 ? '#94a3b8' : rows[i - 1].s.color}>
              {l}
            </text>
          ))}
        </g>
      )}
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setTime(null)} />
    </g>
  )
}

/** Axis tick text for a unit; rates switch to MBps once they get large. */
function axisLabel(unit: ChartUnit, value: number): string {
  if (unit === 'rate') {
    return value >= 1024 ? `${(value / 1024).toFixed(1)} MBps` : `${Math.round(value)} KBps`
  }
  if (unit === 'gb') return `${value.toFixed(value < 10 ? 1 : 0)} GB`
  if (unit === 'rps') return `${Math.round(value)} rps`
  return `${Math.round(value)}%`
}

// High-fidelity SVG Multi-Series Line Chart
// Memoised: the page re-renders on every poll status change, and a chart can hold thousands of points.
const UsageSvgChart = memo(function UsageSvgChart({ title, subtitle, seriesList, window, scaleBy = 'unit' }: {
  title: string
  subtitle: string
  seriesList: ChartSeries[]
  window: TimeWindow
  /**
   * 'unit' keeps like-for-like series on one scale so they stay comparable —
   * right for CPU cores or network in/out. 'series' gives every metric its own
   * scale, which is what a mixed overview needs: a 0.5 KBps network line and a
   * 2.4 MBps disk line are both data rates, but sharing a scale hides one.
   */
  scaleBy?: 'unit' | 'series'
}) {
  const width = 800
  const height = 220
  const padding = { top: 20, right: 72, bottom: 30, left: 72 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  // Determine time bounds
  const allTimes = useMemo(() => {
    const times: number[] = []
    seriesList.forEach((s) => s.summary.data.forEach((d) => times.push(d.time)))
    return times
  }, [seriesList])

  const now = Date.now()
  const windowDurationMs = useMemo(() => {
    switch (window) {
      case 'Day':
        return 24 * 60 * 60 * 1000
      case 'Week':
        return 7 * 24 * 60 * 60 * 1000
      case 'Month':
        return 30 * 24 * 60 * 60 * 1000
      case 'Year':
        return 365 * 24 * 60 * 60 * 1000
    }
  }, [window])

  const maxTime = now
  const minTime = now - windowDurationMs
  const timeSpan = maxTime - minTime || 1

  /**
   * One scale per unit present, so a percentage is never measured against a data
   * rate. Series of the same unit keep a shared scale and stay comparable.
   */
  const scaleKey = (s: ChartSeries) => (scaleBy === 'series' ? s.name : s.unit)

  const unitScales = useMemo(() => {
    const groups = new Map<string, { unit: ChartUnit; max: number; color: string; side: 'left' | 'right' }>()
    for (const s of seriesList) {
      const peak = s.maxScale ?? s.summary.max
      const key = scaleBy === 'series' ? s.name : s.unit
      const existing = groups.get(key)
      if (existing) {
        existing.max = Math.max(existing.max, peak)
      } else {
        groups.set(key, {
          unit: s.unit,
          max: peak,
          color: s.color,
          side: s.isSecondaryAxis ? 'right' : 'left'
        })
      }
    }
    for (const g of groups.values()) {
      if (g.unit === 'percent') {
        // Percentages keep a 0-100 frame unless a multi-core total exceeds it.
        g.max = g.max <= 100 ? 100 : Math.ceil(g.max / 100) * 100
      } else {
        // Headroom so a peak never touches the top gridline; never zero.
        g.max = g.max > 0 ? g.max * 1.15 : 1
      }
    }
    return groups
  }, [seriesList, scaleBy])

  const leftScales = useMemo(() => [...unitScales.values()].filter((g) => g.side === 'left'), [unitScales])
  const rightScales = useMemo(() => [...unitScales.values()].filter((g) => g.side === 'right'), [unitScales])

  // X Coordinate calculation
  const getX = (t: number) => padding.left + ((t - minTime) / timeSpan) * chartW

  // Y Coordinate calculation, against the series' own unit scale
  const getY = (val: number, key: string) => {
    const maxVal = unitScales.get(key)?.max || 1
    const clamped = Math.max(0, Math.min(val, maxVal))
    return padding.top + chartH - (clamped / maxVal) * chartH
  }

  // Time grid ticks
  const timeTicks = useMemo(() => {
    const count = 6
    const ticks: { time: number; label: string }[] = []
    for (let i = 0; i <= count; i++) {
      const t = minTime + (timeSpan * i) / count
      const d = new Date(t)
      let label = ''
      if (window === 'Day') {
        label = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      } else if (window === 'Week') {
        label = d.toLocaleDateString([], { weekday: 'short', hour: 'numeric' })
      } else {
        label = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      }
      ticks.push({ time: t, label })
    }
    return ticks
  }, [minTime, timeSpan, window])

  const hasData = allTimes.length > 0

  return (
    <div className="bg-[#1e2227] text-slate-200 rounded-lg border border-[#373b3e] p-4 shadow-sm space-y-3">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-[#373b3e]/80 pb-2.5">
        <div>
          <h4 className="font-semibold text-xs text-white flex items-center gap-2">{title}</h4>
          <span className="text-[0.6875rem] text-slate-400 font-mono">{subtitle}</span>
        </div>
        <span className="text-[0.625rem] text-slate-400 self-end sm:self-auto font-mono">
          {window === 'Day'
            ? '5 minute average'
            : window === 'Week'
              ? '30 minute average'
              : window === 'Month'
                ? '4 hour average'
                : '24 hour average'}
        </span>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none" style={{ maxHeight: 260 }}>
          {/* Background Grid Lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
            const y = padding.top + chartH * pct
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#373b3e"
                  strokeWidth="1"
                  strokeDasharray={pct === 1 ? 'none' : '2,2'}
                />
                {/* One label per unit, stacked and coloured to match its series,
                    so each scale is readable rather than implied. Only the top,
                    middle and bottom rows are labelled to avoid a wall of text. */}
                {[0, 0.5, 1].includes(pct) &&
                  leftScales.map((g, gi) => (
                    <text
                      key={`l-${gi}-${g.unit}`}
                      x={padding.left - 8}
                      y={y + 3 + (gi - (leftScales.length - 1) / 2) * 10}
                      textAnchor="end"
                      fill={g.color}
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      {axisLabel(g.unit, g.max * (1 - pct))}
                    </text>
                  ))}
                {[0, 0.5, 1].includes(pct) &&
                  rightScales.map((g, gi) => (
                    <text
                      key={`r-${gi}-${g.unit}`}
                      x={width - padding.right + 8}
                      y={y + 3 + (gi - (rightScales.length - 1) / 2) * 10}
                      textAnchor="start"
                      fill={g.color}
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      {axisLabel(g.unit, g.max * (1 - pct))}
                    </text>
                  ))}
              </g>
            )
          })}

          {/* Time Ticks */}
          {timeTicks.map((tick, i) => {
            const x = getX(tick.time)
            return (
              <g key={i}>
                <line
                  x1={x}
                  y1={padding.top}
                  x2={x}
                  y2={padding.top + chartH}
                  stroke="#373b3e"
                  strokeWidth="0.5"
                  strokeDasharray="2,2"
                />
                <text
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="9"
                  fontFamily="sans-serif"
                >
                  {tick.label}
                </text>
              </g>
            )
          })}

          {/* Plotted Series Lines and Data Points */}
          {seriesList.map((s, idx) => {
            const points = s.summary.data
            if (!points || points.length === 0) return null

            let path = ''
            if (points.length === 1) {
              const y = getY(points[0].value, scaleKey(s))
              path = `M ${padding.left} ${y.toFixed(1)} L ${(width - padding.right).toFixed(1)} ${y.toFixed(1)}`
            } else {
              path = points
                .map((p, i) => {
                  const x = getX(p.time)
                  const y = getY(p.value, scaleKey(s))
                  return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
                })
                .join(' ')
            }

            return (
              <g key={idx}>
                <path
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={points.length === 1 ? '4,4' : 'none'}
                />
                {points.length <= MAX_MARKERS &&
                  points.map((p, pIdx) => (
                    <circle key={pIdx} cx={getX(p.time)} cy={getY(p.value, scaleKey(s))} r={markerRadius(points.length)} fill={s.color} />
                  ))}
              </g>
            )
          })}

          {hasData && (
            <ChartHover
              seriesList={seriesList}
              x0={padding.left}
              x1={width - padding.right}
              y0={padding.top}
              y1={padding.top + chartH}
              minTime={minTime}
              timeSpan={timeSpan}
              getY={(value, s) => getY(value, scaleKey(s))}
            />
          )}
        </svg>
      </div>

      {/* Interactive Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-1">
        {seriesList.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="text-slate-300 text-[0.6875rem] font-medium">{s.name}</span>
          </div>
        ))}
      </div>

      {/* Summary Statistics Table */}
      <div className="overflow-x-auto border-t border-[#373b3e]/80 pt-3">
        <table className="w-full text-left text-xs border-collapse font-sans">
          <thead>
            <tr className="text-slate-400 border-b border-[#373b3e]/60 text-[0.6875rem]">
              <th className="py-1 px-3 font-medium">Metric</th>
              <th className="py-1 px-3 font-medium">Average</th>
              <th className="py-1 px-3 font-medium">Maximum</th>
              <th className="py-1 px-3 font-medium">Current</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#373b3e]/40 font-mono text-[0.6875rem]">
            {seriesList.map((s, i) => (
              <tr key={i} className="hover:bg-[#262c33] transition">
                <td className="py-1.5 px-3 font-sans text-slate-200 flex items-center gap-2">
                  <span className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span>{s.name}</span>
                </td>
                <td className="py-1.5 px-3 text-slate-300">{s.formatter(s.summary.avg)}</td>
                <td className="py-1.5 px-3 text-slate-300">{s.formatter(s.summary.max)}</td>
                <td className="py-1.5 px-3 text-slate-200 font-semibold">{s.formatter(s.summary.current)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!hasData && (
        <div className="p-3 bg-[#262c33] rounded border border-[#373b3e] text-center text-xs text-slate-400 flex items-center justify-center gap-2">
          <Info className="w-4 h-4 text-fg-link" />
          <span>Collecting telemetry samples for this interval... Data updates every 30s.</span>
        </div>
      )}
    </div>
  )
})

export const ServerUsage: React.FC<ServerUsageProps> = ({ client, server }) => {
  const [activeWindow, setActiveWindow] = useState<TimeWindow>('Day')

  const { interval, windowMs } = useMemo(() => {
    let windowMs: number
    let durationType: 'five-minute' | 'half-hour' | 'four-hour' | 'day'

    switch (activeWindow) {
      case 'Day':
        windowMs = 24 * 60 * 60 * 1000
        durationType = 'five-minute'
        break
      case 'Week':
        windowMs = 7 * 24 * 60 * 60 * 1000
        durationType = 'half-hour'
        break
      case 'Month':
        windowMs = 30 * 24 * 60 * 60 * 1000
        durationType = 'four-hour'
        break
      case 'Year':
        windowMs = 365 * 24 * 60 * 60 * 1000
        durationType = 'day'
        break
    }
    return { interval: durationType, windowMs }
  }, [activeWindow])

  const samplesQuery = useSampleSets(client, server.id, interval, windowMs)
  const latestMetricsQuery = useServerMetrics(client, server.id)

  const samples = useMemo(() => {
    const historical = (samplesQuery.data || []) as SampleSet[]
    if (latestMetricsQuery.data) {
      const latest = latestMetricsQuery.data
      const latestTime = latest.period?.start ? new Date(latest.period.start).getTime() : Date.now()
      const alreadyHas = historical.some((h) => new Date(h.period?.start).getTime() === latestTime)
      if (!alreadyHas) {
        return [...historical, latest].sort(
          (a, b) => new Date(a.period.start).getTime() - new Date(b.period.start).getTime()
        )
      }
    }
    return historical
  }, [samplesQuery.data, latestMetricsQuery.data])

  // Compute metric series
  const metricSummaries = useMemo(() => {
    const cpuOverall = emptySummary()
    const cpuCores: MetricSummary[] = []
    const memory = emptySummary()
    const diskUsage = emptySummary()
    const diskActivity = emptySummary()
    const diskRead = emptySummary()
    const diskWrite = emptySummary()
    const diskReadOps = emptySummary()
    const diskWriteOps = emptySummary()
    const networkActivity = emptySummary()
    const networkIn = emptySummary()
    const networkOut = emptySummary()

    samples.forEach((sample) => {
      const time = new Date(sample.period?.start || Date.now()).getTime()

      // CPU Percentage (0-100)
      if (sample.average?.cpu_usage_percent !== undefined) {
        pushSample(cpuOverall, time, sample.average.cpu_usage_percent)
      }
      if (sample.average?.cpu_usage_detailed) {
        sample.average.cpu_usage_detailed.forEach((val, idx) => {
          if (!cpuCores[idx]) cpuCores[idx] = emptySummary()
          pushSample(cpuCores[idx], time, val)
        })
      }

      // Memory (bytes -> GB)
      // A server with no Memory Graph agent reports memory_usage_bytes as exactly 0,
      // not null or absent — verified against a Windows box without the agent while
      // its CPU and storage reported normally. Zero memory on a running server is
      // impossible, so it is a sentinel, not a reading. Plotting it drew a flat
      // zero line and printed "0.00 GB", asserting the server used no memory.
      const memBytes = sample.average?.memory_usage_bytes
      if (memBytes !== undefined && memBytes > 0) {
        pushSample(memory, time, memBytes / (1024 * 1024 * 1024))
      }

      // Disk Storage (MB -> GB)
      if (sample.average?.storage_usage_megabytes !== undefined) {
        const diskGB = sample.average.storage_usage_megabytes / 1024
        pushSample(diskUsage, time, diskGB)
      }

      // Disk Rates
      const readRate = sample.average?.storage_read_kbps || 0
      const writeRate = sample.average?.storage_write_kbps || 0
      pushSample(diskRead, time, readRate)
      pushSample(diskWrite, time, writeRate)
      pushSample(diskActivity, time, readRate + writeRate)

      // Disk IOPS
      pushSample(diskReadOps, time, sample.average?.storage_read_requests_per_second || 0)
      pushSample(diskWriteOps, time, sample.average?.storage_write_requests_per_second || 0)

      // Network Rates
      const netIn = sample.average?.network_incoming_kbps || 0
      const netOut = sample.average?.network_outgoing_kbps || 0
      pushSample(networkIn, time, netIn)
      pushSample(networkOut, time, netOut)
      pushSample(networkActivity, time, netIn + netOut)
    })

    return {
      cpuOverall,
      cpuCores,
      memory,
      diskUsage,
      diskActivity,
      diskRead,
      diskWrite,
      diskReadOps,
      diskWriteOps,
      networkActivity,
      networkIn,
      networkOut
    }
  }, [samples])

  const timeTabs: TimeWindow[] = ['Day', 'Week', 'Month', 'Year']

  // Built once per refresh of the samples, so the memoised charts below skip renders that change nothing they draw.
  const { memoryUnavailable, activitySeriesList, cpuDetailSeriesList, networkSeriesList, diskSeriesList } = useMemo(() => {
    // 1. Activity Overview Series List
    /**
     * Memory reporting depends on an in-guest agent, so it can be absent on an
     * otherwise healthy server. The API has no capability flag for it — /v2/software
     * lists only licensed products and has no Memory Graph entry — so absence is
     * inferred from having samples for other metrics but none for memory.
     */
    const memoryUnavailable =
      metricSummaries.memory.data.length === 0 && metricSummaries.diskUsage.data.length > 0

    const activityAllSeries: ChartSeries[] = [
      {
        name: 'CPU Usage',
        color: '#48bb78',
        summary: metricSummaries.cpuOverall,
        formatter: fmtPercent,
        unit: 'percent'
      },
      {
        name: 'Memory Usage',
        color: '#ecc94b',
        summary: metricSummaries.memory,
        formatter: fmtGB,
        unit: 'gb',
        isSecondaryAxis: true
      },
      {
        name: 'Disk Usage',
        color: '#38bdf8',
        summary: metricSummaries.diskUsage,
        formatter: fmtGB,
        unit: 'gb',
        isSecondaryAxis: true
      },
      {
        name: 'Network Activity',
        color: '#ed8936',
        summary: metricSummaries.networkActivity,
        formatter: fmtKBpsOrMBps,
        unit: 'rate'
      },
      {
        name: 'Disk Activity',
        color: '#f56565',
        summary: metricSummaries.diskActivity,
        formatter: fmtKBpsOrMBps,
        unit: 'rate'
      }
    ]

    // Drop the memory series entirely when the guest isn't reporting it, so the
    // chart, legend and summary table stay silent about it rather than showing zero.
    const activitySeriesList = activityAllSeries.filter(
      (sr) => !(memoryUnavailable && sr.name === 'Memory Usage')
    )

    // 2. CPU Detail Series List
    const cpuDetailSeriesList: ChartSeries[] = metricSummaries.cpuCores.map((core, i) => ({
      name: `CPU ${i + 1}`,
      color: ['#48bb78', '#38bdf8', '#ecc94b', '#ed8936', '#9f7aea', '#f56565'][i % 6],
      summary: core,
      formatter: fmtPercent,
        unit: 'percent'
    }))

    // 3. Network Detail Series List
    const networkSeriesList: ChartSeries[] = [
      {
        name: 'Network In',
        color: '#38bdf8',
        summary: metricSummaries.networkIn,
        formatter: fmtKBpsOrMBps,
        unit: 'rate'
      },
      {
        name: 'Network Out',
        color: '#ed8936',
        summary: metricSummaries.networkOut,
        formatter: fmtKBpsOrMBps,
        unit: 'rate'
      }
    ]

    // 4. Disk Detail Series List
    const diskSeriesList: ChartSeries[] = [
      {
        name: 'Disk Read Rate',
        color: '#38bdf8',
        summary: metricSummaries.diskRead,
        formatter: fmtKBpsOrMBps,
        unit: 'rate'
      },
      {
        name: 'Disk Write Rate',
        color: '#f56565',
        summary: metricSummaries.diskWrite,
        formatter: fmtKBpsOrMBps,
        unit: 'rate'
      },
      {
        name: 'Read IOPS',
        color: '#48bb78',
        summary: metricSummaries.diskReadOps,
        formatter: fmtRps,
        unit: 'rps'
      },
      {
        name: 'Write IOPS',
        color: '#ecc94b',
        summary: metricSummaries.diskWriteOps,
        formatter: fmtRps,
        unit: 'rps'
      }
    ]
    return { memoryUnavailable, activitySeriesList, cpuDetailSeriesList, networkSeriesList, diskSeriesList }
  }, [metricSummaries])

  return (
    <div className="space-y-5 select-text">
      {/* Time Range Selector Tabs */}
      <div className="flex items-center justify-between border-b border-[#ced4da] dark:border-[#373b3e] pb-2">
        <div className="flex items-center gap-1.5">
          {timeTabs.map((w) => {
            const isActive = activeWindow === w
            return (
              <button
                key={w}
                onClick={() => setActiveWindow(w)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                  isActive
                    ? 'bg-[#017cb6] text-white shadow-sm'
                    : 'text-fg-muted dark:text-slate-400 hover:text-[#212529] dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800'
                }`}
              >
                {w}
              </button>
            )
          })}
        </div>

        {samplesQuery.isFetching && (
          <div className="flex items-center gap-1.5 text-xs text-fg-muted dark:text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-link" />
            <span>Updating graphs...</span>
          </div>
        )}
      </div>

      {/* When Historical Data is Empty for this window */}
      {samples.length === 0 && (
        <div className="bg-white dark:bg-[#2b3035] rounded-lg border border-[#ced4da] dark:border-[#373b3e] p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-link dark:text-[#5bc0de]">
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>No historical telemetry samples recorded for {server.name} in this {activeWindow} window yet.</span>
          </div>
          <p className="text-xs text-fg-muted dark:text-slate-400">
            BinaryLane's telemetry daemon records 5-minute performance metrics on active instances. If this VM was recently started or is in testing, historical curves will accumulate automatically.
          </p>

          {latestMetricsQuery.data?.average && (
            <div className="pt-2 border-t border-[#ced4da] dark:border-[#373b3e] space-y-2">
              <h4 className="text-xs font-bold text-[#212529] dark:text-white flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-fg-link" />
                <span>Live Telemetry</span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="bg-[#f8f9fa] dark:bg-[#212529] p-2.5 rounded border border-[#ced4da] dark:border-[#373b3e]">
                  <span className="text-[0.625rem] text-fg-muted dark:text-slate-400 block">CPU Load</span>
                  <span className="font-bold text-[#212529] dark:text-white font-mono">
                    {(latestMetricsQuery.data.average.cpu_usage_percent || 0).toFixed(1)}%
                  </span>
                </div>
                <div className="bg-[#f8f9fa] dark:bg-[#212529] p-2.5 rounded border border-[#ced4da] dark:border-[#373b3e]">
                  <span className="text-[0.625rem] text-fg-muted dark:text-slate-400 block">Memory</span>
                  <span className="font-bold text-[#212529] dark:text-white font-mono">
                    {((latestMetricsQuery.data.average.memory_usage_bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB
                  </span>
                </div>
                <div className="bg-[#f8f9fa] dark:bg-[#212529] p-2.5 rounded border border-[#ced4da] dark:border-[#373b3e]">
                  <span className="text-[0.625rem] text-fg-muted dark:text-slate-400 block">Storage Used</span>
                  <span className="font-bold text-[#212529] dark:text-white font-mono">
                    {((latestMetricsQuery.data.average.storage_usage_megabytes || 0) / 1024).toFixed(2)} GB
                  </span>
                </div>
                <div className="bg-[#f8f9fa] dark:bg-[#212529] p-2.5 rounded border border-[#ced4da] dark:border-[#373b3e]">
                  <span className="text-[0.625rem] text-fg-muted dark:text-slate-400 block">Network (In+Out)</span>
                  <span className="font-bold text-[#212529] dark:text-white font-mono">
                    {fmtKBpsOrMBps(
                      (latestMetricsQuery.data.average.network_incoming_kbps || 0) +
                        (latestMetricsQuery.data.average.network_outgoing_kbps || 0)
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1. Activity Overview */}
      {memoryUnavailable && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Memory Usage Unavailable</div>
            <div className="opacity-90 mt-0.5">
              Memory usage can be reported if you install the{' '}
              <button
                onClick={() => window.bldeskApi?.openExternal?.(MEMORY_GRAPH_KB)}
                className="underline font-medium hover:no-underline inline-flex items-center gap-1"
              >
                Memory Graph
                <ExternalLink className="w-3 h-3" />
              </button>{' '}
              service.
            </div>
          </div>
        </div>
      )}

      <UsageSvgChart
        title="Activity Overview"
        subtitle={server.name}
        seriesList={activitySeriesList}
        window={activeWindow}
        scaleBy="series"
      />

      {/* 2. CPU Detail */}
      {cpuDetailSeriesList.length > 0 && (
        <UsageSvgChart
          title="CPU Core Breakdown"
          subtitle={`${server.name} (${server.vcpus} vCPUs)`}
          seriesList={cpuDetailSeriesList}
          window={activeWindow}
        />
      )}

      {/* 3. Network Detail */}
      <UsageSvgChart
        title="Network Throughput"
        subtitle={`${server.name} (${server.networks?.v4?.[0]?.ip_address || 'Interfaces'})`}
        seriesList={networkSeriesList}
        window={activeWindow}
      />

      {/* 4. Disk I/O Detail */}
      <UsageSvgChart
        title="Storage I/O & Throughput"
        subtitle={`${server.name} (${server.disk} GB Storage)`}
        seriesList={diskSeriesList}
        window={activeWindow}
      />

      {/* Footer Timestamp */}
      <div className="text-[0.6875rem] text-fg-muted dark:text-slate-500 text-center py-2 flex items-center justify-center gap-1.5">
        <Calendar className="w-3.5 h-3.5" />
        <span>As at {new Date().toLocaleString()} (Auto-refreshed from BinaryLane telemetry)</span>
      </div>
    </div>
  )
}
