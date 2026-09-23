import { describe, expect, it } from 'vitest'
import { mobileFold } from '../../src/app/mobileFold'

describe('shared mobile hero motion', () => {
  it('keeps panel plus spacer at one viewport and clamps to the compact header', () => {
    for (const height of [667, 844, 932]) {
      expect(mobileFold(-10, height)).toEqual({ collapse: 0, compact: false, opacity: 1 })
      expect(mobileFold(100, height).collapse).toBe(100)
      const final = mobileFold(5000, height)
      expect(height - final.collapse).toBe(112)
      expect(final.compact).toBe(true)
      expect(final.opacity).toBe(0)
    }
  })
  it('keeps privacy controls usable until the full hero has scrolled past', () => {
    expect(mobileFold(300, 844, true)).toEqual({ collapse: 0, compact: false, opacity: 1 })
    expect(mobileFold(732, 844, true)).toEqual({ collapse: 732, compact: true, opacity: 0 })
    expect(mobileFold(0, 100)).toEqual({ collapse: 0, compact: false, opacity: 1 })
  })
})
