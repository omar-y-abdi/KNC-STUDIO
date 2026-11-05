// Pure validation for a service-menu row buffer, mirroring the DB check constraints exactly
// (name 1..80 chars, price 0..100000 SEK with at most two decimals, duration 5..600 minutes).
// Numeric duration input is rounded upward before it is returned. No effects — unit-testable
// without the DOM, and the single source of the client-side rules.

export interface ParsedService {
  readonly name: string
  readonly price: number
  readonly durationMin: number
}

function parseUnsignedDecimal(input: string, maxFractionDigits: number): number | null {
  const value = input.trim()
  const parts = value.split('.')
  const whole = parts[0]
  const fraction = parts[1]
  if (
    whole === undefined ||
    whole.length === 0 ||
    !/^[0-9]+$/.test(whole) ||
    parts.length > 2 ||
    (fraction !== undefined &&
      (fraction.length === 0 || fraction.length > maxFractionDigits || !/^[0-9]+$/.test(fraction)))
  ) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Parse a complete, dot-decimal SEK value without allowing implicit coercion or rounding. */
function parseServicePrice(input: string): number | null {
  const price = parseUnsignedDecimal(input, 2)
  if (price === null || price < 0 || price > 100000) return null
  return price
}

export type ManualReservationPrice =
  { readonly ok: true; readonly value: number | null } | { readonly ok: false }

/** Validate the optional manual-reservation price without conflating blank input with invalid input. */
export function validateManualReservationPrice(input: string): ManualReservationPrice {
  if (input.trim() === '') return { ok: true, value: null }
  const price = parseServicePrice(input)
  return price === null ? { ok: false } : { ok: true, value: price }
}

/** Parse a complete numeric duration and round it upward to the next whole minute. */
function parseServiceDuration(input: string): number | null {
  const numericDuration = parseUnsignedDecimal(input, Number.POSITIVE_INFINITY)
  if (numericDuration === null) return null
  const duration = Math.ceil(numericDuration)
  return duration >= 5 && duration <= 600 ? duration : null
}

export function parseServiceRow(input: {
  name: string
  price: string
  durationMin: string
}): ParsedService | null {
  const name = input.name.trim()
  const price = parseServicePrice(input.price)
  const durationMin = parseServiceDuration(input.durationMin)
  if (name === '' || name.length > 80) return null
  if (price === null || durationMin === null) return null
  return { name, price, durationMin }
}
