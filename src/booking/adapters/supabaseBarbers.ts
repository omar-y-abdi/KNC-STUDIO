// Public roster adapter backed by the shared, Zod-validated catalog RPC cache.

import type { BarbersPort, RosterBarber } from '../barbersPort'
import { refreshBookingCatalog } from './supabaseBookingCatalog'

export const supabaseBarbersAdapter: BarbersPort = {
  async listActive(): Promise<readonly RosterBarber[]> {
    try {
      return (await refreshBookingCatalog()).barbers
    } catch {
      return []
    }
  },
}
