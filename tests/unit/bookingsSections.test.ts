// Unit tests for the pure bookings section/week partitioner (no mocks, no I/O). `nowMs` is injected so
// the "current time" is explicit and deterministic. Fixtures build `startAt` via `stockholmInstant`
// so each booking's Europe/Stockholm wall-clock day — the thing ISO-week bucketing keys on — is stated
// directly, and inputs are fed OUT OF ORDER so the ordering assertions actually exercise the sort.

import { describe, expect, it } from 'vitest'
import { partitionSections } from '../../src/admin/views/bookingsSections'
import type { AdminBooking } from '../../src/admin/types'
import { stockholmInstant } from '../../src/booking/stockholmTime'

// A fully-populated AdminBooking (all 13 fields); each test overrides only what it asserts on.
function booking(overrides: Partial<AdminBooking>): AdminBooking {
  return {
    id: 'b-default',
    barberId: 'barber-1',
    serviceName: 'Klippning',
    price: 400,
    durationMin: 45,
    startAt: new Date('2026-07-15T10:00:00.000Z'),
    endAt: new Date('2026-07-15T10:45:00.000Z'),
    customerName: 'Test Kund',
    method: 'sms',
    phone: '+46700000000',
    email: null,
    lang: 'sv',
    status: 'confirmed',
    ...overrides,
  }
}

// Deterministic "now": Stockholm wall-clock 2026-07-15 12:00 (Wednesday, ISO week 29).
const NOW = stockholmInstant(2026, 7, 15, 12, 0).getTime()

// Ids gathered across every group of a section, in section order.
function ids(groups: readonly { readonly bookings: readonly AdminBooking[] }[]): readonly string[] {
  return groups.flatMap((g) => g.bookings.map((b) => b.id))
}

describe('partitionSections — section routing', () => {
  it('routes cancelled → avbokade (even in the future), confirmed-future → kommande, confirmed-past → tidigare', () => {
    const cancelledFuture = booking({ id: 'cf', status: 'cancelled', startAt: stockholmInstant(2026, 7, 25, 12, 0) })
    const confirmedFuture = booking({ id: 'kf', status: 'confirmed', startAt: stockholmInstant(2026, 7, 25, 12, 0) })
    const confirmedPast = booking({ id: 'tp', status: 'confirmed', startAt: stockholmInstant(2026, 7, 1, 12, 0) })

    const { kommande, avbokade, tidigare } = partitionSections(
      [cancelledFuture, confirmedFuture, confirmedPast],
      NOW,
    )

    expect(ids(avbokade)).toEqual(['cf']) // cancelled, though its time is in the future
    expect(ids(kommande)).toEqual(['kf'])
    expect(ids(tidigare)).toEqual(['tp'])
  })

  it('counts a booking at exactly nowMs as kommande (the >= boundary)', () => {
    const atNow = booking({ id: 'at-now', status: 'confirmed', startAt: new Date(NOW) })
    const { kommande, tidigare } = partitionSections([atNow], NOW)
    expect(ids(kommande)).toEqual(['at-now'])
    expect(tidigare).toEqual([])
  })
})

describe('partitionSections — ISO-week bucketing', () => {
  it('groups two bookings in the same ISO week into a single WeekGroup', () => {
    const early = booking({ id: 'early', startAt: stockholmInstant(2026, 7, 20, 9, 0) }) // Mon, week 30
    const late = booking({ id: 'late', startAt: stockholmInstant(2026, 7, 24, 16, 0) }) // Fri, week 30
    const { kommande } = partitionSections([late, early], NOW) // fed out of order

    expect(kommande).toHaveLength(1)
    expect(kommande[0]?.isoWeekYear).toBe(2026)
    expect(kommande[0]?.isoWeek).toBe(30)
    expect(kommande[0]?.bookings.map((b) => b.id)).toEqual(['early', 'late']) // ascending within group
  })

  it('buckets a Dec-31 / Jan-1 pair sharing an ISO-week-year into ONE group (composite key, not calendar year)', () => {
    const dec31 = booking({ id: 'dec31', startAt: stockholmInstant(2026, 12, 31, 12, 0) }) // week 53 of 2026
    const jan01 = booking({ id: 'jan01', startAt: stockholmInstant(2027, 1, 1, 12, 0) }) // week 53 of 2026
    const { kommande } = partitionSections([jan01, dec31], NOW) // fed out of order

    expect(kommande).toHaveLength(1) // grouped by calendar year, these would split into two
    expect(kommande[0]?.isoWeekYear).toBe(2026)
    expect(kommande[0]?.isoWeek).toBe(53)
    expect(kommande[0]?.bookings.map((b) => b.id)).toEqual(['dec31', 'jan01'])
  })

  it('buckets by the Europe/Stockholm wall-clock day, not the UTC date (ISO-week tz boundary)', () => {
    const startAt = stockholmInstant(2026, 7, 13, 0, 30) // Stockholm Mon 2026-07-13 00:30 → ISO week 29
    // The underlying UTC instant is the PREVIOUS calendar day (Sunday), which is ISO week 28.
    expect(startAt.toISOString()).toBe('2026-07-12T22:30:00.000Z')

    const { tidigare } = partitionSections([booking({ id: 'boundary', startAt })], NOW)
    expect(tidigare).toHaveLength(1)
    expect(tidigare[0]?.isoWeek).toBe(29) // the Stockholm-Monday week, NOT the UTC-Sunday week 28
  })
})

describe('partitionSections — ordering within a section', () => {
  it('orders kommande groups ascending (soonest week first) and bookings ascending within a group', () => {
    const wk30later = booking({ id: 'w30-later', startAt: stockholmInstant(2026, 7, 22, 9, 0) }) // week 30
    const wk30early = booking({ id: 'w30-early', startAt: stockholmInstant(2026, 7, 20, 15, 0) }) // week 30
    const wk31 = booking({ id: 'w31', startAt: stockholmInstant(2026, 7, 28, 11, 0) }) // week 31
    // Fed with the later week first and the later booking first — the opposite of the expected order.
    const { kommande } = partitionSections([wk31, wk30later, wk30early], NOW)

    expect(kommande.map((g) => g.isoWeek)).toEqual([30, 31]) // groups ascending
    expect(kommande[0]?.bookings.map((b) => b.id)).toEqual(['w30-early', 'w30-later']) // 07-20 before 07-22
    expect(kommande[1]?.bookings.map((b) => b.id)).toEqual(['w31'])
  })

  it('orders tidigare groups descending (most-recent week first) and bookings descending within a group', () => {
    const wk27 = booking({ id: 't27', startAt: stockholmInstant(2026, 7, 1, 10, 0) }) // week 27
    const wk28early = booking({ id: 't28-early', startAt: stockholmInstant(2026, 7, 6, 9, 0) }) // week 28
    const wk28late = booking({ id: 't28-late', startAt: stockholmInstant(2026, 7, 8, 16, 0) }) // week 28
    // Fed ascending (the "wrong" direction for a descending section) to prove the sort runs.
    const { tidigare } = partitionSections([wk27, wk28early, wk28late], NOW)

    expect(tidigare.map((g) => g.isoWeek)).toEqual([28, 27]) // groups descending
    expect(tidigare[0]?.bookings.map((b) => b.id)).toEqual(['t28-late', 't28-early']) // 07-08 before 07-06
    expect(tidigare[1]?.bookings.map((b) => b.id)).toEqual(['t27'])
  })

  it('orders avbokade groups descending and includes cancelled bookings regardless of time', () => {
    const cancelledPast = booking({ id: 'cx-past', status: 'cancelled', startAt: stockholmInstant(2026, 7, 3, 12, 0) }) // week 27
    const cancelledFuture = booking({ id: 'cx-future', status: 'cancelled', startAt: stockholmInstant(2026, 7, 25, 12, 0) }) // week 30
    const { avbokade, kommande, tidigare } = partitionSections([cancelledPast, cancelledFuture], NOW)

    expect(avbokade.map((g) => g.isoWeek)).toEqual([30, 27]) // descending: future week 30 before past week 27
    expect(kommande).toEqual([]) // cancelled never leaks into kommande…
    expect(tidigare).toEqual([]) // …nor into tidigare
  })
})

describe('partitionSections — immutability', () => {
  it('does not mutate or reorder the caller’s input array', () => {
    const a = booking({ id: 'a', startAt: stockholmInstant(2026, 7, 28, 11, 0) })
    const b = booking({ id: 'b', startAt: stockholmInstant(2026, 7, 20, 9, 0) })
    const input = [a, b]
    const snapshot = [...input]

    partitionSections(input, NOW)

    expect(input).toEqual(snapshot) // same length + order — no in-place sort of the input
    expect(input[0]).toBe(a)
    expect(input[1]).toBe(b)
  })
})
