// Services swap point. Production shares cachedBookingCatalog with roster/photo hydration;
// unconfigured builds return no fabricated service menu.

import { isBackendConfigured } from '../../backend/config'
import type { BarberId, ServiceItem } from '../domain'
import type { ServicesPort } from '../servicesPort'
import { mockServicesAdapter } from './mockServices'

const lazySupabaseServicesPort: ServicesPort = {
  listForBarber: (barberId: BarberId, dateIso: string): Promise<readonly ServiceItem[]> =>
    import('./supabaseBookingCatalog').then((m) =>
      m
        .cachedBookingCatalog()
        .then((catalog) => m.servicesForBookingDate(catalog, barberId, dateIso)),
    ),
}

export const defaultServicesPort: ServicesPort = isBackendConfigured()
  ? lazySupabaseServicesPort
  : mockServicesAdapter
