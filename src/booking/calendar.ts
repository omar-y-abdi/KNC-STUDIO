// Pure calendar helpers — month-grid builder, iso formatting, weekday/month labels.
// Logic ported verbatim from the source `bfP2`, `bfCap`, `bfBuildWeeks`, `bfIso`
// (index.html lines 159, 160, 174-183). No effects, no clock reads.

import type { CalendarLabels, Lang } from '../i18n/index'
import { calendarLabels } from '../i18n/index'

/** Zero-pad to two digits (source `bfP2`). */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Capitalise the first character (source `bfCap`). */
export function cap(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** A calendar cell: a concrete day, or `null` for leading/trailing blanks (source uses `null`). */
export type CalendarCell = Date | null

/**
 * Build the month grid as weeks of 7 cells, Monday-first.
 * Ported verbatim from `bfBuildWeeks`: leading blanks via `(firstDay+6)%7`, trailing
 * blanks pad to a multiple of 7.
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

/** ISO `YYYY-MM-DD` for a local date (source `bfIso`). */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
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

/** The seven Monday-first weekday headers, in the given language. */
export function headerLabels(lang: Lang): readonly string[] {
  return calendarLabels(lang).headers
}
