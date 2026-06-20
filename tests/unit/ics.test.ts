import { describe, it, expect } from 'vitest'
import { escapeIcsText, buildIcs } from '../../src/booking/ics'

describe('escapeIcsText (RFC 5545)', () => {
  it('escapes backslash, comma, semicolon and newlines', () => {
    expect(escapeIcsText('a,b')).toBe('a\\,b')
    expect(escapeIcsText('a;b')).toBe('a\\;b')
    expect(escapeIcsText('a\\b')).toBe('a\\\\b')
    expect(escapeIcsText('a\r\nb')).toBe('a\\nb')
    expect(escapeIcsText('a\nb')).toBe('a\\nb')
  })
})

describe('buildIcs', () => {
  const event = {
    uid: '1@kncstudio',
    dtstamp: new Date(Date.UTC(2026, 5, 19, 8, 0, 0)),
    start: new Date(2026, 5, 20, 10, 30),
    end: new Date(2026, 5, 20, 11, 30),
    summary: 'KNC Studio – Klippning (Hassan)',
    location: 'KNC Studio, Geijersgatan 10, 411 34 Göteborg',
    description: 'Bokning hos Hassan · 350 kr',
  }
  const ics = buildIcs(event)

  it('uses CRLF line endings inside a VCALENDAR/VEVENT envelope', () => {
    expect(ics).toContain('\r\n')
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
  })
  it('escapes commas in LOCATION (the original mock did not — the bug this fixes)', () => {
    expect(ics).toContain('LOCATION:KNC Studio\\, Geijersgatan 10\\, 411 34 Göteborg')
  })
  it('formats DTSTAMP as UTC (Z) and DTSTART as local floating time', () => {
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/)
    expect(ics).toContain('DTSTART:20260620T103000')
    expect(ics).toContain('DTEND:20260620T113000')
  })
  it('neutralizes CRLF property-injection in a text field', () => {
    const evil = buildIcs({ ...event, summary: 'ok\r\nX-EVIL:1' })
    // No real newline introduces an injected property line:
    expect(evil).not.toMatch(/[\r\n]X-EVIL:/)
    // The CRLF is folded into the escaped value instead:
    expect(evil).toContain('SUMMARY:ok\\nX-EVIL:1')
  })
})
