import { describe, it, expect } from 'vitest'
import { packSlots } from '../../src/booking/slotPacking'
import type { BlockedInterval } from '../../src/booking/slotPacking'

// packSlots is the pure TS twin of the SQL `available_slots` RPC. These cases mirror EVERY worked
// example in `.claude/runtime/SLOT_PACKING_SPEC.md` (open 09:00–18:00 = [540, 1080], STEP = 15) plus
// the edge cases the spec calls out (past-filter via nowMin, empty window, non-positive duration,
// overlapping blocks). Candidate starts step on a FIXED 15-min grid anchored at open; the duration
// only gates the fit test and the last start. No effects, no clock — every input is explicit.

const OPEN = 540 // 09:00
const CLOSE = 1080 // 18:00
const NO_BLOCKS: readonly BlockedInterval[] = []
const FUTURE = -1 // nowMin < openMin → no past filtering

/** The expected 15-min grid over `[from, until)` for a service `dur`: ticks `from, from+15, …` while
 * `t + dur <= until`. The stride is ALWAYS 15; `dur` only gates the last tick (it is NOT the stride). */
function grid15(dur: number, from = OPEN, until = CLOSE): string[] {
  const out: string[] = []
  for (let t = from; t + dur <= until; t += 15) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
  }
  return out
}

describe('packSlots — empty day, fixed 15-min grid (duration gates only the last start)', () => {
  it('30-min service → 09:00,09:15,…,17:30 (35 ticks, last fits exactly at close)', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    expect(slots).toHaveLength(35)
    expect(slots[0]).toBe('09:00')
    expect(slots[slots.length - 1]).toBe('17:30') // 1050 + 30 = 1080 = close
    expect(slots).toEqual(grid15(30))
  })

  it('45-min service → 09:00,09:15,…,17:15 (34 ticks, every quarter-hour)', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 45,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    expect(slots).toHaveLength(34)
    expect(slots[0]).toBe('09:00')
    expect(slots[slots.length - 1]).toBe('17:15') // 1035 + 45 = 1080 = close
    expect(slots).toEqual(grid15(45))
  })

  it('90-min service → 09:00,09:15,…,16:30 (31 ticks)', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 90,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    expect(slots).toHaveLength(31)
    expect(slots[0]).toBe('09:00')
    expect(slots[slots.length - 1]).toBe('16:30') // 990 + 90 = 1080 = close
    expect(slots).toEqual(grid15(90))
  })
})

describe('packSlots — packing around a booking (ticks whose window overlaps drop out)', () => {
  it('booking 09:00–10:30, 30-min service → 15-min ticks from 10:30 (the tick at the booking end)', () => {
    const blocked: readonly BlockedInterval[] = [[540, 630]] // 09:00–10:30
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked,
      nowMin: FUTURE,
    })
    // First tick whose [t, t+30) clears the block is t=630 (630 >= be=630, half-open).
    expect(slots[0]).toBe('10:30')
    expect(slots).not.toContain('09:00')
    expect(slots).not.toContain('09:30')
    expect(slots).not.toContain('10:00')
    expect(slots).not.toContain('10:15')
    expect(slots[slots.length - 1]).toBe('17:30')
    expect(slots).toHaveLength(29)
    expect(slots).toEqual(grid15(30, 630)) // tail [630, 1080) on the 15-min grid
  })

  it('booking 09:00–09:45, 30-min service → 09:45,10:00,10:15,… (10:00 now FITS — inverts the old model)', () => {
    const blocked: readonly BlockedInterval[] = [[540, 585]] // 09:00–09:45
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked,
      nowMin: FUTURE,
    })
    expect(slots[0]).toBe('09:45')
    // 10:00 = 600: [600, 630) vs block [540, 585) → 600 >= 585, so it FITS. Under the OLD
    // duration-stepped model 10:00 was skipped; the fixed 15-min grid now offers it.
    expect(slots).toContain('10:00')
    expect(slots).toContain('10:15')
    expect(slots).toContain('10:45')
    expect(slots).not.toContain('09:00')
    expect(slots).not.toContain('09:15')
    expect(slots).not.toContain('09:30')
  })

  it('mid-day booking 10:00–11:30, 30-min service → 09:00,09:15,09:30 then 11:30,…,17:30', () => {
    const blocked: readonly BlockedInterval[] = [[600, 690]] // 10:00–11:30
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked,
      nowMin: FUTURE,
    })
    // Leading ticks: 09:30 + 30 = 10:00 ends exactly at the block start → still fits (half-open).
    expect(slots.slice(0, 3)).toEqual(['09:00', '09:15', '09:30'])
    expect(slots).not.toContain('10:00')
    expect(slots).not.toContain('10:30')
    expect(slots).not.toContain('11:00')
    // The first tick clearing the block is its end, 11:30.
    expect(slots).toContain('11:30')
    expect(slots[slots.length - 1]).toBe('17:30')
  })
})

describe('packSlots — now-filter for today (candidate valid iff t > nowMin)', () => {
  it('drops candidates at or before nowMin; first-keeps the next 15-min tick', () => {
    // nowMin = 09:30 (570): ticks 540/555/570 are NOT strictly after → dropped; 585 = 09:45 is first.
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked: NO_BLOCKS,
      nowMin: 570,
    })
    expect(slots[0]).toBe('09:45')
    expect(slots).not.toContain('09:00')
    expect(slots).not.toContain('09:30')
  })

  it('a future date (nowMin < openMin) filters nothing', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    expect(slots[0]).toBe('09:00')
  })
})

describe('packSlots — degenerate inputs return no slots', () => {
  it('closeMin <= openMin → []', () => {
    expect(
      packSlots({
        openMin: 600,
        closeMin: 600,
        durationMin: 30,
        blocked: NO_BLOCKS,
        nowMin: FUTURE,
      }),
    ).toEqual([])
    expect(
      packSlots({
        openMin: 700,
        closeMin: 600,
        durationMin: 30,
        blocked: NO_BLOCKS,
        nowMin: FUTURE,
      }),
    ).toEqual([])
  })

  it('durationMin <= 0 → []', () => {
    expect(
      packSlots({
        openMin: OPEN,
        closeMin: CLOSE,
        durationMin: 0,
        blocked: NO_BLOCKS,
        nowMin: FUTURE,
      }),
    ).toEqual([])
    expect(
      packSlots({
        openMin: OPEN,
        closeMin: CLOSE,
        durationMin: -30,
        blocked: NO_BLOCKS,
        nowMin: FUTURE,
      }),
    ).toEqual([])
  })
})

describe('packSlots — robustness', () => {
  it('tolerates overlapping / unsorted blocked intervals with no pre-merge', () => {
    // Overlapping blocks [10:00,11:00) and [10:30,12:00), passed OUT OF ORDER → union [10:00,12:00).
    const blocked: readonly BlockedInterval[] = [
      [630, 720], // 10:30–12:00
      [600, 660], // 10:00–11:00
    ]
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked,
      nowMin: FUTURE,
    })
    // 09:30 + 30 = 10:00 ends exactly at the union start → fits (the last leading tick).
    expect(slots.slice(0, 3)).toEqual(['09:00', '09:15', '09:30'])
    expect(slots).toContain('12:00') // first tick clearing the union end (720)
    expect(slots).not.toContain('10:00')
    expect(slots).not.toContain('10:30')
    expect(slots).not.toContain('11:00')
    expect(slots).not.toContain('11:30')
  })

  it('does not mutate the caller’s blocked array', () => {
    const blocked: readonly BlockedInterval[] = [
      [630, 720],
      [600, 660],
    ]
    const before = blocked.map((b) => [b[0], b[1]] as const)
    packSlots({ openMin: OPEN, closeMin: CLOSE, durationMin: 30, blocked, nowMin: FUTURE })
    expect(blocked).toEqual(before)
  })

  it('emits ascending, zero-padded HH:MM strings', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 45,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    for (const s of slots) expect(s).toMatch(/^\d{2}:\d{2}$/)
    const sortedAsc = [...slots].sort()
    expect(slots).toEqual(sortedAsc)
  })
})
