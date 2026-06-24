import { describe, it, expect } from 'vitest'
import { parseReview } from '../../src/about/reviewValidation'

describe('parseReview', () => {
  const valid = { phone: '0701234567', rating: 5 as const, text: 'Great fade, calm room.' }

  it('accepts a complete, in-bounds review and returns the branded value', () => {
    const r = parseReview(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.phone).toBe('0701234567')
      expect(r.value.rating).toBe(5)
      expect(r.value.text).toBe('Great fade, calm room.')
    }
  })

  it('normalizes the phone and trims text', () => {
    const r = parseReview({ phone: '070 123 45 67', rating: 3, text: '  nice  ' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.phone).toBe('0701234567')
      expect(r.value.text).toBe('nice')
    }
  })

  it('flags a missing rating', () => {
    const r = parseReview({ phone: '0701234567', rating: null, text: 'good' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ phone: false, rating: true, text: false })
  })

  it('flags empty text', () => {
    const r = parseReview({ phone: '0701234567', rating: 4, text: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields.text).toBe(true)
  })

  it('flags an invalid phone and over-long text independently', () => {
    const r = parseReview({ phone: 'not-a-phone', rating: 4, text: 'y'.repeat(601) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ phone: true, rating: false, text: true })
  })

  it('reports all failing fields at once', () => {
    const r = parseReview({ phone: '', rating: null, text: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ phone: true, rating: true, text: true })
  })
})
