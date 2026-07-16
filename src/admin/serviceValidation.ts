// Pure validation for a service-menu row buffer, mirroring the DB check constraints exactly
// (name 1..80 chars, price 0..100000 int, duration 5..600 min int). Returns the parsed values or
// null. No effects — unit-testable without the DOM, and the single source of the client-side rules.

export interface ParsedService {
  readonly name: string
  readonly price: number
  readonly durationMin: number
}

export function parseServiceRow(input: {
  name: string
  price: string
  durationMin: string
}): ParsedService | null {
  const name = input.name.trim()
  const price = Number.parseInt(input.price, 10)
  const durationMin = Number.parseInt(input.durationMin, 10)
  if (name === '' || name.length > 80) return null
  if (!Number.isInteger(price) || price < 0 || price > 100000) return null
  if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > 600) return null
  return { name, price, durationMin }
}
