// Tests for the backup schedule helpers behind the Backups page: what `backup_settings` reports, which of the hour,
// weekday and day of the month apply to a server, how they read on screen, and the body `change_backup_schedule` is
// sent with. The module has no imports, so Node runs the TypeScript directly: node --test scripts/test-backup-schedule.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  WEEKDAYS,
  changedFields,
  formatDayOfMonth,
  formatHour,
  formatWeekday,
  optionsFor,
  readBackupSchedule,
  scheduleBodyFields,
  scheduleDraft,
  scheduleFields,
  setScheduleEdit
} from '../src/renderer/src/lib/backupSchedule.ts'

const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'))
const change = spec.components.schemas.ChangeBackupSchedule.properties
const settings = spec.components.schemas.BackupSettings.properties

test('the ranges are the reference\'s own (ChangeBackupSchedule)', () => {
  for (const [field, prop] of [['hour', 'backup_hour_of_day'], ['dayOfWeek', 'backup_day_of_week'], ['dayOfMonth', 'backup_day_of_month']]) {
    const { minimum, maximum } = change[prop]
    // With the server's value inside the range, the selector offers exactly the reference's minimum to maximum.
    const range = Array.from({ length: maximum - minimum + 1 }, (_, i) => minimum + i)
    assert.deepEqual(optionsFor(field, minimum), range, `${field} offers ${minimum} to ${maximum}`)
    assert.deepEqual(optionsFor(field, maximum), range, `${field} offers ${minimum} to ${maximum}`)
  }
  assert.equal(WEEKDAYS.length, change.backup_day_of_week.maximum + 1)
  assert.equal(WEEKDAYS[0], 'Sunday', 'Sunday is day 0')
})

test('backup_settings and the change body use the properties the reference names', () => {
  for (const p of ['backup_hour_of_day', 'backup_day_of_week', 'backup_day_of_month']) {
    assert.ok(settings[p], `BackupSettings has ${p}`)
    assert.ok(change[p], `ChangeBackupSchedule has ${p}`)
  }
  const body = scheduleBodyFields({ hour: 3, dayOfWeek: 2, dayOfMonth: 9 }, ['hour', 'dayOfWeek', 'dayOfMonth'])
  assert.deepEqual(Object.keys(body).sort(), ['backup_day_of_month', 'backup_day_of_week', 'backup_hour_of_day'])
  for (const k of Object.keys(body)) assert.ok(change[k], `${k} is a property of ChangeBackupSchedule`)
})

test('readBackupSchedule reads the three numbers, and nothing when it cannot', () => {
  assert.deepEqual(readBackupSchedule({ backup_settings: { backup_hour_of_day: 2, backup_day_of_week: 0, backup_day_of_month: 1 } }), { hour: 2, dayOfWeek: 0, dayOfMonth: 1 })
  assert.deepEqual(readBackupSchedule({ backup_settings: { backup_hour_of_day: 0, backup_day_of_week: 6, backup_day_of_month: 28, offsite_backup_settings: null } }), { hour: 0, dayOfWeek: 6, dayOfMonth: 28 })
  for (const bad of [
    null,
    undefined,
    {},
    { backup_settings: null },
    { backup_settings: {} },
    { backup_settings: { backup_hour_of_day: 2, backup_day_of_week: 0 } },
    { backup_settings: { backup_hour_of_day: '2', backup_day_of_week: 0, backup_day_of_month: 1 } },
    { backup_settings: { backup_hour_of_day: 2.5, backup_day_of_week: 0, backup_day_of_month: 1 } },
    { backup_settings: { backup_hour_of_day: null, backup_day_of_week: 0, backup_day_of_month: 1 } }
  ]) assert.equal(readBackupSchedule(bad), null, JSON.stringify(bad))
})

test('which of the three apply: only what the server keeps', () => {
  assert.deepEqual(scheduleFields({ daily_backups: 0, weekly_backups: 0, monthly_backups: 0 }), [], 'nothing scheduled')
  assert.deepEqual(scheduleFields({}), [], 'no retention at all')
  assert.deepEqual(scheduleFields({ daily_backups: 2 }), ['hour'])
  assert.deepEqual(scheduleFields({ daily_backups: 0, weekly_backups: 1 }), ['hour', 'dayOfWeek'], 'weekly and no daily')
  assert.deepEqual(scheduleFields({ monthly_backups: 3 }), ['hour', 'dayOfMonth'])
  assert.deepEqual(scheduleFields({ daily_backups: 3, weekly_backups: 2, monthly_backups: 1 }), ['hour', 'dayOfWeek', 'dayOfMonth'])
  assert.deepEqual(scheduleFields(null), ['hour'], 'no options to read: only the hour, which applies to every kind')
  assert.deepEqual(scheduleFields(undefined), ['hour'])
})

test('hours, weekdays and days of the month read as people say them', () => {
  assert.deepEqual([0, 1, 2, 11, 12, 13, 23].map(formatHour), ['midnight', '1 am', '2 am', '11 am', 'noon', '1 pm', '11 pm'])
  assert.deepEqual([0, 1, 6].map(formatWeekday), ['Sunday', 'Monday', 'Saturday'])
  assert.equal(formatWeekday(7), 'day 7', 'a number outside the week is shown as it came')
  assert.deepEqual([1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 28].map(formatDayOfMonth), ['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '14th', '20th', '21st', '22nd', '23rd', '24th', '28th'])
})

test('a selector offers the range, and the current value too when the API reports one outside it', () => {
  assert.deepEqual(optionsFor('dayOfWeek', 3), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(optionsFor('dayOfMonth', 31).slice(0, 3), [31, 1, 2])
  assert.equal(optionsFor('dayOfMonth', 31).length, 29)
  assert.equal(optionsFor('hour', 5).length, 24)
})

test('only what changed is sent, and a field that does not apply is never touched', () => {
  const now = { hour: 2, dayOfWeek: 0, dayOfMonth: 1 }
  const fields = ['hour', 'dayOfWeek']
  assert.deepEqual(changedFields(now, now, fields), [])
  assert.deepEqual(scheduleBodyFields(now, []), {})
  assert.deepEqual(changedFields(now, { ...now, hour: 3 }, fields), ['hour'])
  assert.deepEqual(scheduleBodyFields({ ...now, hour: 3 }, ['hour']), { backup_hour_of_day: 3 })
  // The day of the month differs, but this server keeps no monthly backups, so it is not one of its fields.
  assert.deepEqual(changedFields(now, { ...now, dayOfMonth: 15 }, fields), [])
  assert.deepEqual(changedFields(now, { hour: 0, dayOfWeek: 6, dayOfMonth: 28 }, ['hour', 'dayOfWeek', 'dayOfMonth']), ['hour', 'dayOfWeek', 'dayOfMonth'])
  assert.deepEqual(scheduleBodyFields({ hour: 0, dayOfWeek: 6, dayOfMonth: 28 }, ['hour', 'dayOfWeek', 'dayOfMonth']), { backup_hour_of_day: 0, backup_day_of_week: 6, backup_day_of_month: 28 })
  assert.ok('backup_hour_of_day' in scheduleBodyFields({ ...now, hour: 0 }, ['hour']), 'midnight (0) is a value, not "unchanged"')
})

test('a refresh while the form is open keeps what the user did not touch following the server (only the edited field is sent)', () => {
  const fields = ['hour', 'dayOfWeek', 'dayOfMonth']
  const opened = { hour: 2, dayOfWeek: 0, dayOfMonth: 1 }
  // The user edits only the hour ...
  const edits = setScheduleEdit({}, 'hour', 3, opened)
  assert.deepEqual(edits, { hour: 3 })
  // ... and meanwhile someone changes the weekday elsewhere (mPanel), which the next read of the server list reports.
  const refreshed = { ...opened, dayOfWeek: 5 }
  const draft = scheduleDraft(refreshed, edits)
  assert.deepEqual(draft, { hour: 3, dayOfWeek: 5, dayOfMonth: 1 }, 'the form shows their weekday, not the one it opened with')
  const changed = changedFields(refreshed, draft, fields)
  assert.deepEqual(changed, ['hour'], 'the weekday is not proposed as a change')
  assert.deepEqual(scheduleBodyFields(draft, changed), { backup_hour_of_day: 3 }, 'the request holds only the hour')
  // The old behaviour: a copy of the schedule taken when the form opened. It would send the old weekday back.
  const copy = { ...opened, hour: 3 }
  assert.deepEqual(changedFields(refreshed, copy, fields), ['hour', 'dayOfWeek'], 'what a copy taken at open would have proposed')
})

test('nothing edited means nothing changed, however the server list moves', () => {
  const opened = { hour: 2, dayOfWeek: 0, dayOfMonth: 1 }
  const refreshed = { hour: 9, dayOfWeek: 4, dayOfMonth: 20 }
  const draft = scheduleDraft(refreshed, {})
  assert.deepEqual(draft, refreshed)
  assert.deepEqual(changedFields(refreshed, draft, ['hour', 'dayOfWeek', 'dayOfMonth']), [])
  assert.deepEqual(scheduleDraft(opened, {}), opened)
})

test('a field the user puts back is no longer an edit, and a field they chose stays theirs when the server moves', () => {
  const opened = { hour: 2, dayOfWeek: 0, dayOfMonth: 1 }
  let edits = setScheduleEdit({}, 'hour', 3, opened)
  edits = setScheduleEdit(edits, 'dayOfWeek', 6, opened)
  assert.deepEqual(edits, { hour: 3, dayOfWeek: 6 })
  edits = setScheduleEdit(edits, 'hour', 2, opened)
  assert.deepEqual(edits, { dayOfWeek: 6 }, 'choosing what the server reports clears the edit')
  // The server's hour moves meanwhile; the user's weekday choice stays, and the hour they never touched follows the server.
  const refreshed = { ...opened, hour: 7 }
  const draft = scheduleDraft(refreshed, edits)
  assert.deepEqual(draft, { hour: 7, dayOfWeek: 6, dayOfMonth: 1 })
  assert.deepEqual(changedFields(refreshed, draft, ['hour', 'dayOfWeek']), ['dayOfWeek'])
  // The server catches up with the user's choice: it is no change any more.
  assert.deepEqual(changedFields({ ...refreshed, dayOfWeek: 6 }, draft, ['hour', 'dayOfWeek']), [])
  // The edits are not changed in place.
  const before = { hour: 3 }
  setScheduleEdit(before, 'dayOfWeek', 1, opened)
  assert.deepEqual(before, { hour: 3 })
})
