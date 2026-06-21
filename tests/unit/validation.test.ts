import { describe, it, expect } from 'vitest'
import {
  parsePhone,
  parseEmail,
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

describe('parseEmail', () => {
  it('valid / trims / invalid / empty', () => {
    expect(parseEmail('a@b.se').ok).toBe(true)
    expect(parseEmail('  a@b.se  ').ok).toBe(true)
    expect(parseEmail('bad').ok).toBe(false)
    expect(parseEmail('').ok).toBe(false)
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

describe('parseContact (method-aware)', () => {
  const valid = { name: 'Omar', phone: '0701234567', email: 'a@b.se' }

  it('SMS booking does not require an email', () => {
    expect(parseContact({ ...valid, email: '' }, 'sms').ok).toBe(true)
  })
  it('email method requires a valid email', () => {
    const r = parseContact({ ...valid, email: '' }, 'email')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields.email).toBe(true)
  })
  it('flags only the fields collected for the chosen method', () => {
    // email method: name + email validated; phone is not collected
    const r = parseContact({ name: '', phone: 'abc', email: 'bad' }, 'email')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: true, phone: false, email: true })
    // sms method: name + phone validated; email is not collected
    const r2 = parseContact({ name: '', phone: 'abc', email: 'bad' }, 'sms')
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.fields).toEqual({ name: true, phone: true, email: false })
  })
  it('returns the branded contact for the chosen channel', () => {
    const sms = parseContact(valid, 'sms')
    expect(sms.ok).toBe(true)
    if (sms.ok) {
      expect(sms.value.name).toBe('Omar')
      expect(sms.value.phone).toBe('0701234567')
    }
    const email = parseContact(valid, 'email')
    expect(email.ok).toBe(true)
    if (email.ok) {
      expect(email.value.name).toBe('Omar')
      expect(email.value.email).toBe('a@b.se')
    }
  })
})
