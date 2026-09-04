import { describe, it, expect } from 'vitest'
import { parseServiceRow, validateManualReservationPrice } from '../../src/admin/serviceValidation'

describe('parseServiceRow', () => {
  it('accepts a valid row and trims the name', () => {
    const r = parseServiceRow({ name: '  Skinfade  ', price: '350', durationMin: '45' })
    expect(r).toEqual({ name: 'Skinfade', price: 350, durationMin: 45 })
  })

  it('accepts a free (0 kr) service', () => {
    expect(parseServiceRow({ name: 'Konsultation', price: '0', durationMin: '15' })).not.toBeNull()
  })

  it('accepts a decimal price and rounds a numeric duration upward', () => {
    expect(parseServiceRow({ name: 'Skinfade', price: '199.99', durationMin: '44.1' })).toEqual({
      name: 'Skinfade',
      price: 199.99,
      durationMin: 45,
    })
  })

  it('rounds duration before applying the whole-minute bounds', () => {
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '4.1' })).toMatchObject({
      durationMin: 5,
    })
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '600' })).toMatchObject({
      durationMin: 600,
    })
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '600.1' })).toBeNull()
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

  it('rejects trailing junk and values outside the decimal contract', () => {
    expect(parseServiceRow({ name: 'X', price: '199abc', durationMin: '45' })).toBeNull()
    expect(parseServiceRow({ name: 'X', price: '199.999', durationMin: '45' })).toBeNull()
    expect(parseServiceRow({ name: 'X', price: '100000.01', durationMin: '45' })).toBeNull()
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '45minutes' })).toBeNull()
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '600.1' })).toBeNull()
  })

  it('rejects a duration outside 5..600', () => {
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '2' })).toBeNull()
    expect(parseServiceRow({ name: 'X', price: '100', durationMin: '999' })).toBeNull()
  })

  it('rejects an empty numeric field', () => {
    expect(parseServiceRow({ name: 'X', price: '', durationMin: '45' })).toBeNull()
  })
})

describe('validateManualReservationPrice', () => {
  it('treats empty input as the intentional default price', () => {
    expect(validateManualReservationPrice('')).toEqual({ ok: true, value: null })
    expect(validateManualReservationPrice('   ')).toEqual({ ok: true, value: null })
  })

  it('preserves zero and valid dot-decimal prices', () => {
    expect(validateManualReservationPrice('0')).toEqual({ ok: true, value: 0 })
    expect(validateManualReservationPrice('199.99')).toEqual({ ok: true, value: 199.99 })
  })

  it('rejects non-empty trailing text, comma decimals, and too many decimals', () => {
    expect(validateManualReservationPrice('199abc')).toEqual({ ok: false })
    expect(validateManualReservationPrice('199,99')).toEqual({ ok: false })
    expect(validateManualReservationPrice('199.999')).toEqual({ ok: false })
  })
})
