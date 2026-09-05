import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { pad2, cap, iso, buildWeeks, isSelectableBookingDate } from '../../src/booking/calendar'
import { stockholmWallClockDate } from '../../src/booking/stockholmTime'

describe('helpers', () => {
  it('pad2', () => {
    expect(pad2(5)).toBe('05')
    expect(pad2(12)).toBe('12')
  })
  it('cap', () => {
    expect(cap('june')).toBe('June')
    expect(cap('')).toBe('')
  })
  it('iso (local date, no timezone shift)', () => {
    expect(iso(new Date(2026, 5, 19))).toBe('2026-06-19')
    expect(iso(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
  it('keeps a configured future Sunday selectable', () => {
    const today = new Date(2040, 2, 12)
    const sunday = new Date(2040, 2, 18)

    expect(sunday.getDay()).toBe(0)
    expect(isSelectableBookingDate(sunday, today)).toBe(true)
  })

  it('uses the Stockholm wall-clock day when an injected clock crosses midnight during DST', () => {
    const today = stockholmWallClockDate(new Date('2040-03-31T22:30:00.000Z'))
    const previousDay = new Date(2040, 2, 31)
    const stockholmDay = new Date(2040, 3, 1)

    expect(iso(today)).toBe('2040-04-01')
    expect(isSelectableBookingDate(previousDay, today)).toBe(false)
    expect(isSelectableBookingDate(stockholmDay, today)).toBe(true)
  })

  it('normalizes the BookingFlow clock before deriving its calendar day', () => {
    const source = readFileSync('src/booking/BookingFlow.tsx', 'utf8')

    expect(source).toContain('stockholmWallClockDate(clock())')
  })
})

describe('buildWeeks (Monday-first month grid)', () => {
  const weeks = buildWeeks(2026, 5) // June 2026

  it('every week has exactly 7 cells', () => {
    for (const w of weeks) expect(w).toHaveLength(7)
  })
  it('contains all 30 June days in order, with null padding only', () => {
    const days = weeks
      .flat()
      .filter((c): c is Date => c !== null)
      .map((d) => d.getDate())
    expect(days).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
  })
})
