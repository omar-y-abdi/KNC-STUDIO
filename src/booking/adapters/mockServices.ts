// The offline (mock) ServicesPort: returns the flat starter menu (the same one supabase/seed.sql
// gives each barber), for every barber. Resolves synchronously-wrapped so the booking service step
// paints immediately with no layout shift — with no backend the menu is known at module load.
//
// Service names are single strings (not i18n): a barber names their own cuts, so the same name shows
// in both languages — the intended behaviour of the per-barber catalog.

import type { ServiceItem } from '../domain'
import type { ServicesPort } from '../servicesPort'

/** The flat starter menu — identical to the per-barber DB seed in supabase/seed.sql. */
export const MOCK_SERVICES: readonly ServiceItem[] = [
  { id: 'hs', name: 'Hårklippning + skägg', price: 450, dur: 60 },
  { id: 'h', name: 'Hårklippning', price: 350, dur: 45 },
  { id: 'b', name: 'Skäggklippning', price: 200, dur: 30 },
  { id: 'stu', name: 'Studentklippning', price: 300, dur: 45 },
  { id: 'kid', name: 'Klippning, barn', price: 289, dur: 45 },
]

export const mockServicesAdapter: ServicesPort = {
  listForBarber(): Promise<readonly ServiceItem[]> {
    return Promise.resolve(MOCK_SERVICES)
  },
}
