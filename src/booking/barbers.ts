// The barber roster — copied verbatim from the source `BF_BARBERS` (index.html lines 112-116).
// This is the OFFLINE FALLBACK + the DB seed: with no backend it IS the public roster, byte-for-byte
// as before. Each id is narrowed to a `BarberId` at this boundary (the type is now an open branded
// string — ADMIN_SPEC §5 — so a DB-added barber id is equally valid).

import type { Barber, BarberId } from './domain'
import { asBarberId } from './domain'

/** Safe default when a roster lookup misses (`BARBERS` is a non-empty constant). */
export const FALLBACK_BARBER: Barber = { id: asBarberId('hassan'), name: 'Hassan', ig: 'freebandzcuts' }

export const BARBERS: readonly Barber[] = [
  FALLBACK_BARBER,
  { id: asBarberId('victor'), name: 'Victor', ig: 'vic.barber1' },
  { id: asBarberId('salman'), name: 'Salman', ig: 'frescobarbiere' },
]

/** Index of a barber in `BARBERS`, or -1 (source `bi = findIndex`). */
export function barberIndex(id: BarberId | null): number {
  return BARBERS.findIndex((b) => b.id === id)
}
