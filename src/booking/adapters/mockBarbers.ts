// The offline (mock) BarbersPort: returns the `BARBERS` constant roster, with NO per-barber About
// copy (`copy: null`) — under the mock the About section uses its own i18n `stylists` table as the
// fallback. Resolves synchronously-wrapped so the public render is immediate (no layout shift, no
// loading flash): with no backend the roster is known at module load, exactly as before.

import { BARBERS } from '../barbers'
import type { BarbersPort, RosterBarber } from '../barbersPort'

/** The constant roster as `RosterBarber[]` (no DB copy, no photo) — the seed + the mock fallback. */
export const CONSTANT_ROSTER: readonly RosterBarber[] = BARBERS.map((barber) => ({
  barber,
  copy: null,
  photoUrl: null,
}))

export const mockBarbersAdapter: BarbersPort = {
  listActive(): Promise<readonly RosterBarber[]> {
    return Promise.resolve(CONSTANT_ROSTER)
  },
}
