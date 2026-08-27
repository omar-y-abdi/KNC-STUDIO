// The "backend-ready" seam for a barber's SERVICE MENU. A `ServicesPort` lists the ACTIVE services
// shown in booking step 3 for the chosen barber. Production reads `services`; unconfigured mode is
// empty, so a barber's edits remain the only public source of truth.

import type { BarberId, ServiceItem } from './domain'

export interface ServicesPort {
  /** Active services bookable for one barber on one salon-local calendar date, in display order. */
  listForBarber(barberId: BarberId, dateIso: string): Promise<readonly ServiceItem[]>
}
