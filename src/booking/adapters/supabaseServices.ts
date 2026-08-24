// The real (Supabase) ServicesPort adapter. `listForBarber` reads the `services` table — the chosen
// barber's ACTIVE rows, ordered by sort_order — and maps each to a booking-domain `ServiceItem`
// (dur = duration_min). RLS already restricts anon to active rows; we filter active explicitly too.
//
// Boundary discipline: every row is Zod-parsed (never trust the wire). A malformed row is DROPPED
// (rather than crashing the menu); a transport error resolves to an EMPTY list, and the booking step
// then shows its "no services" state rather than a broken menu.

import { getSupabase } from '../../backend/supabaseClient'
import { parseWith, publicServiceRow } from '../../backend/rpcSchemas'
import type { PublicServiceRow } from '../../backend/rpcSchemas'
import { parseDateIso } from '../calendar'
import type { BarberId, ServiceItem } from '../domain'
import type { ServicesPort } from '../servicesPort'

/** Map a parsed raw `services` row into a booking-domain `ServiceItem`. */
function toService(r: PublicServiceRow): ServiceItem {
  return { id: r.id, name: r.name, price: r.price, dur: r.duration_min }
}

export const supabaseServicesAdapter: ServicesPort = {
  async listForBarber(barberId: BarberId, dateIso: string): Promise<readonly ServiceItem[]> {
    try {
      const parts = parseDateIso(dateIso)
      if (parts === null) return []
      const weekday = new Date(parts.year, parts.month - 1, parts.day).getDay()
      const { data, error } = await getSupabase()
        .from('services')
        .select('id,barber_id,name,price,duration_min,active,sort_order,available_weekdays')
        .eq('barber_id', barberId)
        .eq('active', true)
        .contains('available_weekdays', [weekday])
        .order('sort_order', { ascending: true })
      if (error !== null || data === null) return []

      const out: ServiceItem[] = []
      for (const raw of data) {
        const parsed = parseWith(publicServiceRow, raw)
        if (parsed.ok && parsed.value.active) out.push(toService(parsed.value))
      }
      return out
    } catch {
      return []
    }
  },
}
