import { describe, it, expect } from 'vitest'
import { SLOTS, slotTaken, durFactor } from '../../src/booking/slots'

describe('durFactor', () => {
  it('maps duration to a busyness factor', () => {
    expect(durFactor(60)).toBe(6)
    expect(durFactor(45)).toBe(4)
    expect(durFactor(30)).toBe(3)
  })
})

describe('SLOTS', () => {
  it('is the fixed 12-slot grid', () => {
    expect(SLOTS).toHaveLength(12)
    expect(SLOTS[0]).toBe('09:00')
    expect(SLOTS[SLOTS.length - 1]).toBe('17:15')
  })
})

describe('slotTaken (deterministic, pure)', () => {
  it('matches the exact reference formula across a wide grid', () => {
    const reference = (day: number, bi: number, i: number, dur: number): boolean =>
      (day * 31 + bi * 7 + i * 13 + dur) % 10 < durFactor(dur)
    for (const day of [1, 15, 20, 28, 31]) {
      for (const bi of [0, 1, 2]) {
        for (let i = 0; i < SLOTS.length; i++) {
          for (const dur of [30, 45, 60]) {
            expect(slotTaken(day, bi, i, dur)).toBe(reference(day, bi, i, dur))
          }
        }
      }
    }
  })
  it('Hassan (idx 0), Sat-20, 60-min service: 10:30 (slot idx 2) is free', () => {
    expect(slotTaken(20, 0, 2, 60)).toBe(false)
  })
})
