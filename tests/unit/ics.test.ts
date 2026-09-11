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
    start: new Date('2026-06-20T08:30:00.000Z'),
    end: new Date('2026-06-20T09:30:00.000Z'),
    summary: 'KNC Studio – Klippning (Hassan)',
    location: 'KNC Studio, Geijersgatan 10, 411 34 Göteborg',
    description: 'Bokning hos Hassan · 350 kr',
  }
  const ics = buildIcs(event)

  it('uses CRLF line endings inside a VCALENDAR/VEVENT envelope', () => {
    expect(ics).toContain('\r\n')
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
  it('escapes commas in LOCATION (the original prototype did not — the bug this fixes)', () => {
    expect(ics).toContain('LOCATION:KNC Studio\\, Geijersgatan 10\\, 411 34 Göteborg')
  })
  it('formats DTSTAMP, DTSTART, and DTEND as UTC (Z) timestamps', () => {
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/)
    expect(ics).toContain('DTSTART:20260620T083000Z')
    expect(ics).toContain('DTEND:20260620T093000Z')
  })
  it('neutralizes CRLF property-injection in a text field', () => {
    const evil = buildIcs({ ...event, summary: 'ok\r\nX-EVIL:1' })
    // No real newline introduces an injected property line:
    expect(evil).not.toMatch(/[\r\n]X-EVIL:/)
    // The CRLF is folded into the escaped value instead:
    expect(evil).toContain('SUMMARY:ok\\nX-EVIL:1')
  })

  it.each([74, 75, 76, 149, 150, 151])(
    'folds a %i-octet logical line at the RFC boundary',
    (bytes) => {
      const summary = 'x'.repeat(bytes - 'SUMMARY:'.length)
      const result = buildIcs({ ...event, summary })
      const physical = result.split('\r\n')
      for (const line of physical)
        expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75)
      expect(result.replace(/\r\n[ \t]/g, '')).toContain(`SUMMARY:${summary}\r\n`)
      const start = physical.findIndex((line) => line.startsWith('SUMMARY:'))
      expect(physical[start]).toHaveLength(Math.min(bytes, 75))
      expect(physical[start + 1]?.startsWith(' ')).toBe(bytes > 75)
    },
  )

  it('folds every escaped TEXT property by UTF-8 octets without splitting code points or injecting fields', () => {
    const text = `${'Åäö💈'.repeat(30)},;\\\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Injected`
    const result = buildIcs({
      ...event,
      uid: text,
      summary: text,
      location: text,
      description: text,
    })
    const encoded = new TextEncoder().encode(result)
    const roundTrip = new TextDecoder('utf-8', { fatal: true }).decode(encoded)
    const unfolded = roundTrip.replace(/\r\n[ \t]/g, '')
    for (const line of result.split('\r\n')) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75)
      expect(line).not.toContain('\uFFFD')
    }
    for (const property of ['UID', 'SUMMARY', 'LOCATION', 'DESCRIPTION']) {
      expect(unfolded).toContain(`${property}:${escapeIcsText(text)}\r\n`)
    }
    expect(unfolded.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1)
    expect(unfolded.match(/^END:VEVENT$/gm)).toHaveLength(1)
    expect(unfolded).not.toMatch(/^SUMMARY:Injected/m)
  })
})
