import { describe, it, expect } from 'vitest'
import {
  allowedUnder,
  orphansOnDate,
  orphansInRange,
  orphansUnderWeek,
  partitionCancellations,
} from '../../src/admin/scheduleConflicts'
import type { AdminBooking, DaySchedule, Weekday, WeekSchedule } from '../../src/admin/types'
import { stockholmWallClockDate } from '../../src/booking/stockholmTime'

// Salon-local July times use the +02:00 (CEST) offset so the instant is unambiguous.
// 2026-07-21 is a Tuesday (getDay()===2); 2026-07-18 / 2026-07-25 are Saturdays.
const at = (iso: string): Date => new Date(iso)

const bk = (over: Partial<AdminBooking> & { startAt: Date }): AdminBooking => ({
  id: 'b1',
  barberId: 'victor',
  serviceName: 'Klippning',
  price: 350,
  durationMin: 45,
  endAt: new Date(over.startAt.getTime() + 45 * 60000),
  customerName: 'Test Testsson',
  method: 'phone',
  phone: '0700000000',
  email: null,
  lang: 'sv',
  status: 'confirmed',
  ...over,
})

const WD: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6]
/** All 7 days working 09:00–18:00, with optional per-weekday overrides. */
const week = (over: Partial<Record<Weekday, Partial<DaySchedule>>> = {}): WeekSchedule =>
  WD.map((wd) => ({ weekday: wd, working: true, startMin: 540, endMin: 1080, ...(over[wd] ?? {}) }))

const tue12 = at('2026-07-21T12:00:00+02:00') // Tuesday 12:00 salon-local
/** A `now` before every booking in the date/range/week fixtures below, so only their own logic is tested. */
const early = at('2026-07-01T00:00:00+02:00')

describe('allowedUnder', () => {
  it('accepts an appointment inside a working weekday window', () => {
    expect(allowedUnder(week(), stockholmWallClockDate(tue12), 45)).toBe(true)
  })
  it('rejects when the weekday is not working', () => {
    expect(allowedUnder(week({ 2: { working: false } }), stockholmWallClockDate(tue12), 45)).toBe(
      false,
    )
  })
  it('rejects when the appointment END spills past the narrowed closing time', () => {
    // 12:00 + 45 = 12:45, hours narrowed to 09:00–12:00 (540–720) → does not fit.
    expect(allowedUnder(week({ 2: { endMin: 720 } }), stockholmWallClockDate(tue12), 45)).toBe(
      false,
    )
  })
  it('rejects when the start is before the narrowed opening time', () => {
    expect(allowedUnder(week({ 2: { startMin: 780 } }), stockholmWallClockDate(tue12), 45)).toBe(
      false,
    )
  })
  it('accepts an earlier appointment that still fits a narrowed window', () => {
    const tue11 = at('2026-07-21T11:00:00+02:00')
    expect(allowedUnder(week({ 2: { endMin: 720 } }), stockholmWallClockDate(tue11), 45)).toBe(true)
  })
  it('rejects when there is no schedule row for the weekday', () => {
    expect(allowedUnder([], stockholmWallClockDate(tue12), 45)).toBe(false)
  })
})

describe('orphansOnDate (trigger A — block a whole day)', () => {
  it('includes a confirmed booking on the salon-local date', () => {
    expect(orphansOnDate([bk({ startAt: tue12 })], '2026-07-21', early)).toHaveLength(1)
  })
  it('excludes bookings on other dates', () => {
    expect(orphansOnDate([bk({ startAt: tue12 })], '2026-07-22', early)).toHaveLength(0)
  })
  it('excludes already-cancelled bookings', () => {
    expect(
      orphansOnDate([bk({ startAt: tue12, status: 'cancelled' })], '2026-07-21', early),
    ).toHaveLength(0)
  })
})

describe('orphansInRange (trigger C — Ledighet range, inclusive)', () => {
  const sat18 = bk({ id: 'a', startAt: at('2026-07-18T10:00:00+02:00') })
  const tue21 = bk({ id: 'b', startAt: tue12 })
  const sat25 = bk({ id: 'c', startAt: at('2026-07-25T10:00:00+02:00') })
  const aug1 = bk({ id: 'd', startAt: at('2026-08-01T10:00:00+02:00') })
  const all = [sat18, tue21, sat25, aug1]

  it('includes bookings within the range, inclusive of both bounds', () => {
    const ids = orphansInRange(all, '2026-07-18', '2026-07-25', early).map((b) => b.id)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
  it('excludes bookings outside the range', () => {
    expect(orphansInRange(all, '2026-07-18', '2026-07-25', early).some((b) => b.id === 'd')).toBe(
      false,
    )
  })
  it('handles reversed bounds', () => {
    expect(orphansInRange(all, '2026-07-25', '2026-07-18', early)).toHaveLength(3)
  })
  it('excludes cancelled bookings', () => {
    const cancelled = [bk({ startAt: tue12, status: 'cancelled' })]
    expect(orphansInRange(cancelled, '2026-07-01', '2026-07-31', early)).toHaveLength(0)
  })
})

describe('orphansUnderWeek (trigger B — veckoschema change)', () => {
  const now = at('2026-07-01T00:00:00+02:00')

  it('flags a booking when its weekday is turned off', () => {
    expect(
      orphansUnderWeek([bk({ startAt: tue12 })], week({ 2: { working: false } }), now),
    ).toHaveLength(1)
  })
  it('flags a booking that falls outside narrowed hours', () => {
    expect(
      orphansUnderWeek([bk({ startAt: tue12 })], week({ 2: { endMin: 720 } }), now),
    ).toHaveLength(1)
  })
  it('does NOT flag a booking that still fits', () => {
    expect(orphansUnderWeek([bk({ startAt: tue12 })], week(), now)).toHaveLength(0)
  })
  it('ignores past bookings even if they would not fit', () => {
    const past = bk({ startAt: at('2026-06-16T12:00:00+02:00') }) // before `now`
    expect(orphansUnderWeek([past], week({ 2: { working: false } }), now)).toHaveLength(0)
  })
  it('ignores cancelled bookings', () => {
    const cancelled = bk({ startAt: tue12, status: 'cancelled' })
    expect(orphansUnderWeek([cancelled], week({ 2: { working: false } }), now)).toHaveLength(0)
  })
})

// The database flags a confirmed booking as a conflict while `end_at > now()` (admin_save_barber_week,
// admin_add_time_off, admin_add_slot_block, admin_add_recurring_break). Each client pre-check must
// agree, or the barber is warned differently from what the server enforces: an in-progress booking
// warns, a finished one does not, and one that ends exactly now is finished.
describe('conflict window: confirmed && endAt > now, for every pre-check', () => {
  const now = at('2026-07-21T10:00:00+02:00') // Tuesday 10:00 salon-local
  const tue = (hhmm: string): Date => at(`2026-07-21T${hhmm}:00+02:00`)
  const finished = bk({ id: 'finished', startAt: tue('08:00') }) // 08:00–08:45
  const endsNow = bk({ id: 'ends-now', startAt: tue('09:15') }) // 09:15–10:00, endAt === now
  const inProgress = bk({ id: 'in-progress', startAt: tue('09:30') }) // 09:30–10:15
  const upcoming = bk({ id: 'upcoming', startAt: tue('12:00') }) // 12:00–12:45
  const all = [finished, endsNow, inProgress, upcoming]

  type PreCheck = (bookings: readonly AdminBooking[]) => readonly AdminBooking[]
  // Each scenario makes every Tuesday booking a candidate orphan, so only the time window decides.
  const preChecks: readonly (readonly [string, PreCheck])[] = [
    ['orphansOnDate', (b) => orphansOnDate(b, '2026-07-21', now)],
    ['orphansInRange', (b) => orphansInRange(b, '2026-07-20', '2026-07-22', now)],
    ['orphansUnderWeek', (b) => orphansUnderWeek(b, week({ 2: { working: false } }), now)],
  ]

  describe.each(preChecks)('%s', (_name, preCheck) => {
    it('counts in-progress and upcoming bookings, not finished ones', () => {
      expect(preCheck(all).map((b) => b.id)).toEqual(['in-progress', 'upcoming'])
    })
    it('counts an in-progress booking (started, not yet ended)', () => {
      expect(preCheck([inProgress]).map((b) => b.id)).toEqual(['in-progress'])
    })
    it('does not count a booking that ended before now', () => {
      expect(preCheck([finished])).toHaveLength(0)
    })
    it('treats a booking whose end is exactly now as finished', () => {
      expect(preCheck([endsNow])).toHaveLength(0)
    })
    it('counts an upcoming booking', () => {
      expect(preCheck([upcoming]).map((b) => b.id)).toEqual(['upcoming'])
    })
    it('ignores a cancelled in-progress booking', () => {
      expect(preCheck([bk({ ...inProgress, status: 'cancelled' })])).toHaveLength(0)
    })
  })
})

describe('partitionCancellations', () => {
  const a = bk({ id: 'a', startAt: tue12 })
  const b = bk({ id: 'b', startAt: tue12 })
  const c = bk({ id: 'c', startAt: tue12 })

  it('puts every booking in `done` when all cancels succeed', () => {
    const out = partitionCancellations([a, b, c], [true, true, true])
    expect(out.done.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(out.failed).toHaveLength(0)
  })
  it('puts every booking in `failed` when all cancels fail', () => {
    const out = partitionCancellations([a, b, c], [false, false, false])
    expect(out.failed.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(out.done).toHaveLength(0)
  })
  it('splits a mixed batch, preserving order in each bucket', () => {
    const out = partitionCancellations([a, b, c], [true, false, true])
    expect(out.done.map((x) => x.id)).toEqual(['a', 'c'])
    expect(out.failed.map((x) => x.id)).toEqual(['b'])
  })
  it('treats a missing ok-flag as failed (never assumes success)', () => {
    // Short `oks` (e.g. the loop threw before the last attempt) → the untried booking is failed.
    const out = partitionCancellations([a, b, c], [true])
    expect(out.done.map((x) => x.id)).toEqual(['a'])
    expect(out.failed.map((x) => x.id)).toEqual(['b', 'c'])
  })
  it('returns two empty buckets for an empty batch', () => {
    const out = partitionCancellations([], [])
    expect(out.done).toHaveLength(0)
    expect(out.failed).toHaveLength(0)
  })
})
