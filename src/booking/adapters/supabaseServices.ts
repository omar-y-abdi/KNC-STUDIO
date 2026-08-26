// Public services adapter backed by the same catalog request as the roster.

import type { BarberId, ServiceItem } from '../domain'
import type { ServicesPort } from '../servicesPort'
import { cachedBookingCatalog, servicesForBookingDate } from './supabaseBookingCatalog'

export const supabaseServicesAdapter: ServicesPort = {
  async listForBarber(barberId: BarberId, dateIso: string): Promise<readonly ServiceItem[]> {
    try {
      return servicesForBookingDate(await cachedBookingCatalog(), barberId, dateIso)
    } catch {
      return []
    }
  },
}
