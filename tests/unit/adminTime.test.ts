// Unit tests for the pure schedule/time helpers (no mocks, no I/O). These cover the minutes->HH:MM
// formatting, the "samma tid alla dagar" reducer, per-day edits, validation, and the week
// normalization — the logic the schedule editor relies on.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_END_MIN,
  DEFAULT_START_MIN,
  END_OPTIONS,
  SLOT_LEN_MIN,
  START_OPTIONS,
  daySlots,
  defaultWeek,
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
import type { DaySchedule, SlotBlock, TimeOff, WeekSchedule } from '../../src/admin/types'

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

// --- Day grid helpers (migration 0017 / the one-tap block view) -----------------------------------

const workDay: DaySchedule = { weekday: 1, working: true, startMin: 540, endMin: 1080 }

function block(startMin: number, endMin: number, id = 'b1'): SlotBlock {
  return { id, barberId: 'hassan', date: '2099-01-05', startMin, endMin }
}

describe('daySlots', () => {
  it('a full working day with nothing else is 12 open slots', () => {
    const slots = daySlots({
      day: workDay,
      dayOff: false,
      blocks: [],
      bookings: [],
      pastCutoffMin: 0,
    })
    expect(slots).toHaveLength(12)
    expect(slots.every((s) => s.state === 'open')).toBe(true)
    expect(slots[0]).toMatchObject({ startMin: 540, label: '09:00' })
  })

  it('a non-working day (or missing row, or time off) is fully closed', () => {
    const offDay = { ...workDay, working: false }
    for (const args of [
      { day: offDay, dayOff: false },
      { day: undefined, dayOff: false },
      { day: workDay, dayOff: true },
    ]) {
      const slots = daySlots({ ...args, blocks: [], bookings: [], pastCutoffMin: 0 })
      expect(slots.every((s) => s.state === 'closed')).toBe(true)
    }
  })

  it('slots outside the working window are closed (start AND end must fit)', () => {
    const lateStart = { ...workDay, startMin: 630, endMin: 900 } // 10:30–15:00
    const states = daySlots({
      day: lateStart,
      dayOff: false,
      blocks: [],
      bookings: [],
      pastCutoffMin: 0,
    }).map((s) => s.state)
    // 09:00, 09:45 closed; 10:30..14:15(+45=900) open; 15:00 onwards closed.
    expect(states).toEqual([
      'closed',
      'closed',
      'open',
      'open',
      'open',
      'open',
      'open',
      'open',
      'closed',
      'closed',
      'closed',
      'closed',
    ])
  })

  it('a block row marks exactly the slots it overlaps and carries its id', () => {
    const slots = daySlots({
      day: workDay,
      dayOff: false,
      blocks: [block(630, 675)],
      bookings: [],
      pastCutoffMin: 0,
    })
    expect(slots.find((s) => s.startMin === 630)).toMatchObject({ state: 'blocked', blockId: 'b1' })
    // Half-open: the 11:15 neighbour is untouched.
    expect(slots.find((s) => s.startMin === 675)?.state).toBe('open')
  })

  it('a range block covers every slot in its window', () => {
    const slots = daySlots({
      day: workDay,
      dayOff: false,
      blocks: [block(720, 900)],
      bookings: [],
      pastCutoffMin: 0,
    })
    expect(slots.filter((s) => s.state === 'blocked').map((s) => s.startMin)).toEqual([
      720, 765, 810, 855,
    ])
  })

  it('a booking beats a block and carries its label; past only dims otherwise-open slots', () => {
    const slots = daySlots({
      day: workDay,
      dayOff: false,
      blocks: [block(630, 675)],
      bookings: [{ startMin: 630, endMin: 675, label: 'Anna' }],
      pastCutoffMin: 600, // "now" is 10:00 -> 09:00 + 09:45 are past
    })
    expect(slots.find((s) => s.startMin === 630)).toMatchObject({
      state: 'booked',
      bookingLabel: 'Anna',
      blockId: null,
    })
    expect(slots[0]?.state).toBe('past')
    expect(slots[1]?.state).toBe('past')
    expect(slots.find((s) => s.startMin === 675)?.state).toBe('open')
  })

  it('SLOT_LEN_MIN matches the 45-min option grid', () => {
    expect(SLOT_LEN_MIN).toBe(45)
    expect((START_OPTIONS[1]?.min ?? 0) - (START_OPTIONS[0]?.min ?? 0)).toBe(SLOT_LEN_MIN)
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
