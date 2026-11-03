// Tests for the fleet heatmap's threshold-alert marker: which of a server's alerts BLDesk calls exceeded, and the words it
// uses for them. The module only imports a type, so Node runs the TypeScript directly:
//   node --experimental-strip-types --test scripts/test-threshold-alerts.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertCountLabel, alertSummary, alertValueLimits, describeRaisedAlert, describeReachedAlert, describeRule, formatAlertValue, isAlertExceeded, pendingAlertChanges, raisedAlerts, shortUnit } from '../src/renderer/src/lib/thresholdAlerts.ts'

const alert = (over = {}) => ({
  alert_type: 'cpu', name: 'CPU Usage', unit: '%', description: '', enabled: true, value: 80, current_value: 35, last_raised: null, last_cleared: null, ...over
})

test('a percentage sits against its number and a worded unit is separated from it', () => {
  assert.equal(formatAlertValue(92, '%'), '92%')
  assert.equal(formatAlertValue(500, 'requests/second'), '500 requests/second')
  assert.equal(formatAlertValue(700, 'kilobytes/second'), '700 kilobytes/second')
  assert.equal(formatAlertValue(3, ''), '3')
})

test('an enabled alert is exceeded at its threshold and above it, not below', () => {
  assert.equal(isAlertExceeded(alert({ current_value: 79 })), false)
  assert.equal(isAlertExceeded(alert({ current_value: 80 })), true)
  assert.equal(isAlertExceeded(alert({ current_value: 92 })), true)
})

test('a disabled alert is never exceeded, however high its reading', () => {
  assert.equal(isAlertExceeded(alert({ enabled: false, current_value: 99 })), false)
})

test('no measured value is not an exceeded alert, and a reading of zero is a measurement', () => {
  assert.equal(isAlertExceeded(alert({ current_value: null })), false)
  assert.equal(isAlertExceeded(alert({ current_value: undefined })), false)
  assert.equal(isAlertExceeded(alert({ value: 0, current_value: 0 })), true)
  // `null >= 0` is true in JavaScript, so without its own check a threshold of 0 would read "no measurement" as exceeded.
  assert.equal(isAlertExceeded(alert({ value: 0, current_value: null })), false)
  assert.equal(isAlertExceeded(alert({ value: 0, current_value: undefined })), false)
})

test('a past last_raised does not make an alert exceeded: only the latest reading does', () => {
  assert.equal(isAlertExceeded(alert({ enabled: false, last_raised: '2025-09-04T11:06:00Z', current_value: 0 })), false)
  assert.equal(isAlertExceeded(alert({ last_raised: '2025-09-04T11:06:00Z', current_value: 12 })), false)
})

test('raisedAlerts keeps the API order and the display name, with each value in its own unit', () => {
  const raised = raisedAlerts([
    alert({ alert_type: 'cpu', name: 'CPU Usage', value: 80, current_value: 92 }),
    alert({ alert_type: 'memory-used', name: 'Memory Consumption', value: 100, current_value: 40 }),
    alert({ alert_type: 'storage-requests', name: 'Disk I/O Requests', unit: 'requests/second', value: 500, current_value: 640, last_raised: '2026-11-03T01:00:00Z' })
  ])
  assert.deepEqual(raised.map((r) => r.type), ['cpu', 'storage-requests'])
  assert.deepEqual(raised.map(describeRaisedAlert), ['CPU Usage 92% (alert at 80%)', 'Disk I/O Requests 640 requests/second (alert at 500 requests/second)'])
  assert.equal(raised[0].lastRaised, null)
  assert.equal(raised[1].lastRaised, '2026-11-03T01:00:00Z')
})

test('a blank display name falls back to the alert type', () => {
  assert.equal(raisedAlerts([alert({ name: '', alert_type: 'storage-used', current_value: 95, value: 90 })])[0].name, 'storage-used')
})

test('the summary names the alerts, or says what is known when they are not', () => {
  assert.equal(alertSummary(raisedAlerts([alert({ current_value: 92 })])), 'Threshold alert: CPU Usage 92% (alert at 80%)')
  assert.equal(alertSummary(raisedAlerts([alert({ current_value: 92 }), alert({ alert_type: 'storage-used', name: 'Disk Space', value: 90, current_value: 96 })])), 'Threshold alert: CPU Usage 92% (alert at 80%); Disk Space 96% (alert at 90%)')
  assert.match(alertSummary(null), /^BinaryLane reports a threshold alert on this server$/)
  assert.match(alertSummary([]), /none of its enabled alerts is at its threshold/)
})

test("the server page uses mPanel's words: the alert has reached its reading, against its threshold", () => {
  const [memory] = raisedAlerts([alert({ alert_type: 'memory-used', name: 'Memory Consumption', value: 100, current_value: 103 })])
  assert.equal(describeReachedAlert(memory), 'Memory Consumption has reached 103% (alert threshold is 100%)')
  const [io] = raisedAlerts([alert({ alert_type: 'storage-requests', name: 'Disk I/O Requests', unit: 'requests/second', value: 500, current_value: 640 })])
  assert.equal(describeReachedAlert(io), 'Disk I/O Requests has reached 640 requests/second (alert threshold is 500 requests/second)')
})

test('the pill counts the alerts it can name, and does not guess a count when it cannot', () => {
  assert.equal(alertCountLabel(raisedAlerts([alert({ current_value: 92 })])), '1 alert triggered')
  assert.equal(alertCountLabel(raisedAlerts([alert({ current_value: 92 }), alert({ alert_type: 'storage-used', name: 'Disk Space', value: 90, current_value: 96 })])), '2 alerts triggered')
  assert.equal(alertCountLabel([]), 'Alert triggered')
  assert.equal(alertCountLabel(null), 'Alert triggered')
})

// --- the Alerts rules table ---

const rules = () => [
  alert({ alert_type: 'cpu', name: 'CPU Usage', value: 80, enabled: true }),
  alert({ alert_type: 'storage-requests', name: 'Disk I/O Requests', unit: 'requests/second', value: 500, enabled: true }),
  alert({ alert_type: 'network-outgoing', name: 'Outgoing Network Traffic', unit: 'kilobytes/second', value: 500, enabled: false }),
  alert({ alert_type: 'memory-used', name: 'Memory Consumption', value: 100, enabled: true })
]

test('short units are mPanel\'s, and an unknown unit is shown as BinaryLane gives it', () => {
  assert.equal(shortUnit('requests/second'), 'req/s')
  assert.equal(shortUnit('kilobytes/second'), 'kB/s')
  assert.equal(shortUnit('%'), '%')
  assert.equal(shortUnit('widgets/day'), 'widgets/day')
})

test('a percentage tops out at 100 except memory, which includes swap; other units have no top', () => {
  assert.deepEqual(alertValueLimits({ alert_type: 'cpu', unit: '%' }), { min: 1, max: 100 })
  assert.deepEqual(alertValueLimits({ alert_type: 'memory-used', unit: '%' }), { min: 1 })
  assert.deepEqual(alertValueLimits({ alert_type: 'storage-requests', unit: 'requests/second' }), { min: 1 })
})

test('rules are described as the confirmation lists them', () => {
  assert.equal(describeRule(true, 80, '%'), 'on at 80%')
  assert.equal(describeRule(true, 500, 'requests/second'), 'on at 500 req/s')
  assert.equal(describeRule(true, 700, 'kilobytes/second'), 'on at 700 kB/s')
  assert.equal(describeRule(false, 80, '%'), 'off')
})

test('nothing edited, or edited back to what it was, sends nothing', () => {
  assert.deepEqual(pendingAlertChanges(rules(), {}), { changes: [], invalid: [] })
  assert.deepEqual(pendingAlertChanges(rules(), { cpu: { value: 80, enabled: true }, 'storage-requests': {} }), { changes: [], invalid: [] })
})

test('only the changed field of only the changed rule is sent', () => {
  const { changes, invalid } = pendingAlertChanges(rules(), { cpu: { value: 85 }, 'network-outgoing': { enabled: true }, 'storage-requests': { enabled: true } })
  assert.deepEqual(invalid, [])
  assert.deepEqual(changes.map((c) => c.request), [{ alert_type: 'cpu', value: 85 }, { alert_type: 'network-outgoing', enabled: true }])
  assert.deepEqual(changes.map((c) => [c.name, c.from, c.to]), [['CPU Usage', 'on at 80%', 'on at 85%'], ['Outgoing Network Traffic', 'off', 'on at 500 kB/s']])
})

test('a rule can change both its status and its threshold at once, and rules past the first four are included', () => {
  const { changes } = pendingAlertChanges(rules(), { 'storage-requests': { enabled: false, value: 900 }, 'memory-used': { value: 130 } })
  assert.deepEqual(changes.map((c) => c.request), [{ alert_type: 'storage-requests', enabled: false, value: 900 }, { alert_type: 'memory-used', value: 130 }])
})

test('a box BinaryLane would refuse blocks saving instead of being sent', () => {
  for (const bad of [null, 0, -3, 101, 12.5, Number.NaN]) {
    const { changes, invalid } = pendingAlertChanges(rules(), { cpu: { value: bad } })
    assert.deepEqual(invalid, ['cpu'], String(bad))
    assert.deepEqual(changes, [])
  }
  assert.deepEqual(pendingAlertChanges(rules(), { 'storage-requests': { value: 5000 } }).invalid, [])
  assert.deepEqual(pendingAlertChanges(rules(), { 'memory-used': { value: 130 } }).invalid, [])
})

test('the other valid edits are still listed beside an invalid one', () => {
  const { changes, invalid } = pendingAlertChanges(rules(), { cpu: { value: null }, 'storage-requests': { value: 600 } })
  assert.deepEqual(invalid, ['cpu'])
  assert.deepEqual(changes.map((c) => c.type), ['storage-requests'])
})
