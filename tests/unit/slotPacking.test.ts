import { describe, it, expect } from 'vitest'
import { packSlots } from '../../src/booking/slotPacking'
import type { BlockedInterval } from '../../src/booking/slotPacking'
import { SLOTS } from '../../src/booking/slots'

// packSlots is the pure TS twin of the SQL `available_slots` RPC. These cases mirror EVERY worked
// example in `.claude/runtime/SLOT_PACKING_SPEC.md` (open 09:00–18:00 = [540, 1080]) plus the edge
// cases the spec calls out (past-filter via nowMin, empty window, non-positive duration, overlapping
// blocks). No effects, no clock — every input is explicit.

const OPEN = 540 // 09:00
const CLOSE = 1080 // 18:00
const NO_BLOCKS: readonly BlockedInterval[] = []
const FUTURE = -1 // nowMin < openMin → no past filtering

/** Build the expected left-packed grid over `[OPEN, CLOSE)` for a step, for cross-checking. */
function grid(step: number, from = OPEN, until = CLOSE): string[] {
  const out: string[] = []
  for (let t = from; t + step <= until; t += step) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
  }
  return out
}

describe('packSlots — empty day, duration-stepped grids', () => {
  it('30-min service → 09:00,09:30,…,17:30 (18 slots, last fits exactly at close)', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    expect(slots).toHaveLength(18)
    expect(slots[0]).toBe('09:00')
    expect(slots[slots.length - 1]).toBe('17:30') // 1050 + 30 = 1080 = close
    expect(slots).toEqual(grid(30))
  })

  it('45-min service → the fixed 12-slot grid (== today’s SLOTS: 09:00,09:45,…,17:15)', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 45,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    expect(slots).toHaveLength(12)
    expect(slots).toEqual([...SLOTS])
  })

  it('90-min service → 09:00,10:30,12:00,13:30,15:00,16:30 (6 slots)', () => {
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 90,
      blocked: NO_BLOCKS,
      nowMin: FUTURE,
    })
    expect(slots).toEqual(['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'])
  })
})

describe('packSlots — packing around a booking (next slot starts exactly at the booking end)', () => {
  it('90-min booking 09:00–10:30, 30-min service → 30-min slots from 10:30 (the key requirement)', () => {
    const blocked: readonly BlockedInterval[] = [[540, 630]] // 09:00–10:30
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked,
      nowMin: FUTURE,
    })
    expect(slots[0]).toBe('10:30') // packs from the booking end, not the next 45-min tick
    expect(slots).not.toContain('09:00')
    expect(slots).not.toContain('09:30')
    expect(slots).not.toContain('10:00')
    expect(slots[slots.length - 1]).toBe('17:30')
    expect(slots).toEqual(grid(30, 630)) // tail [630, 1080] → 15 slots
  })

  it('45-min booking 09:00–09:45, 30-min service → 09:45,10:15,10:45,… (NOT 10:00)', () => {
    const blocked: readonly BlockedInterval[] = [[540, 585]] // 09:00–09:45
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked,
      nowMin: FUTURE,
    })
    expect(slots[0]).toBe('09:45')
    expect(slots).toContain('10:15')
    expect(slots).toContain('10:45')
    expect(slots).not.toContain('10:00')
    expect(slots).not.toContain('09:00')
    expect(slots).not.toContain('09:30')
  })

  it('mid-day booking 10:00–11:30, 30-min service → 09:00,09:30 then 11:30,12:00,…,17:30', () => {
    const blocked: readonly BlockedInterval[] = [[600, 690]] // 10:00–11:30
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked,
      nowMin: FUTURE,
    })
    // Leading gap [540, 600): a slot ending exactly at the block start (09:30 + 30 = 10:00) is fine.
    expect(slots.slice(0, 2)).toEqual(['09:00', '09:30'])
    expect(slots).not.toContain('10:00')
    expect(slots).not.toContain('10:30')
    expect(slots).not.toContain('11:00')
    // Tail packs from the block end (11:30), not the open-time cadence.
    expect(slots).toContain('11:30')
    expect(slots[slots.length - 1]).toBe('17:30')
  })
})

describe('packSlots — now-filter for today (candidate valid iff t > nowMin)', () => {
  it('drops candidates at or before nowMin; keeps strictly-later ones', () => {
    // nowMin = 09:30 (570): 09:00 (540) and 09:30 (570) are NOT strictly after → dropped.
    const slots = packSlots({
      openMin: OPEN,
      closeMin: CLOSE,
      durationMin: 30,
      blocked: NO_BLOCKS,
      nowMin: 570,
    })
    expect(slots[0]).toBe('10:00')
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
      packSlots({ openMin: 600, closeMin: 600, durationMin: 30, blocked: NO_BLOCKS, nowMin: FUTURE }),
    ).toEqual([])
    expect(
      packSlots({ openMin: 700, closeMin: 600, durationMin: 30, blocked: NO_BLOCKS, nowMin: FUTURE }),
    ).toEqual([])
  })

  it('durationMin <= 0 → []', () => {
    expect(
      packSlots({ openMin: OPEN, closeMin: CLOSE, durationMin: 0, blocked: NO_BLOCKS, nowMin: FUTURE }),
    ).toEqual([])
    expect(
      packSlots({ openMin: OPEN, closeMin: CLOSE, durationMin: -30, blocked: NO_BLOCKS, nowMin: FUTURE }),
    ).toEqual([])
  })
})

describe('packSlots — robustness', () => {
  it('tolerates overlapping / unsorted blocked intervals with no pre-merge', () => {
    // Overlapping blocks [10:00,11:00) and [10:30,12:00), passed OUT OF ORDER.
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
    expect(slots.slice(0, 2)).toEqual(['09:00', '09:30']) // leading gap [540, 600)
    expect(slots).toContain('12:00') // packs from the merged block end (720)
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
