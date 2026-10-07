/**
 * When a server's scheduled backups run: the three numbers a server's `backup_settings` reports and the
 * `change_backup_schedule` action changes. Pure functions, so the Backups page and the tests share them.
 *
 * What the reference says about them (openapi.json, BackupSettings and ChangeBackupSchedule):
 * - All three are in Australia/Sydney time for every region. The hour is "an approximate value".
 * - The weekday is for weekly backups and the day of the month for monthly ones, so each only means something
 *   while the server keeps that kind. The hour applies to all of them.
 * - Sunday is day 0. The hour is 0 to 23, the weekday 0 to 6 and the day of the month 1 to 28.
 * - On a change every value is optional: "Do not provide a value to keep the current setting."
 */

import type { components } from '@shared/api/schema'

/** The fields of the reference's ChangeBackupSchedule body apart from its `type`, so a wrong field name is a compile error. */
export type ScheduleBody = Omit<components['schemas']['ChangeBackupSchedule'], 'type'>

export interface BackupSchedule {
  hour: number
  dayOfWeek: number
  dayOfMonth: number
}

export type ScheduleField = keyof BackupSchedule

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

const RANGES: Record<ScheduleField, [number, number]> = { hour: [0, 23], dayOfWeek: [0, 6], dayOfMonth: [1, 28] }

type Retention = { daily_backups?: number | null; weekly_backups?: number | null; monthly_backups?: number | null }

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** The schedule a server reports, or null when `backup_settings` is missing or any of the three is not a whole number. */
export function readBackupSchedule(server: unknown): BackupSchedule | null {
  const s = (server as { backup_settings?: Record<string, unknown> | null } | null | undefined)?.backup_settings
  if (!s) return null
  const { backup_hour_of_day: hour, backup_day_of_week: dayOfWeek, backup_day_of_month: dayOfMonth } = s
  return whole(hour) && whole(dayOfWeek) && whole(dayOfMonth) ? { hour, dayOfWeek, dayOfMonth } : null
}

/**
 * Which of the three apply to a server: none when it keeps no daily, weekly or monthly backups (nothing is
 * scheduled), else the hour, plus the weekday while it keeps weekly ones and the day of the month while it
 * keeps monthly ones. With no retention to read (`options` missing) only the hour can be said to apply.
 */
export function scheduleFields(options: Retention | null | undefined): ScheduleField[] {
  if (!options) return ['hour']
  const weekly = (options.weekly_backups ?? 0) > 0
  const monthly = (options.monthly_backups ?? 0) > 0
  if (!((options.daily_backups ?? 0) > 0 || weekly || monthly)) return []
  return ['hour', ...(weekly ? (['dayOfWeek'] as const) : []), ...(monthly ? (['dayOfMonth'] as const) : [])]
}

/** 0 is midnight and 12 is noon, the rest are "2 am" and "2 pm". */
export function formatHour(hour: number): string {
  if (hour === 0) return 'midnight'
  if (hour === 12) return 'noon'
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`
}

/** Sunday is 0. A number outside 0 to 6 is shown as it came, not guessed at. */
export function formatWeekday(day: number): string {
  return WEEKDAYS[day] ?? `day ${day}`
}

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st, 22nd. */
export function formatDayOfMonth(day: number): string {
  const tens = day % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'
  return `${day}${suffix}`
}

export const FORMATTERS: Record<ScheduleField, (n: number) => string> = {
  hour: formatHour,
  dayOfWeek: formatWeekday,
  dayOfMonth: formatDayOfMonth
}

/**
 * The values a field's selector offers: the whole range, plus the server's current value when the API reports one
 * outside it, so the form can show what is set now instead of silently showing another value.
 */
export function optionsFor(field: ScheduleField, current: number): number[] {
  const [min, max] = RANGES[field]
  const all = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return all.includes(current) ? all : [current, ...all]
}

/** What the user has chosen in the form so far: only the fields they touched. */
export type ScheduleEdits = Partial<BackupSchedule>

/**
 * The user choosing `value` for `field`. Choosing what the server reports now clears the edit, so a field put back is no
 * change at all and is not remembered as one.
 */
export function setScheduleEdit(edits: ScheduleEdits, field: ScheduleField, value: number, live: BackupSchedule): ScheduleEdits {
  const next = { ...edits }
  if (value === live[field]) delete next[field]
  else next[field] = value
  return next
}

/**
 * What the form shows: the schedule the server reports now, with the user's own choices on top. A field the user has not
 * touched follows the server when the list is read again (every 15 seconds), so a change made elsewhere meanwhile, in
 * mPanel for one, is shown and is not sent back as if the user had chosen the old value.
 */
export function scheduleDraft(live: BackupSchedule, edits: ScheduleEdits): BackupSchedule {
  return { ...live, ...edits }
}

/** What differs between the schedule now and the one asked for, for the fields that apply. */
export function changedFields(current: BackupSchedule, next: BackupSchedule, fields: ScheduleField[]): ScheduleField[] {
  return fields.filter((f) => current[f] !== next[f])
}

/**
 * The fields of the `change_backup_schedule` body for the changes. Only what changed is sent: the reference keeps
 * the current setting for any value left out, so a day that does not apply to the server is never touched.
 */
export function scheduleBodyFields(next: BackupSchedule, changed: ScheduleField[]): ScheduleBody {
  // Assigned one by one rather than spread: TypeScript does not check a spread's keys, so a misspelt one would compile.
  const body: ScheduleBody = {}
  if (changed.includes('hour')) body.backup_hour_of_day = next.hour
  if (changed.includes('dayOfWeek')) body.backup_day_of_week = next.dayOfWeek
  if (changed.includes('dayOfMonth')) body.backup_day_of_month = next.dayOfMonth
  return body
}
