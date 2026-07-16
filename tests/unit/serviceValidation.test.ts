import { describe, it, expect } from 'vitest'
import { parseServiceRow } from '../../src/admin/serviceValidation'

describe('parseServiceRow', () => {
  it('accepts a valid row and trims the name', () => {
    const r = parseServiceRow({ name: '  Skinfade  ', price: '350', durationMin: '45' })
    expect(r).toEqual({ name: 'Skinfade', price: 350, durationMin: 45 })
  })

  it('accepts a free (0 kr) service', () => {
    expect(parseServiceRow({ name: 'Konsultation', price: '0', durationMin: '15' })).not.toBeNull()
  })

  it('rejects an empty / whitespace-only name', () => {
    expect(parseServiceRow({ name: '   ', price: '350', durationMin: '45' })).toBeNull()
  })

  it('rejects a name over 80 chars', () => {
    expect(parseServiceRow({ name: 'x'.repeat(81), price: '350', durationMin: '45' })).toBeNull()
  })

  it('rejects a non-numeric or negative price', () => {
    expect(parseServiceRow({ name: 'X', price: 'abc', durationMin: '45' })).toBeNull()
    expect(parseServiceRow({ name: 'X', price: '-5', durationMin: '45' })).toBeNull()
  })

  it('rejects a duration outside 5..600', () => {
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '2' })).toBeNull()
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '999' })).toBeNull()
  })

  it('rejects an empty numeric field', () => {
    expect(parseServiceRow({ name: 'X', price: '', durationMin: '45' })).toBeNull()
  })
})
