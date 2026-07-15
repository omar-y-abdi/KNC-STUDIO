import { describe, it, expect } from 'vitest'
import { formatRowLabel, splitByTime } from '../../src/mybookings/format'
import { FALLBACK_BARBER } from '../../src/booking/barbers'
import type { MyBooking } from '../../src/mybookings/domain'

// "now"/dates are injected, so these are fully deterministic (no clock read, no DOM).
function mk(start: Date, id: string): MyBooking {
  return {
    id,
    barber: FALLBACK_BARBER,
    serviceName: 'Hår',
    price: 350,
    durationMin: 45,
    start,
    whenLabel: '',
  }
}

describe('formatRowLabel', () => {
  // 2026-07-13 is a Monday (2026-06-19 is a Friday per the existing demo fixtures).
  const d = new Date(2026, 6, 13, 12, 30)

  it('SV uses the "kl" separator', () => {
    expect(formatRowLabel('sv', d, 'kl ')).toBe('Måndag 13 juli kl 12:30')
  })

  it('EN drops the separator', () => {
    expect(formatRowLabel('en', d, '')).toBe('Monday 13 July 12:30')
  })

  it('zero-pads the time', () => {
    expect(formatRowLabel('sv', new Date(2026, 6, 13, 9, 5), 'kl ')).toBe('Måndag 13 juli kl 09:05')
  })
})

describe('splitByTime', () => {
  const now = new Date(2026, 5, 19, 12, 0)

  it('splits around now: upcoming soonest-first, past most-recent-first', () => {
    const all = [
      mk(new Date(2026, 5, 25), 'up-b'),
      mk(new Date(2026, 5, 20), 'up-a'),
      mk(new Date(2026, 5, 10), 'past-a'),
      mk(new Date(2026, 5, 1), 'past-b'),
    ]
    const { upcoming, past } = splitByTime(all, now)
    expect(upcoming.map((b) => b.id)).toEqual(['up-a', 'up-b'])
    expect(past.map((b) => b.id)).toEqual(['past-a', 'past-b'])
  })

  it('treats a booking at/before now as past', () => {
    const { upcoming, past } = splitByTime([mk(now, 'atnow')], now)
    expect(upcoming).toHaveLength(0)
    expect(past.map((b) => b.id)).toEqual(['atnow'])
  })

  it('does not mutate the input array', () => {
    const all = [mk(new Date(2026, 5, 25), 'a'), mk(new Date(2026, 5, 20), 'b')]
    const before = all.map((b) => b.id)
    splitByTime(all, now)
    expect(all.map((b) => b.id)).toEqual(before)
  })
})
