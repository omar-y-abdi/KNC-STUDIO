// The "backend-ready" seam for a barber's SERVICE MENU. A `ServicesPort` lists the ACTIVE services
// shown in booking step 3 for the chosen barber. Production reads `services`; unconfigured mode is
// empty, so a barber's edits remain the only public source of truth.

import type { BarberId, ServiceItem } from './domain'

export interface ServicesPort {
  /** The ACTIVE services for one barber, in display order (empty if the barber has none / on error). */
  listForBarber(barberId: BarberId): Promise<readonly ServiceItem[]>
}
