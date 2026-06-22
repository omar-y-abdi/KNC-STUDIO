import { describe, it, expect } from 'vitest'
import { parseReview } from '../../src/about/reviewValidation'

describe('parseReview', () => {
  const valid = { name: 'Omar', rating: 5 as const, text: 'Great fade, calm room.' }

  it('accepts a complete, in-bounds review and returns the branded value', () => {
    const r = parseReview(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('Omar')
      expect(r.value.rating).toBe(5)
      expect(r.value.text).toBe('Great fade, calm room.')
    }
  })

  it('trims name and text', () => {
    const r = parseReview({ name: '  Omar  ', rating: 3, text: '  nice  ' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('Omar')
      expect(r.value.text).toBe('nice')
    }
  })

  it('flags a missing rating', () => {
    const r = parseReview({ name: 'Omar', rating: null, text: 'good' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: false, rating: true, text: false })
  })

  it('flags empty text', () => {
    const r = parseReview({ name: 'Omar', rating: 4, text: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields.text).toBe(true)
  })

  it('flags an over-long name and over-long text independently', () => {
    const r = parseReview({ name: 'x'.repeat(81), rating: 4, text: 'y'.repeat(601) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: true, rating: false, text: true })
  })

  it('reports all failing fields at once', () => {
    const r = parseReview({ name: '', rating: null, text: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: true, rating: true, text: true })
  })
})
