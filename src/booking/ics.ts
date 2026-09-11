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

/** Format a local `Date` as a floating `YYYYMMDDTHHMMSS` timestamp for Google Calendar. */
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
  /** Absolute event start instant. */
  readonly start: Date
  /** Absolute event end instant. */
  readonly end: Date
  readonly summary: string
  readonly location: string
  readonly description: string
}

const PRODID = '-//Blade & Blend Studio//Booking//EN'

/** Fold escaped content at 75 UTF-8 octets, counting the continuation space and keeping code points. */
function foldContentLine(line: string): string {
  const encoder = new TextEncoder()
  let folded = ''
  let bytes = 0
  for (const character of line) {
    const size = encoder.encode(character).byteLength
    if (bytes + size > 75) {
      folded += '\r\n '
      bytes = 1
    }
    folded += character
    bytes += size
  }
  return folded
}

/** Build a complete RFC5545 VCALENDAR: escaped TEXT, folded UTF-8 lines and final CRLF. */
export function buildIcs(event: IcsEvent): string {
  const lines: readonly string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatIcsUtc(event.dtstamp)}`,
    `DTSTART:${formatIcsUtc(event.start)}`,
    `DTEND:${formatIcsUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldContentLine).join('\r\n') + '\r\n'
}
