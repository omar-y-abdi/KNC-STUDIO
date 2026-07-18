// Pure sectioning + ISO-week bucketing for the admin bookings list. Given the RLS-readable bookings
// and an injected `nowMs` (the ONLY "current time" input — the module reads no clock), it splits the
// bookings into the three panel sections and, within each, buckets them by ISO week so the view can
// render week headers.
//
// Weeks are computed on the Europe/Stockholm WALL-CLOCK of each `startAt`, not on the raw UTC instant:
// a late-night UTC instant can fall on a different salon day — and therefore a different ISO week —
// than its UTC date suggests (e.g. 2026-07-12 22:30Z is 2026-07-13 00:30 in Stockholm, crossing from
// ISO week 28 into week 29). We reuse the verified `stockholmWallClockDate` helper rather than
// hand-rolling timezone math.
//
// Referentially transparent and input-preserving: the input array and its booking objects are never
// mutated; every array/object in the result is freshly built (local accumulators only).

import type { AdminBooking } from '../types'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import { isoWeek, type IsoWeek } from '../weekOfYear'

/** The three panel sections: `kommande` = upcoming, `avbokade` = cancelled, `tidigare` = past. */
export type BookingSection = 'kommande' | 'avbokade' | 'tidigare'

/** A set of bookings sharing one ISO week, tagged with that week's composite identity. */
export interface WeekGroup {
  readonly isoWeekYear: number
  readonly isoWeek: number
  readonly bookings: readonly AdminBooking[]
}

/** All three sections, each an ordered list of week groups. */
export interface SectionedBookings {
  readonly kommande: readonly WeekGroup[]
  readonly avbokade: readonly WeekGroup[]
  readonly tidigare: readonly WeekGroup[]
}

/** Chronological direction applied to a section's groups and to the bookings inside each group. */
type SortDir = 'asc' | 'desc'

/** A mutable per-week accumulator used only while grouping (never escapes as-is). */
interface WeekBucket {
  readonly week: IsoWeek
  readonly bookings: AdminBooking[]
}

/** The section a booking belongs to. A cancelled booking is always `avbokade`, regardless of time. */
function sectionOf(booking: AdminBooking, nowMs: number): BookingSection {
  if (booking.status === 'cancelled') return 'avbokade'
  return booking.startAt.getTime() >= nowMs ? 'kommande' : 'tidigare'
}

/** The ISO week of a booking, computed on the Europe/Stockholm wall-clock day of its `startAt`. */
function weekOf(booking: AdminBooking): IsoWeek {
  const wall = stockholmWallClockDate(booking.startAt)
  return isoWeek(wall.getFullYear(), wall.getMonth() + 1, wall.getDate())
}

/** Compare two week identities as the composite ordinal `(isoWeekYear, isoWeek)`. */
function compareWeeks(a: WeekGroup, b: WeekGroup): number {
  return a.isoWeekYear - b.isoWeekYear || a.isoWeek - b.isoWeek
}

/** Copy then sort bookings by `startAt` in the given direction; the input array is left untouched. */
function sortBookings(bookings: readonly AdminBooking[], dir: SortDir): readonly AdminBooking[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...bookings].sort((a, b) => sign * (a.startAt.getTime() - b.startAt.getTime()))
}

/** Bucket a section's bookings into ISO-week groups, then order the groups and their bookings by `dir`. */
function groupByWeek(bookings: readonly AdminBooking[], dir: SortDir): readonly WeekGroup[] {
  const buckets = new Map<string, WeekBucket>()
  for (const booking of bookings) {
    const week = weekOf(booking)
    const key = `${week.isoWeekYear}-${week.isoWeek}`
    const existing = buckets.get(key)
    if (existing) {
      existing.bookings.push(booking)
    } else {
      buckets.set(key, { week, bookings: [booking] })
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...buckets.values()]
    .map((bucket): WeekGroup => ({
      isoWeekYear: bucket.week.isoWeekYear,
      isoWeek: bucket.week.isoWeek,
      bookings: sortBookings(bucket.bookings, dir),
    }))
    .sort((a, b) => sign * compareWeeks(a, b))
}

/**
 * Split `bookings` into the three sections and bucket each section by ISO week (Stockholm wall-clock).
 * Ordering: `kommande` ascending (soonest week/booking first); `avbokade` and `tidigare` descending
 * (most-recent first). `nowMs` is the injected reference instant (ms since epoch); a booking at exactly
 * `nowMs` counts as `kommande` (the `>= nowMs` boundary).
 */
export function partitionSections(
  bookings: readonly AdminBooking[],
  nowMs: number,
): SectionedBookings {
  const bySection: Record<BookingSection, AdminBooking[]> = {
    kommande: [],
    avbokade: [],
    tidigare: [],
  }
  for (const booking of bookings) {
    bySection[sectionOf(booking, nowMs)].push(booking)
  }
  return {
    kommande: groupByWeek(bySection.kommande, 'asc'),
    avbokade: groupByWeek(bySection.avbokade, 'desc'),
    tidigare: groupByWeek(bySection.tidigare, 'desc'),
  }
}
