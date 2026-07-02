// Pure calendar helpers — month-grid builder, iso formatting, weekday/month labels.
// Logic ported from the original mock. No effects, no clock reads.

import type { CalendarLabels, Lang } from '../i18n/index'
import { calendarLabels } from '../i18n/index'

/** Zero-pad to two digits. */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Capitalise the first character. */
export function cap(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** A calendar cell: a concrete day, or `null` for leading/trailing blanks. */
export type CalendarCell = Date | null

/**
 * Build the month grid as weeks of 7 cells, Monday-first: leading blanks via `(firstDay+6)%7`,
 * trailing blanks pad to a multiple of 7.
 */
export function buildWeeks(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month, 1)
  const start = (first.getDay() + 6) % 7
  const dim = new Date(year, month + 1, 0).getDate()
  const cells: CalendarCell[] = []
  for (let i = 0; i < start; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7) cells.push(null)
  const weeks: CalendarCell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** ISO `YYYY-MM-DD` for a local date. */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** The three numeric parts of a calendar date (1-based month, as written in `YYYY-MM-DD`). */
export interface DateParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

/**
 * Parse a `YYYY-MM-DD` string into its numeric parts, or `null` if it is not three finite-integer
 * fields. Total (no throw) — the inverse of `iso`. Callers apply their own fallback for `null`.
 */
export function parseDateIso(isoDate: string): DateParts | null {
  const parts = isoDate.split('-')
  if (parts.length !== 3) return null
  const [year, month, day] = parts.map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  return { year, month, day }
}

/** Long weekday name for a `Date.getDay()` index, in the given language. */
export function weekdayLabel(lang: Lang, dayIndex: number): string {
  const labels: CalendarLabels = calendarLabels(lang)
  return labels.weekdays[dayIndex] ?? ''
}

/** Month name for a 0-based month index, in the given language. */
export function monthLabel(lang: Lang, monthIndex: number): string {
  const labels: CalendarLabels = calendarLabels(lang)
  return labels.months[monthIndex] ?? ''
}

/**
 * "Weekday D Month, HH:MM" for an appointment instant — capitalised localized weekday, day-of-month,
 * localized month, then the zero-padded LOCAL time. The single source of this label across the admin
 * bookings table, the cancellation lookup, and the demo booking (output is byte-identical to each).
 */
export function formatWhenLabel(lang: Lang, date: Date): string {
  return (
    cap(weekdayLabel(lang, date.getDay())) +
    ' ' +
    date.getDate() +
    ' ' +
    monthLabel(lang, date.getMonth()) +
    ', ' +
    pad2(date.getHours()) +
    ':' +
    pad2(date.getMinutes())
  )
}

/** The seven Monday-first weekday headers, in the given language. */
export function headerLabels(lang: Lang): readonly string[] {
  return calendarLabels(lang).headers
}
