// Unconfigured builds intentionally expose no invented service catalog.
import type { ServicesPort } from '../servicesPort'
import type { ServiceItem } from '../domain'

export const mockServicesAdapter: ServicesPort = {
  listForBarber(): Promise<readonly ServiceItem[]> {
    return Promise.resolve([])
  },
}
