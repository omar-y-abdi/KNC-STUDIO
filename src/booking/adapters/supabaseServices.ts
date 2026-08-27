// Public services adapter backed by the same catalog request as the roster.

import type { BarberId, ServiceItem } from '../domain'
import type { ServicesPort } from '../servicesPort'
import { refreshBookingCatalog } from './supabaseBookingCatalog'

export const supabaseServicesAdapter: ServicesPort = {
  async listForBarber(barberId: BarberId): Promise<readonly ServiceItem[]> {
    try {
      return (await refreshBookingCatalog()).servicesByBarber.get(barberId) ?? []
    } catch {
      return []
    }
  },
}
