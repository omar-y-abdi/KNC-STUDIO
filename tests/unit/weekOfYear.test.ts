// Unit tests for the pure ISO-8601 week helper (no mocks, no I/O, no clock). The critical property is
// the composite `(isoWeekYear, isoWeek)`: at the Dec/Jan boundary the week-numbering year diverges
// from the calendar year, so grouping/sorting on the bare week number would collide across years.
// Fixtures cross-checked against the ISO-8601 calendar (week 1 = the week containing Jan 4).

import { describe, expect, it } from 'vitest'
import { isoWeek, weekLabel } from '../../src/admin/weekOfYear'

describe('isoWeek — composite week-year + week number at year boundaries', () => {
  it('2026-12-31 is week 53 of 2026 (calendar year and week-year agree here)', () => {
    expect(isoWeek(2026, 12, 31)).toEqual({ isoWeekYear: 2026, isoWeek: 53 })
  })

  it('2027-01-01 belongs to week 53 of 2026 (week-year TRAILS the calendar year)', () => {
    expect(isoWeek(2027, 1, 1)).toEqual({ isoWeekYear: 2026, isoWeek: 53 })
  })

  it('2020-12-31 is week 53 of 2020 (a 53-week year)', () => {
    expect(isoWeek(2020, 12, 31)).toEqual({ isoWeekYear: 2020, isoWeek: 53 })
  })

  it('2021-01-04 is week 1 of 2021 (the first week starts here)', () => {
    expect(isoWeek(2021, 1, 4)).toEqual({ isoWeekYear: 2021, isoWeek: 1 })
  })

  it('2024-01-01 is week 1 of 2024 (Jan 1 is a Monday → week 1 starts on Jan 1)', () => {
    expect(isoWeek(2024, 1, 1)).toEqual({ isoWeekYear: 2024, isoWeek: 1 })
  })

  it('a mid-year date (2026-07-15) is week 29 of 2026', () => {
    expect(isoWeek(2026, 7, 15)).toEqual({ isoWeekYear: 2026, isoWeek: 29 })
  })

  it('is deterministic from its args alone (pure UTC calendar math, no ambient timezone)', () => {
    // Same inputs → same output on every call/process; documents the module contract.
    expect(isoWeek(2026, 7, 15)).toEqual(isoWeek(2026, 7, 15))
  })
})

describe('weekLabel — compact sv/en label with a cross-year suffix', () => {
  it('sv: "v. {n}" when the week-year matches the current one', () => {
    expect(weekLabel({ isoWeekYear: 2026, isoWeek: 29 }, 2026, 'sv')).toBe('v. 29')
  })

  it('en: "wk {n}" when the week-year matches the current one', () => {
    expect(weekLabel({ isoWeekYear: 2026, isoWeek: 29 }, 2026, 'en')).toBe('wk 29')
  })

  it('sv: appends " · {year}" for a cross-year week (isoWeekYear differs from current)', () => {
    expect(weekLabel({ isoWeekYear: 2026, isoWeek: 53 }, 2027, 'sv')).toBe('v. 53 · 2026')
  })

  it('en: appends " · {year}" for a cross-year week (isoWeekYear differs from current)', () => {
    expect(weekLabel({ isoWeekYear: 2026, isoWeek: 53 }, 2027, 'en')).toBe('wk 53 · 2026')
  })
})
