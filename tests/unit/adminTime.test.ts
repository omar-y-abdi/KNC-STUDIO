// Unit tests for the pure schedule/time helpers (no mocks, no I/O). These cover the minutes->HH:MM
// formatting, the "samma tid alla dagar" reducer, per-day edits, validation, and the week
// normalization — the logic the schedule editor relies on.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_END_MIN,
  DEFAULT_START_MIN,
  END_OPTIONS,
  QUARTER_LEN_MIN,
  START_OPTIONS,
  dayHours,
  defaultWeek,
  isSlotTappable,
  isValidWindow,
  minutesToHHMM,
  sameTimeAllDays,
  setDayHours,
  timeOffCovering,
  toDateIso,
  toWeekSchedule,
  toggleWorking,
  upcomingDates,
  weekIsValid,
} from '../../src/admin/time'
import type {
  DaySchedule,
  RecurringBreak,
  SlotBlock,
  TimeOff,
  WeekSchedule,
} from '../../src/admin/types'

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
  it('start options are 09:00..17:45 in 15-min steps', () => {
    expect(START_OPTIONS[0]?.min).toBe(540)
    expect(START_OPTIONS[START_OPTIONS.length - 1]?.min).toBe(1065)
    for (let i = 1; i < START_OPTIONS.length; i++) {
      expect((START_OPTIONS[i]?.min ?? 0) - (START_OPTIONS[i - 1]?.min ?? 0)).toBe(15)
    }
  })

  it('end options are 09:15..18:00 in 15-min steps', () => {
    expect(END_OPTIONS[0]?.min).toBe(555)
    expect(END_OPTIONS[END_OPTIONS.length - 1]?.min).toBe(1080)
    for (let i = 1; i < END_OPTIONS.length; i++) {
      expect((END_OPTIONS[i]?.min ?? 0) - (END_OPTIONS[i - 1]?.min ?? 0)).toBe(15)
    }
  })
})

describe('defaultWeek', () => {
  it('is off for every day until a barber saves working hours', () => {
    const w = defaultWeek()
    expect(w).toHaveLength(7)
    for (let d = 0; d <= 6; d++) {
      expect(w[d]?.working).toBe(false)
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
    // A weekday not provided stays off by default.
    expect(w[1]?.working).toBe(false)
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
    const base = defaultWeek().map((day) => (day.weekday === 1 ? { ...day, working: true } : day))
    const out = sameTimeAllDays(base, 600, 960) // 10:00–16:00
    expect(out[0]?.working).toBe(false)
    expect(out[0]?.startMin).toBe(540) // closed day untouched
    expect(out[1]?.startMin).toBe(600)
    expect(out[1]?.endMin).toBe(960)
    expect(out[2]?.startMin).toBe(540)
  })

  it('does not mutate the input (immutability)', () => {
    const base = defaultWeek().map((day) => (day.weekday === 1 ? { ...day, working: true } : day))
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
    expect(out[1]?.working).toBe(false)
  })

  it('setDayHours updates only the target day', () => {
    const base = defaultWeek().map((day) => (day.weekday === 1 ? { ...day, working: true } : day))
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
    const workingMonday = defaultWeek().map((day) =>
      day.weekday === 1 ? { ...day, working: true } : day,
    ) as WeekSchedule
    const bad = setDayHours(workingMonday, 1, 1000, 900) as WeekSchedule
    expect(weekIsValid(bad)).toBe(false)
  })
})

describe('toDateIso', () => {
  it('formats a local date as YYYY-MM-DD zero-padded', () => {
    expect(toDateIso(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toDateIso(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

// --- Day grid helpers (migration 0017 / the quarter-grid block view) -----------------------------------

const workDay: DaySchedule = { weekday: 1, working: true, startMin: 540, endMin: 1080 }

function block(startMin: number, endMin: number, id = 'b1'): SlotBlock {
  return { id, barberId: 'hassan', date: '2099-01-05', startMin, endMin }
}

function recurringBreak(startMin: number, endMin: number): RecurringBreak {
  return { id: 'r1', barberId: 'hassan', weekday: 1, startMin, endMin }
}

/** Flatten the hour groups into the 36 quarters for easy assertions. */
function quarters(args: Parameters<typeof dayHours>[0]) {
  return dayHours(args).flatMap((h) => h.quarters)
}

describe('dayHours', () => {
  it('covers 09:00-18:00 as 9 hour groups of four 15-min quarters', () => {
    const hours = dayHours({
      day: workDay,
      dayOff: false,
      blocks: [],
      recurringBreaks: [],
      bookings: [],
      pastCutoffMin: 0,
    })
    expect(hours).toHaveLength(9)
    expect(hours[0]).toMatchObject({ startMin: 540, label: '09:00' })
    expect(hours[8]).toMatchObject({ startMin: 1020, label: '17:00' })
    expect(hours.every((h) => h.quarters.length === 4)).toBe(true)
    const all = hours.flatMap((h) => h.quarters)
    expect(all).toHaveLength(36)
    expect(all[0]).toMatchObject({ startMin: 540, label: '09:00' })
    expect(all[35]).toMatchObject({ startMin: 1065, label: '17:45' })
    expect(all.every((q) => q.state === 'open')).toBe(true)
  })

  it('a non-working day (or missing row, or time off) is fully closed', () => {
    const offDay = { ...workDay, working: false }
    for (const args of [
      { day: offDay, dayOff: false },
      { day: undefined, dayOff: false },
      { day: workDay, dayOff: true },
    ]) {
      const all = quarters({
        ...args,
        blocks: [],
        recurringBreaks: [],
        bookings: [],
        pastCutoffMin: 0,
      })
      expect(all.every((q) => q.state === 'closed')).toBe(true)
    }
  })

  it('quarters outside the working window are closed (start AND end must fit)', () => {
    const lateStart = { ...workDay, startMin: 630, endMin: 900 } // 10:30-15:00
    const all = quarters({
      day: lateStart,
      dayOff: false,
      blocks: [],
      recurringBreaks: [],
      bookings: [],
      pastCutoffMin: 0,
    })
    expect(all.filter((q) => q.state === 'open').map((q) => q.startMin)).toEqual(
      // 10:30..14:45 inclusive - the last quarter ending exactly at 15:00 still fits.
      Array.from({ length: 18 }, (_, i) => 630 + i * 15),
    )
  })

  it('a 15-min block row marks exactly one quarter and carries its id', () => {
    const all = quarters({
      day: workDay,
      dayOff: false,
      blocks: [block(630, 645)],
      recurringBreaks: [],
      bookings: [],
      pastCutoffMin: 0,
    })
    expect(all.find((q) => q.startMin === 630)).toMatchObject({ state: 'blocked', blockId: 'b1' })
    // Half-open: the neighbours are untouched.
    expect(all.find((q) => q.startMin === 615)?.state).toBe('open')
    expect(all.find((q) => q.startMin === 645)?.state).toBe('open')
  })

  it('a range block covers every quarter in its window', () => {
    const all = quarters({
      day: workDay,
      dayOff: false,
      blocks: [block(720, 780)],
      recurringBreaks: [],
      bookings: [],
      pastCutoffMin: 0,
    })
    expect(all.filter((q) => q.state === 'blocked').map((q) => q.startMin)).toEqual([
      720, 735, 750, 765,
    ])
  })

  it('makes recurring-break quarters inert while adjacent quarters remain open', () => {
    const all = quarters({
      day: workDay,
      dayOff: false,
      blocks: [block(720, 735)],
      recurringBreaks: [recurringBreak(720, 780)],
      bookings: [],
      pastCutoffMin: 0,
    })

    expect(all.filter((q) => q.state === 'recurring_break').map((q) => q.startMin)).toEqual([
      720, 735, 750, 765,
    ])
    expect(all.find((q) => q.startMin === 705)?.state).toBe('open')
    expect(all.find((q) => q.startMin === 780)?.state).toBe('open')
    expect(isSlotTappable(all.find((q) => q.startMin === 720)?.state ?? 'open')).toBe(false)
    expect(isSlotTappable(all.find((q) => q.startMin === 705)?.state ?? 'closed')).toBe(true)
  })

  it('a booking beats a block, spans its true quarters, and carries its label', () => {
    const all = quarters({
      day: workDay,
      dayOff: false,
      blocks: [block(630, 645)],
      recurringBreaks: [],
      // 45-min booking 10:30-11:15 -> quarters 10:30, 10:45, 11:00 (11:15 starts AT its end).
      bookings: [{ startMin: 630, endMin: 675, label: 'Anna' }],
      pastCutoffMin: 600, // "now" is 10:00 -> 09:00..09:45 quarters are past
    })
    expect(all.find((q) => q.startMin === 630)).toMatchObject({
      state: 'booked',
      bookingLabel: 'Anna',
      blockId: null,
    })
    expect(all.find((q) => q.startMin === 660)?.state).toBe('booked')
    expect(all.find((q) => q.startMin === 675)?.state).toBe('open')
    expect(all.filter((q) => q.state === 'past').map((q) => q.startMin)).toEqual([
      540, 555, 570, 585,
    ])
  })

  it('QUARTER_LEN_MIN is the 15-min write unit', () => {
    expect(QUARTER_LEN_MIN).toBe(15)
  })
})

describe('timeOffCovering', () => {
  const off: TimeOff = {
    id: 't1',
    barberId: 'hassan',
    startDate: '2099-01-04',
    endDate: '2099-01-06',
    reason: '',
  }
  it('finds the covering range inclusively on both ends', () => {
    expect(timeOffCovering([off], '2099-01-04')?.id).toBe('t1')
    expect(timeOffCovering([off], '2099-01-05')?.id).toBe('t1')
    expect(timeOffCovering([off], '2099-01-06')?.id).toBe('t1')
  })
  it('returns undefined outside the range', () => {
    expect(timeOffCovering([off], '2099-01-03')).toBeUndefined()
    expect(timeOffCovering([off], '2099-01-07')).toBeUndefined()
  })
})

describe('upcomingDates', () => {
  it('returns count consecutive local days starting at from', () => {
    const days = upcomingDates(new Date(2026, 5, 28), 5) // Jun 28 -> crosses into July
    expect(days).toHaveLength(5)
    expect(toDateIso(days[0] ?? new Date(0))).toBe('2026-06-28')
    expect(toDateIso(days[4] ?? new Date(0))).toBe('2026-07-02')
  })
})
