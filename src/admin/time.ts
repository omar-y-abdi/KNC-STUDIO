// Pure schedule/time helpers for the admin panel. NO effects — referentially transparent, unit-
// tested without mocks. The salon's bookable day is 09:00–18:00 in 45-min steps (the same 12 fixed
// SLOTS the booking backend uses); the schedule editor offers those as the selectable start/end
// bounds so a barber can only pick sane, on-grid hours.

import type { DaySchedule, SlotBlock, TimeOff, WeekSchedule, Weekday } from './types'

/** Minutes from midnight for the default working day (09:00 / 18:00). */
export const DEFAULT_START_MIN = 540
export const DEFAULT_END_MIN = 1080

/** A label + its minutes-from-midnight, for the start/end dropdowns. */
export interface TimeOption {
  readonly label: string
  readonly min: number
}

/**
 * Format minutes-from-midnight as zero-padded `HH:MM`. Total function over any non-negative int;
 * callers only ever pass DB-constrained values (0..1440).
 */
export function minutesToHHMM(min: number): string {
  const safe = Math.max(0, Math.floor(min))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The selectable start times: the 12 fixed slot starts (09:00..17:15) PLUS the day-open boundary.
 * Steps of 45 min, 540..1035. Used to populate the "start" dropdown.
 */
export const START_OPTIONS: readonly TimeOption[] = buildOptions(540, 1035, 45)

/**
 * The selectable end times: 09:45..18:00 in 45-min steps (every slot END), so a working window
 * always covers whole slots and a slot ending exactly at `end_min` still fits (the RPC uses `<=`).
 */
export const END_OPTIONS: readonly TimeOption[] = buildOptions(585, 1080, 45)

/** Build a `[from..to]` inclusive option list at `step` minutes. */
function buildOptions(from: number, to: number, step: number): readonly TimeOption[] {
  const out: TimeOption[] = []
  for (let m = from; m <= to; m += step) out.push({ label: minutesToHHMM(m), min: m })
  return out
}

/**
 * Is this a valid working window? `end` must be strictly after `start` (mirrors the DB
 * `sched_time_order` check `end_min > start_min`). Non-working days are always valid.
 */
export function isValidWindow(day: DaySchedule): boolean {
  if (!day.working) return true
  return day.endMin > day.startMin
}

/** Every weekday in JS getDay() order (0=Sun..6=Sat). */
const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6]

/**
 * The default week (mirrors the DB seed): working Mon–Sat (1..6) 09:00–18:00, Sunday(0) closed. Used
 * as the starting point when a barber has no schedule rows yet, and to normalize a partial read into
 * the fixed 7-entry `WeekSchedule` the editor needs.
 */
export function defaultWeek(): WeekSchedule {
  return WEEKDAYS.map((weekday) => ({
    weekday,
    working: weekday >= 1 && weekday <= 6,
    startMin: DEFAULT_START_MIN,
    endMin: DEFAULT_END_MIN,
  }))
}

/**
 * Normalize a (possibly partial / unordered) set of day rows into a complete, weekday-indexed
 * `WeekSchedule`. Missing weekdays fall back to the default for that day. Pure — builds a new array.
 */
export function toWeekSchedule(rows: readonly DaySchedule[]): WeekSchedule {
  const base = defaultWeek()
  const byDay = new Map<Weekday, DaySchedule>()
  for (const r of rows) byDay.set(r.weekday, r)
  return base.map((d) => byDay.get(d.weekday) ?? d)
}

/**
 * "Samma tid alla dagar" — apply ONE start/end to EVERY currently-working day, leaving each day's
 * `working` flag and the non-working days untouched. Returns a NEW week (no mutation).
 */
export function sameTimeAllDays(
  week: WeekSchedule,
  startMin: number,
  endMin: number,
): WeekSchedule {
  return week.map((d) => (d.working ? { ...d, startMin, endMin } : d))
}

/** Toggle a single weekday's `working` flag, returning a NEW week. */
export function toggleWorking(week: WeekSchedule, weekday: Weekday): WeekSchedule {
  return week.map((d) => (d.weekday === weekday ? { ...d, working: !d.working } : d))
}

/** Set a single weekday's start/end (minutes), returning a NEW week. */
export function setDayHours(
  week: WeekSchedule,
  weekday: Weekday,
  startMin: number,
  endMin: number,
): WeekSchedule {
  return week.map((d) => (d.weekday === weekday ? { ...d, startMin, endMin } : d))
}

/** Does the whole week validate (every day's window is legal)? Gate for the Save button. */
export function weekIsValid(week: WeekSchedule): boolean {
  return week.every(isValidWindow)
}

/** `YYYY-MM-DD` for a local Date (admin time-off pickers are date-only, salon-local). */
export function toDateIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// --- Day grid (the tap-to-block walk-in view) -----------------------------------------------------

/**
 * The day grid blocks in 15-MIN QUARTERS: fine enough for "a text booking ate 11:15–11:30",
 * coarse enough to stay tappable. The UI clusters quarters under HOUR buttons (press an hour to
 * expand its four quarters), so the grid never shows more than 9 hour chips + 4 quarter chips.
 */
export const QUARTER_LEN_MIN = 15

/**
 * What one chip on the day grid IS, in priority order:
 *   `booked`  — overlaps a confirmed booking (shows the customer; never tappable)
 *   `blocked` — overlaps a walk-in block row (tap = unblock)
 *   `closed`  — outside working hours, a non-working weekday, or a time-off day
 *   `past`    — already started (only on today)
 *   `open`    — bookable online right now (tap = block)
 */
export type SlotState = 'open' | 'blocked' | 'booked' | 'closed' | 'past'

/** A confirmed booking mapped onto the day's minute line (salon-local). */
export interface DayBooking {
  readonly startMin: number
  readonly endMin: number
  /** Short label for the chip (customer first name). */
  readonly label: string
}

/** One rendered 15-min quarter on the day grid. */
export interface DaySlot {
  readonly startMin: number
  /** `HH:MM` start label. */
  readonly label: string
  readonly state: SlotState
  /** The covering block row's id when `state === 'blocked'` (the delete target). */
  readonly blockId: string | null
  /** The covering booking's label when `state === 'booked'`. */
  readonly bookingLabel: string | null
}

/** One expandable hour on the day grid: the hour chip + its four 15-min quarters. */
export interface HourGroup {
  readonly startMin: number
  /** `HH:MM` hour label ("09:00"). */
  readonly label: string
  readonly quarters: readonly DaySlot[]
}

/** The inputs the quarter math needs — pure data, no I/O. */
export interface DayGridArgs {
  /** The weekday's schedule row (undefined = no row = off). */
  readonly day: DaySchedule | undefined
  /** A time-off range covers the date. */
  readonly dayOff: boolean
  /** The date's walk-in block rows. */
  readonly blocks: readonly SlotBlock[]
  /** The date's CONFIRMED bookings on the salon-local minute line. */
  readonly bookings: readonly DayBooking[]
  /**
   * Quarters starting before this are `past` — the current salon-local minute for today,
   * `0` for a future date.
   */
  readonly pastCutoffMin: number
}

/** Does window [aStart, aEnd) overlap [bStart, bEnd)? (Half-open, mirrors the DB overlap math.) */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

/** State of ONE quarter window [min, min+15). */
function quarterAt(args: DayGridArgs, min: number): DaySlot {
  const end = min + QUARTER_LEN_MIN
  const booking = args.bookings.find((b) => overlaps(min, end, b.startMin, b.endMin))
  const block = args.blocks.find((b) => overlaps(min, end, b.startMin, b.endMin))
  const closed =
    args.dayOff ||
    args.day === undefined ||
    !args.day.working ||
    min < args.day.startMin ||
    end > args.day.endMin

  const state: SlotState =
    booking !== undefined
      ? 'booked'
      : block !== undefined
        ? 'blocked'
        : closed
          ? 'closed'
          : min < args.pastCutoffMin
            ? 'past'
            : 'open'

  return {
    startMin: min,
    label: minutesToHHMM(min),
    state,
    blockId: state === 'blocked' && block !== undefined ? block.id : null,
    bookingLabel: state === 'booked' && booking !== undefined ? booking.label : null,
  }
}

/**
 * The day's hour groups (09:00..17:00, each with four 15-min quarters), covering the salon day
 * 09:00–18:00. Pure. Hours whose quarters are ALL closed are still returned — the component
 * decides whether to render or drop them (a shrunk working window should not shift the layout
 * unpredictably between days).
 */
export function dayHours(args: DayGridArgs): readonly HourGroup[] {
  const out: HourGroup[] = []
  for (let hour = DEFAULT_START_MIN; hour < DEFAULT_END_MIN; hour += 60) {
    const quarters: DaySlot[] = []
    for (let q = hour; q < hour + 60; q += QUARTER_LEN_MIN) quarters.push(quarterAt(args, q))
    out.push({ startMin: hour, label: minutesToHHMM(hour), quarters })
  }
  return out
}

/** The time-off entry covering an ISO date, if any (inclusive range; ISO strings compare safely). */
export function timeOffCovering(timeOff: readonly TimeOff[], dateIso: string): TimeOff | undefined {
  return timeOff.find((t) => t.startDate <= dateIso && dateIso <= t.endDate)
}

/** The next `count` days starting at `from` (local midnights), for the day-picker strip. */
export function upcomingDates(from: Date, count: number): readonly Date[] {
  const out: Date[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i))
  }
  return out
}
