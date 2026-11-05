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
  it('moves both complete assets together while their crossfade overlaps', () => {
    const height = 844
    const limit = height - 112
    expect(mobileBrandMotion(0, height)).toEqual({
      actions: 1, brand: 1, banner: 0, travel: 0,
    })
    expect(mobileBrandMotion(limit * 0.3, height).actions).toBeGreaterThan(0)
    expect(mobileBrandMotion(limit * 0.55, height).actions).toBe(0)
    const halfway = mobileBrandMotion(limit * 0.5, height)
    expect(halfway.travel).toBe(0.5)
    expect(halfway.brand).toBeGreaterThan(0)
    expect(halfway.banner).toBeGreaterThan(0)
    expect(halfway.brand + halfway.banner).toBe(1)
    expect(mobileBrandMotion(limit, height)).toEqual({
      actions: 0, brand: 0, banner: 1, travel: 1,
    })
    expect(mobileBrandMotion(limit * 0.5, height)).toEqual(halfway)
  })

  it('uses the same overlapping fade without decorative travel for reduced motion', () => {
    const ordinary = mobileBrandMotion(400, 844)
    const reduced = mobileBrandMotion(400, 844, true)
    expect(reduced).toEqual({ ...ordinary, travel: 0 })
    expect(reduced.brand).toBeGreaterThan(0)
    expect(reduced.banner).toBeGreaterThan(0)
  })
})
