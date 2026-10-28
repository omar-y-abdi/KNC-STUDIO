import { describe, it, expect } from 'vitest'
import {
  parsePhone,
  parseName,
  parseEmail,
  parseContact,
  normalizePhone,
} from '../../src/booking/validation'

describe('parsePhone (Swedish mobile)', () => {
  it('accepts valid mobile forms (incl. +46 / spacing / dashes)', () => {
    for (const p of [
      '0701234567',
      '+46701234567',
      '0046701234567',
      '070 123 45 67',
      '070-123 45 67',
    ]) {
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

describe('parseEmail', () => {
  it('normalizes valid email and rejects malformed values', () => {
    const valid = parseEmail(' Omar@Example.COM ')
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.value).toBe('omar@example.com')
    expect(parseEmail('not-an-email').ok).toBe(false)
  })
})

describe('parseContact (name + phone + email)', () => {
  const valid = { name: 'Omar', phone: '0701234567', email: 'omar@example.com' }

  it('accepts valid name, phone, and email', () => {
    expect(parseContact(valid).ok).toBe(true)
  })
  it('flags a missing name and an invalid phone independently', () => {
    const r = parseContact({ name: '', phone: 'abc', email: 'bad' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: true, phone: true, email: true })
  })
  it('flags only the phone when the name is valid', () => {
    const r = parseContact({ name: 'Omar', phone: 'abc', email: 'omar@example.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.fields).toEqual({ name: false, phone: true, email: false })
  })
  it('returns the branded contact on success', () => {
    const r = parseContact(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('Omar')
      expect(r.value.phone).toBe('0701234567')
      expect(r.value.email).toBe('omar@example.com')
    }
  })
})

// Boundary cases, recorded on the zod implementation and kept green by the plain rewrite.
describe('parsePhone country-prefix boundaries', () => {
  it.each([
    ['+46701234567', '0701234567'],
    ['0046701234567', '0701234567'],
    ['+46-70-123 45 67', '0701234567'],
    ['0046 70 123 45 67', '0701234567'],
    ['070 123 45 67', '0701234567'],
  ])('accepts %s as %s', (raw, national) => {
    const result = parsePhone(raw)
    expect(result.ok, raw).toBe(true)
    if (result.ok) expect(result.value).toBe(national)
  })

  it.each([
    '+4670123456',
    '+467012345678',
    '+460701234567',
    '+46 0701234567',
    '46701234567',
    '+046701234567',
    '00046701234567',
    '+47701234567',
    '0046',
    '+46',
  ])('rejects %s with the phone message', (raw) => {
    expect(parsePhone(raw)).toEqual({ ok: false, error: 'Invalid Swedish mobile number' })
  })
})

describe('parseName length boundaries (UTF-16 code units, after trimming)', () => {
  it('accepts 80 and rejects 81 code units, whatever surrounds them', () => {
    expect(parseName('x'.repeat(80))).toEqual({ ok: true, value: 'x'.repeat(80) })
    expect(parseName(` \t${'x'.repeat(80)}\n `)).toEqual({ ok: true, value: 'x'.repeat(80) })
    expect(parseName('x'.repeat(81))).toEqual({ ok: false, error: 'Name is too long' })
    expect(parseName(`  ${'x'.repeat(81)}  `)).toEqual({ ok: false, error: 'Name is too long' })
  })
  it('counts an emoji as two code units', () => {
    expect(parseName('😀'.repeat(40)).ok).toBe(true)
    expect(parseName('😀'.repeat(41))).toEqual({ ok: false, error: 'Name is too long' })
  })
  it('rejects empty and whitespace-only names with the required message', () => {
    for (const raw of ['', ' ', '\t\n', '  '])
      expect(parseName(raw), JSON.stringify(raw)).toEqual({ ok: false, error: 'Name is required' })
  })
})

describe('parseEmail length boundaries (254 accepted, 255 rejected)', () => {
  const domain = '@example.com'
  const emailOfLength = (total: number): string => 'a'.repeat(total - domain.length) + domain

  it('accepts a 254-character address and rejects a 255-character one', () => {
    expect(emailOfLength(254)).toHaveLength(254)
    expect(parseEmail(emailOfLength(254))).toEqual({ ok: true, value: emailOfLength(254) })
    expect(parseEmail(emailOfLength(255))).toEqual({ ok: false, error: 'Email is too long' })
  })
  it('measures the length after trimming and lower-casing', () => {
    const padded = `  ${emailOfLength(254).toUpperCase()}\t`
    expect(parseEmail(padded)).toEqual({ ok: true, value: emailOfLength(254) })
    expect(parseEmail(` ${emailOfLength(255)} `)).toEqual({ ok: false, error: 'Email is too long' })
  })
  it('reports the format message before the length message', () => {
    expect(parseEmail('a'.repeat(300))).toEqual({ ok: false, error: 'Invalid email address' })
    expect(parseEmail('')).toEqual({ ok: false, error: 'Invalid email address' })
  })
})

describe('parseEmail format boundaries', () => {
  it.each([
    'a@b.co',
    'first.last+tag@sub.example.se',
    "o'brien@example.org",
    '_x-y+z@a-b.example.com',
    'a@b-.co',
    'Omar@EXAMPLE.Com',
  ])('accepts %s', (raw) => {
    expect(parseEmail(raw).ok, raw).toBe(true)
  })

  it.each([
    '.a@example.com',
    'a.@example.com',
    "a'@example.com",
    'a..b@example.com',
    'a@example..com',
    'a@.example.com',
    'a@example.com.',
    'a@-example.com',
    'a@example.c',
    'a@example.c0m',
    'a@exa_mple.com',
    '@example.com',
    'a@@example.com',
    'a@b@example.com',
    'a b@example.com',
    'ö@example.com',
    'a@exämple.com',
    'a@example',
    'plain',
  ])('rejects %s with the format message', (raw) => {
    expect(parseEmail(raw)).toEqual({ ok: false, error: 'Invalid email address' })
  })
})
