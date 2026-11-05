// Unconfigured builds intentionally expose no invented business roster.

import type { BarbersPort, RosterBarber } from '../barbersPort'

export const mockBarbersAdapter: BarbersPort = {
  listActive(): Promise<readonly RosterBarber[]> {
    return Promise.resolve([])
  },
}
