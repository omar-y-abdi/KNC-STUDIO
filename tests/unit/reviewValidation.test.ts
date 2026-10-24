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

  // Boundary cases, recorded on the zod implementation and kept green by the plain rewrite.
  it('accepts a 600-character review and rejects a 601-character one', () => {
    const at = parseReview({ ...valid, text: 'y'.repeat(600) })
    expect(at.ok).toBe(true)
    if (at.ok) expect(at.value.text).toBe('y'.repeat(600))

    const over = parseReview({ ...valid, text: 'y'.repeat(601) })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.fields).toEqual({ phone: false, rating: false, text: true })
  })

  it('measures the length after trimming', () => {
    const padded = parseReview({ ...valid, text: ` \n${'y'.repeat(600)}\t ` })
    expect(padded.ok).toBe(true)
    if (padded.ok) expect(padded.value.text).toBe('y'.repeat(600))
    expect(parseReview({ ...valid, text: ` ${'y'.repeat(601)} ` }).ok).toBe(false)
  })

  it('counts an emoji as two code units', () => {
    expect(parseReview({ ...valid, text: '😀'.repeat(300) }).ok).toBe(true)
    expect(parseReview({ ...valid, text: '😀'.repeat(301) }).ok).toBe(false)
  })

  it('rejects whitespace-only text, including non-breaking spaces', () => {
    for (const text of ['', ' ', '\t\n', '  '])
      expect(parseReview({ ...valid, text }).ok, JSON.stringify(text)).toBe(false)
  })
})
