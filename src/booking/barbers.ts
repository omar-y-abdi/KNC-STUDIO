// The barber roster — copied verbatim from the source `BF_BARBERS` (index.html lines 112-116).

import type { Barber, BarberId } from './domain'

export const BARBERS: readonly Barber[] = [
  { id: 'hassan', name: 'Hassan', ig: 'freebandzcuts' },
  { id: 'victor', name: 'Victor', ig: 'vic.barber1' },
  { id: 'salman', name: 'Salman', ig: 'frescobarbiere' },
]

/** Index of a barber in `BARBERS`, or -1 (source `bi = findIndex`). */
export function barberIndex(id: BarberId | null): number {
  return BARBERS.findIndex((b) => b.id === id)
}

/** Look up a barber by id (source `BF_BARBERS.find`). */
export function findBarber(id: BarberId | null): Barber | undefined {
  return BARBERS.find((b) => b.id === id)
}
