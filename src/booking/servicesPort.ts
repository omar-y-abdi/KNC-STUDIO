// The "backend-ready" seam for a barber's SERVICE MENU. A `ServicesPort` lists the ACTIVE services
// shown in booking step 3 for the chosen barber. Mirrors the barber-roster port: one offline mock
// (a flat starter menu, matching the DB seed) and one Supabase implementation (reads the `services`
// table for that barber). So a barber's edits in the admin panel appear on the live booking flow.

import type { BarberId, ServiceItem } from './domain'

export interface ServicesPort {
  /** The ACTIVE services for one barber, in display order (empty if the barber has none / on error). */
  listForBarber(barberId: BarberId): Promise<readonly ServiceItem[]>
}
