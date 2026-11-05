import { describe, expect, it } from 'vitest'
import { mobileBrandMotion, mobileFold } from '../../modules/public-web/src/app/mobileFold'

describe('shared mobile hero motion', () => {
  it('keeps panel plus spacer at one viewport and clamps to the compact header', () => {
    for (const height of [667, 844, 932]) {
      expect(mobileFold(-10, height)).toEqual({
        collapse: 0,
        compact: false,
        pinned: false,
        opacity: 1,
      })
      expect(mobileFold(100, height).collapse).toBe(100)
      const final = mobileFold(5000, height)
      expect(height - final.collapse).toBe(112)
      expect(final.compact).toBe(true)
      expect(final.pinned).toBe(true)
      expect(mobileFold(100, height).pinned).toBe(false)
      expect(final.opacity).toBe(0)
    }
  })
  it('keeps privacy controls usable until the full hero has scrolled past', () => {
    expect(mobileFold(300, 844, true)).toEqual({
      collapse: 0,
      compact: false,
      pinned: false,
      opacity: 1,
    })
    expect(mobileFold(732, 844, true)).toEqual({
      collapse: 732,
      compact: true,
      pinned: true,
      opacity: 0,
    })
    expect(mobileFold(0, 100)).toEqual({ collapse: 0, compact: false, pinned: true, opacity: 1 })
  })
})

describe('reversible mobile branding', () => {
  const height = 844
  const limit = height - 112

  it('fades supporting details progressively while the brand travels', () => {
    expect(mobileBrandMotion(0, height).actions).toBe(1)
    const early = mobileBrandMotion(limit * 0.2, height)
    const middle = mobileBrandMotion(limit * 0.4, height)
    expect(early.actions).toBeGreaterThan(middle.actions)
    expect(middle.actions).toBeGreaterThan(0)
    expect(mobileBrandMotion(limit * 0.65, height).actions).toBe(0)
  })

  it('settles the banner before the phone and BNB rules appear together', () => {
    expect(mobileBrandMotion(0, height).phone).toBe(1)
    expect(mobileBrandMotion(0, height).rules).toBe(0)
    const settled = mobileBrandMotion(limit * 0.86, height)
    expect(settled.travel).toBe(1)
    expect(settled.phone).toBe(0)
    expect(settled.rules).toBe(0)
    for (const progress of [0.9, 0.93, 0.97, 1]) {
      const motion = mobileBrandMotion(limit * progress, height)
      expect(motion.phone).toBe(motion.rules)
    }
    expect(mobileBrandMotion(limit, height).phone).toBe(1)
  })

  it('reverses the same poses and uses fading without travel for reduced motion', () => {
    const positions = [0, 120, 340, 650, limit]
    const forward = positions.map((position) => mobileBrandMotion(position, height))
    expect([...positions].reverse().map((position) => mobileBrandMotion(position, height))).toEqual([...forward].reverse())
    expect(mobileBrandMotion(400, height, true)).toEqual({ ...mobileBrandMotion(400, height), travel: 0, form: 0 })
  })
})
