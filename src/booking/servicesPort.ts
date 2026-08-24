// The "backend-ready" seam for a barber's SERVICE MENU. A `ServicesPort` lists the ACTIVE services
// shown in booking step 3 for the chosen barber. Mirrors the barber-roster port: one offline mock
// (a flat starter menu, matching the DB seed) and one Supabase implementation (reads the `services`
// table for that barber). So a barber's edits in the admin panel appear on the live booking flow.

import type { BarberId, ServiceItem } from './domain'

export interface ServicesPort {
  /** Active services bookable for one barber on one salon-local calendar date, in display order. */
  listForBarber(barberId: BarberId, dateIso: string): Promise<readonly ServiceItem[]>
}
