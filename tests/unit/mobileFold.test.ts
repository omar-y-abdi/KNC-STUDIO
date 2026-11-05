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
  it('keeps the compact banner absent until the large logo has reached its anchor', () => {
    const height = 844
    const limit = height - 112
    expect(mobileBrandMotion(0, height)).toEqual({
      actions: 1, brand: 1, banner: 0, shrink: 0, lift: 0, slide: 0,
    })
    expect(mobileBrandMotion(limit * 0.3, height).actions).toBe(0)
    const arrival = mobileBrandMotion(limit * 0.86, height)
    expect(arrival).toEqual({ actions: 0, brand: 1, banner: 0, shrink: 1, lift: 1, slide: 1 })
    const halfway = mobileBrandMotion(limit * 0.93, height)
    expect(halfway.brand + halfway.banner).toBe(1)
    expect(halfway.banner).toBeCloseTo(0.5)
    expect(mobileBrandMotion(limit, height)).toEqual({
      actions: 0, brand: 0, banner: 1, shrink: 1, lift: 1, slide: 1,
    })
    expect(mobileBrandMotion(limit * 0.86, height)).toEqual(arrival)
  })

  it('uses fading without decorative travel or scaling for reduced motion', () => {
    const motion = mobileBrandMotion(400, 844, true)
    expect(motion.brand).toBe(0)
    expect(motion.shrink).toBe(0)
    expect(motion.lift).toBe(0)
    expect(motion.slide).toBe(0)
  })
})
