import type { components } from '@shared/api/schema'

type ThresholdAlert = components['schemas']['ThresholdAlert']
type ThresholdAlertRequest = components['schemas']['ThresholdAlertRequest']

/** One alert a server has at or over its threshold, as text ready to show. */
export interface RaisedAlert {
  type: string
  name: string
  /** The last measured value with its unit, e.g. "92%". */
  current: string
  /** The threshold with its unit, e.g. "80%". */
  threshold: string
  /** ISO time BinaryLane last raised this alert, if it ever has. */
  lastRaised: string | null
}

/** `%` sits against its number; a worded unit ("requests/second") is separated from it. */
export function formatAlertValue(value: number, unit: string): string {
  return unit === '%' ? `${value}%` : `${value} ${unit}`.trim()
}

/**
 * The public reference returns which servers have a current exceeded alert, not which alert, so this is BLDesk's own
 * comparison: an enabled alert whose last measured value is at or above its threshold. Both share one unit, and a
 * null `current_value` means nothing was measured in the period, which is not an exceeded alert.
 */
export function isAlertExceeded(alert: ThresholdAlert): boolean {
  return alert.enabled && alert.current_value != null && alert.current_value >= alert.value
}

export function raisedAlerts(alerts: readonly ThresholdAlert[]): RaisedAlert[] {
  return alerts.filter(isAlertExceeded).map((alert) => ({
    type: alert.alert_type,
    name: alert.name || alert.alert_type,
    current: formatAlertValue(alert.current_value as number, alert.unit),
    threshold: formatAlertValue(alert.value, alert.unit),
    lastRaised: alert.last_raised ?? null
  }))
}

export const describeRaisedAlert = (alert: RaisedAlert): string => `${alert.name} ${alert.current} (alert at ${alert.threshold})`

/** The server page's wording, the same as mPanel's banner: "Memory Consumption has reached 103% (alert threshold is 100%)". */
export const describeReachedAlert = (alert: RaisedAlert): string => `${alert.name} has reached ${alert.current} (alert threshold is ${alert.threshold})`

/** The count on a server's alert pill. `raised` is null while the server's alerts are loading or failed to load, and empty when none is at its threshold: the pill then cannot count. */
export function alertCountLabel(raised: readonly RaisedAlert[] | null): string {
  if (raised === null || raised.length === 0) return 'Alert triggered'
  return `${raised.length} ${raised.length === 1 ? 'alert' : 'alerts'} triggered`
}

/** What the marker says on hover and to a screen reader. `raised` is null while the server's alerts are still loading or failed to load. */
export function alertSummary(raised: readonly RaisedAlert[] | null): string {
  if (raised === null) return 'BinaryLane reports a threshold alert on this server'
  if (raised.length === 0) return 'BinaryLane reports a threshold alert on this server; none of its enabled alerts is at its threshold in the latest reading'
  return `Threshold alert: ${raised.map(describeRaisedAlert).join('; ')}`
}

// --- The Alerts rules table: which rules the user has changed, and what to send ---

/** What the user changed in one rule's row: only the fields they touched. A null `value` is a cleared box. */
export interface AlertEdit {
  enabled?: boolean
  value?: number | null
}

/** The short unit beside a threshold box, as mPanel writes it; any other unit is shown as BinaryLane gives it. */
export function shortUnit(unit: string): string {
  if (unit === 'requests/second') return 'req/s'
  if (unit === 'kilobytes/second') return 'kB/s'
  return unit
}

/**
 * What a threshold box accepts: a whole number of at least 1, and for a percentage at most 100. Memory is the exception:
 * it includes swap, so BinaryLane describes it as able to pass 100%. Other units have no upper limit here; BinaryLane
 * refuses what it will not take.
 */
export function alertValueLimits(alert: Pick<ThresholdAlert, 'alert_type' | 'unit'>): { min: number; max?: number } {
  return alert.unit === '%' && alert.alert_type !== 'memory-used' ? { min: 1, max: 100 } : { min: 1 }
}

/** A rule as the confirmation lists it: "on at 80%", "on at 500 req/s" or "off". The short unit keeps the line from wrapping inside a word on a phone. */
export const describeRule = (enabled: boolean, value: number, unit: string): string => (enabled ? `on at ${formatAlertValue(value, shortUnit(unit))}` : 'off')

export interface AlertChange {
  type: ThresholdAlert['alert_type']
  name: string
  /** Only what changed: BinaryLane keeps the existing status or value of a field that is left out. */
  request: ThresholdAlertRequest
  from: string
  to: string
}

/**
 * The rules whose status or threshold now differs from what BinaryLane holds, ready to send, and the rules whose box holds
 * something it will not accept (cleared, not whole, or out of range), which block saving. A rule the user left alone, or
 * put back to what it was, is neither: it is not sent, so saving can never overwrite a rule nobody touched.
 */
export function pendingAlertChanges(
  alerts: readonly ThresholdAlert[],
  edits: Readonly<Partial<Record<string, AlertEdit>>>
): { changes: AlertChange[]; invalid: string[] } {
  const changes: AlertChange[] = []
  const invalid: string[] = []
  for (const alert of alerts) {
    const edit = edits[alert.alert_type]
    if (!edit) continue
    const enabled = edit.enabled ?? alert.enabled
    const value = edit.value === undefined ? alert.value : edit.value
    const { min, max } = alertValueLimits(alert)
    if (value === null || !Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
      invalid.push(alert.alert_type)
      continue
    }
    const enabledChanged = enabled !== alert.enabled
    const valueChanged = value !== alert.value
    if (!enabledChanged && !valueChanged) continue
    changes.push({
      type: alert.alert_type,
      name: alert.name || alert.alert_type,
      request: { alert_type: alert.alert_type, ...(enabledChanged ? { enabled } : {}), ...(valueChanged ? { value } : {}) },
      from: describeRule(alert.enabled, alert.value, alert.unit),
      to: describeRule(enabled, value, alert.unit)
    })
  }
  return { changes, invalid }
}
