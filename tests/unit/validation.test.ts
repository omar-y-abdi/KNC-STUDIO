import { describe, it, expect } from 'vitest'
import {
  parsePhone,
  parseName,
  parseContact,
  normalizePhone,
} from '../../src/booking/validation'

describe('parsePhone (Swedish mobile)', () => {
  it('accepts valid mobile forms (incl. +46 / spacing / dashes)', () => {
    for (const p of ['0701234567', '+46701234567', '0046701234567', '070 123 45 67', '070-123 45 67']) {
      expect(parsePhone(p).ok, p).toBe(true)
    }
  })
  it('rejects landlines, malformed, wrong length, empty', () => {
    for (const p of ['abc', '08123456', '070123456', '07012345678', '']) {
      expect(parsePhone(p).ok, p).toBe(false)
    }
  })
})

describe('normalizePhone', () => {
  it('strips separators and normalizes the country prefix to a leading 0', () => {
    expect(normalizePhone('+46 70-123 45 67')).toBe('0701234567')
    expect(normalizePhone('0046701234567')).toBe('0701234567')
    expect(normalizePhone('(070) 123 45 67')).toBe('0701234567')
  })
})

describe('parseName', () => {
  it('non-empty, trimmed, max 80 chars', () => {
    expect(parseName('Omar').ok).toBe(true)
    expect(parseName('  Omar  ').ok).toBe(true)
    expect(parseName('').ok).toBe(false)
    expect(parseName('x'.repeat(81)).ok).toBe(false)
    expect(parseName('x'.repeat(80)).ok).toBe(true)
  })
})

describe('parseContact (name + phone, SMS-only)', () => {
  const valid = { name: 'Omar', phone: '0701234567' }

  it('accepts a valid name + phone', () => {
    expect(parseContact(valid).ok).toBe(true)
  })
  it('flags a missing name and an invalid phone independently', () => {
    const r = parseContact({ name: '', phone: 'abc' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: true, phone: true })
  })
  it('flags only the phone when the name is valid', () => {
    const r = parseContact({ name: 'Omar', phone: 'abc' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: false, phone: true })
  })
  it('returns the branded contact on success', () => {
    const r = parseContact(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('Omar')
      expect(r.value.phone).toBe('0701234567')
    }
  })
})
