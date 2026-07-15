// Pure, RFC5545-correct ICS builder WITH proper text escaping (the original mock concatenated
// unescaped commas into LOCATION); this builder escapes per spec so it stays injection-safe
// when real user data flows through. No effects: UID + DTSTAMP are injected by the caller
// (the adapter at the edge), keeping this module referentially transparent.

/** Escape a value for an RFC5545 TEXT field: backslash, semicolon, comma, then newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** Format a local `Date` as a floating `YYYYMMDDTHHMMSS` timestamp. */
export function formatIcsLocal(dt: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    String(dt.getFullYear()) +
    p(dt.getMonth() + 1) +
    p(dt.getDate()) +
    'T' +
    p(dt.getHours()) +
    p(dt.getMinutes()) +
    '00'
  )
}

/** Format a `Date` as a UTC `YYYYMMDDTHHMMSSZ` stamp (used for DTSTAMP). */
export function formatIcsUtc(dt: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    String(dt.getUTCFullYear()) +
    p(dt.getUTCMonth() + 1) +
    p(dt.getUTCDate()) +
    'T' +
    p(dt.getUTCHours()) +
    p(dt.getUTCMinutes()) +
    p(dt.getUTCSeconds()) +
    'Z'
  )
}

/** Inputs for a single VEVENT. All text fields are escaped by the builder. */
export interface IcsEvent {
  /** Globally-unique id (injected at the edge, e.g. `${ts}@bladeblendstudio`). */
  readonly uid: string
  /** Creation stamp in UTC (injected at the edge). */
  readonly dtstamp: Date
  /** Local event start. */
  readonly start: Date
  /** Local event end. */
  readonly end: Date
  readonly summary: string
  readonly location: string
  readonly description: string
}

const PRODID = '-//Blade & Blend Studio//Booking//EN'

/**
 * Build a complete VCALENDAR string with CRLF line endings (RFC5545). Long-line folding is
 * intentionally omitted (values here are short); escaping is applied to every TEXT field.
 */
export function buildIcs(event: IcsEvent): string {
  const lines: readonly string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatIcsUtc(event.dtstamp)}`,
    `DTSTART:${formatIcsLocal(event.start)}`,
    `DTEND:${formatIcsLocal(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}
