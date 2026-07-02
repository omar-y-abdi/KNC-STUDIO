// Unit tests for the pure schedule/time helpers (no mocks, no I/O). These cover the minutes->HH:MM
// formatting, the "samma tid alla dagar" reducer, per-day edits, validation, and the week
// normalization — the logic the schedule editor relies on.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_END_MIN,
  DEFAULT_START_MIN,
  END_OPTIONS,
  START_OPTIONS,
  defaultWeek,
  isValidWindow,
  minutesToHHMM,
  sameTimeAllDays,
  setDayHours,
  toDateIso,
  toWeekSchedule,
  toggleWorking,
  weekIsValid,
} from '../../src/admin/time'
import type { DaySchedule, WeekSchedule } from '../../src/admin/types'

describe('minutesToHHMM', () => {
  it('formats whole and partial hours zero-padded', () => {
    expect(minutesToHHMM(0)).toBe('00:00')
    expect(minutesToHHMM(540)).toBe('09:00')
    expect(minutesToHHMM(585)).toBe('09:45')
    expect(minutesToHHMM(1080)).toBe('18:00')
    expect(minutesToHHMM(1439)).toBe('23:59')
  })

  it('is total: clamps negatives to 00:00', () => {
    expect(minutesToHHMM(-30)).toBe('00:00')
  })
})

describe('time option grids', () => {
  it('start options are 09:00..17:15 in 45-min steps', () => {
    expect(START_OPTIONS[0]?.min).toBe(540)
    expect(START_OPTIONS[START_OPTIONS.length - 1]?.min).toBe(1035)
    for (let i = 1; i < START_OPTIONS.length; i++) {
      expect((START_OPTIONS[i]?.min ?? 0) - (START_OPTIONS[i - 1]?.min ?? 0)).toBe(45)
    }
  })

  it('end options are 09:45..18:00 in 45-min steps', () => {
    expect(END_OPTIONS[0]?.min).toBe(585)
    expect(END_OPTIONS[END_OPTIONS.length - 1]?.min).toBe(1080)
  })
})

describe('defaultWeek', () => {
  it('is Mon–Sat working 09:00–18:00, Sunday closed', () => {
    const w = defaultWeek()
    expect(w).toHaveLength(7)
    expect(w[0].working).toBe(false) // Sunday
    for (let d = 1; d <= 6; d++) {
      expect(w[d]?.working).toBe(true)
      expect(w[d]?.startMin).toBe(DEFAULT_START_MIN)
      expect(w[d]?.endMin).toBe(DEFAULT_END_MIN)
    }
  })

  it('indices align with weekday (w[i].weekday === i)', () => {
    const w = defaultWeek()
    w.forEach((d, i) => expect(d.weekday).toBe(i))
  })
})

describe('toWeekSchedule', () => {
  it('fills missing weekdays with defaults and honors provided rows', () => {
    const partial: DaySchedule[] = [
      { weekday: 3, working: true, startMin: 600, endMin: 900 },
      { weekday: 0, working: true, startMin: 660, endMin: 720 },
    ]
    const w = toWeekSchedule(partial)
    expect(w[3]?.startMin).toBe(600)
    expect(w[3]?.endMin).toBe(900)
    expect(w[0]?.working).toBe(true) // overridden from default-closed
    // A weekday not provided keeps the default.
    expect(w[1]?.working).toBe(true)
    expect(w[1]?.startMin).toBe(540)
  })

  it('produces a complete 7-entry, weekday-indexed week', () => {
    const w = toWeekSchedule([])
    expect(w).toHaveLength(7)
    w.forEach((d, i) => expect(d.weekday).toBe(i))
  })
})

describe('sameTimeAllDays', () => {
  it('applies one window to every WORKING day, leaving closed days untouched', () => {
    const base = defaultWeek() // Sun closed, Mon–Sat 09–18
    const out = sameTimeAllDays(base, 600, 960) // 10:00–16:00
    expect(out[0]?.working).toBe(false)
    expect(out[0]?.startMin).toBe(540) // closed day untouched
    for (let d = 1; d <= 6; d++) {
      expect(out[d]?.startMin).toBe(600)
      expect(out[d]?.endMin).toBe(960)
    }
  })

  it('does not mutate the input (immutability)', () => {
    const base = defaultWeek()
    const snapshot = JSON.stringify(base)
    sameTimeAllDays(base, 600, 960)
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})

describe('toggleWorking + setDayHours', () => {
  it('toggleWorking flips exactly one day, immutably', () => {
    const base = defaultWeek()
    const out = toggleWorking(base, 0) // open Sunday
    expect(out[0]?.working).toBe(true)
    expect(base[0]?.working).toBe(false) // input unchanged
    // other days unchanged
    expect(out[1]?.working).toBe(true)
  })

  it('setDayHours updates only the target day', () => {
    const base = defaultWeek()
    const out = setDayHours(base, 2, 630, 870)
    expect(out[2]?.startMin).toBe(630)
    expect(out[2]?.endMin).toBe(870)
    expect(out[1]?.startMin).toBe(540) // neighbor unchanged
    expect(base[2]?.startMin).toBe(540) // input unchanged
  })
})

describe('isValidWindow + weekIsValid', () => {
  it('a working day needs end > start; a closed day is always valid', () => {
    expect(isValidWindow({ weekday: 1, working: true, startMin: 540, endMin: 1080 })).toBe(true)
    expect(isValidWindow({ weekday: 1, working: true, startMin: 1080, endMin: 540 })).toBe(false)
    expect(isValidWindow({ weekday: 1, working: true, startMin: 600, endMin: 600 })).toBe(false)
    expect(isValidWindow({ weekday: 0, working: false, startMin: 1080, endMin: 540 })).toBe(true)
  })

  it('weekIsValid requires every day to validate', () => {
    expect(weekIsValid(defaultWeek())).toBe(true)
    const bad = setDayHours(defaultWeek(), 1, 1000, 900) as WeekSchedule
    expect(weekIsValid(bad)).toBe(false)
  })
})

describe('toDateIso', () => {
  it('formats a local date as YYYY-MM-DD zero-padded', () => {
    expect(toDateIso(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toDateIso(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
