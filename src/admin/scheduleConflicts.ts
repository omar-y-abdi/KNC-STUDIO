// Pure conflict detection between a barber's proposed unavailability and their CONFIRMED bookings.
// A booking is an "orphan" if, after the change, it would sit on a day/time the barber is no longer
// available for. All timezone reasoning is salon-local (Europe/Stockholm) via stockholmWallClockDate,
// exactly how the day grid + available_slots decide slot membership. No effects — unit-testable.
//
// Which bookings can be orphaned at all follows the database, not a client guess: the admin_* RPCs
// treat a confirmed booking as a conflict while `end_at > now()`. Every pre-check below shares that
// window (`isOrphanCandidate`), so the warning the barber sees matches what the server enforces.

import { stockholmWallClockDate } from '../booking/stockholmTime'
import { toDateIso } from './time'
import type { AdminBooking, WeekSchedule } from './types'

/** Salon-local wall clock for a booking's start instant. */
const wallOf = (b: AdminBooking): Date => stockholmWallClockDate(b.startAt)

/**
 * Can this booking still be stranded at `now`? Mirrors the database predicate
 * `status = 'confirmed' AND end_at > now()` (admin_save_barber_week, admin_add_time_off,
 * admin_add_slot_block, admin_add_recurring_break): an in-progress booking counts, a finished one —
 * including one whose end is exactly `now` — does not.
 */
const isOrphanCandidate = (b: AdminBooking, now: Date): boolean =>
  b.status === 'confirmed' && b.endAt.getTime() > now.getTime()

/** Minutes-from-midnight of a salon-local Date. */
const minuteOfDay = (wall: Date): number => wall.getHours() * 60 + wall.getMinutes()

/**
 * Would a booking starting at `wall` (salon-local) for `durationMin` still fit the given week?
 * Mirrors the `available_slots` gate: the weekday must be working and the whole appointment must sit
 * within [startMin, endMin). A weekday with no schedule row (or `working:false`) fits nothing.
 */
export function allowedUnder(week: WeekSchedule, wall: Date, durationMin: number): boolean {
  const day = week[wall.getDay()]
  if (day === undefined || !day.working) return false
  const start = minuteOfDay(wall)
  return start >= day.startMin && start + durationMin <= day.endMin
}

/**
 * Unfinished confirmed bookings (see `isOrphanCandidate`) whose salon-local date equals `dateIso`
 * (trigger A — block a whole day).
 */
export function orphansOnDate(
  bookings: readonly AdminBooking[],
  dateIso: string,
  now: Date,
): readonly AdminBooking[] {
  return bookings.filter((b) => isOrphanCandidate(b, now) && toDateIso(wallOf(b)) === dateIso)
}

/**
 * Unfinished confirmed bookings (see `isOrphanCandidate`) whose salon-local date is within
 * [startIso, endIso] inclusive (trigger C — a Ledighet range; matches `timeOffCovering`
 * semantics). Bounds are swapped if the caller passes them reversed.
 */
export function orphansInRange(
  bookings: readonly AdminBooking[],
  startIso: string,
  endIso: string,
  now: Date,
): readonly AdminBooking[] {
  const [lo, hi] = startIso <= endIso ? [startIso, endIso] : [endIso, startIso]
  return bookings.filter((b) => {
    if (!isOrphanCandidate(b, now)) return false
    const iso = toDateIso(wallOf(b))
    return iso >= lo && iso <= hi
  })
}

/**
 * Unfinished confirmed bookings (see `isOrphanCandidate`) that would no longer fit `nextWeek`
 * (trigger B — a veckoschema change: a weekday turned off, hours narrowed, or same-time-all-days
 * applied). An in-progress appointment can still be stranded; a finished one can't.
 */
export function orphansUnderWeek(
  bookings: readonly AdminBooking[],
  nextWeek: WeekSchedule,
  now: Date,
): readonly AdminBooking[] {
  return bookings.filter(
    (b) => isOrphanCandidate(b, now) && !allowedUnder(nextWeek, wallOf(b), b.durationMin),
  )
}

/** Outcome of a batch of cancellation attempts, order-preserving. */
export interface CancellationOutcome {
  /** Bookings whose cancellation succeeded — the list to show as "cancelled". */
  readonly done: readonly AdminBooking[]
  /** Bookings whose cancellation failed — non-empty means "don't apply the change yet". */
  readonly failed: readonly AdminBooking[]
}

/**
 * Split cancellation attempts into succeeded/failed, preserving order. `oks[i]` is whether cancelling
 * `bookings[i]` succeeded; a missing/`undefined` flag counts as failed (total — never assume success).
 * Pure, so the "did every cancel succeed?" decision that gates applying the unavailability change is
 * unit-testable without the RPC.
 */
export function partitionCancellations(
  bookings: readonly AdminBooking[],
  oks: readonly boolean[],
): CancellationOutcome {
  const done: AdminBooking[] = []
  const failed: AdminBooking[] = []
  bookings.forEach((b, i) => {
    ;(oks[i] === true ? done : failed).push(b)
  })
  return { done, failed }
}
