// The real (Supabase) CancellationPort adapter. `lookup` calls the `lookup_booking` RPC (matches the
// caller's NEXT upcoming confirmed booking by PROVEN contact — wrong contact -> not_found, so no
// enumeration of others); `cancel` calls `cancel_booking` (contact-guarded, idempotent).
//
// The looked-up booking carries only barber_id + service_name + price + start_at + contact
// (no other PII). We map barber_id -> Barber via the LIVE roster (an owner-added DB barber must show
// its own name, never a constant's), and build the SAME "Weekday D Month, HH:MM" label
// `buildDemoBooking` produces — rendered in Europe/Stockholm wall-clock, the timezone the customer
// picked the slot in. Boundary discipline: parse every response; map failure to a localized error
// string rather than throwing.

import { getSupabase } from '../../backend/supabaseClient'
import { bookingLookupResponse, parseWith } from '../../backend/rpcSchemas'
import { defaultBarbersPort } from '../../booking/adapters/barbersIndex'
import { BARBERS } from '../../booking/barbers'
import { formatWhenLabel } from '../../booking/calendar'
import type { Barber } from '../../booking/domain'
import { asBarberId } from '../../booking/domain'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import { cancelStrings } from '../../i18n/index'
import type { CancelBooking, CancelLookupResult, CancelResult } from '../domain'
import type { CancellationPort, CancelLookupParams } from '../port'

/**
 * Resolve the booked barber's display identity: the live roster first (covers owner-added DB
 * barbers), then the offline constants, then a minimal stub echoing the raw id — NEVER a different
 * barber's name (a wrong name on the cancel-confirm step could cancel the wrong appointment).
 */
async function barberFromId(id: string): Promise<Barber> {
  try {
    const roster = await defaultBarbersPort.listActive()
    const hit = roster.find((r) => r.barber.id === id)
    if (hit !== undefined) return hit.barber
  } catch {
    // roster unavailable — fall through to the offline constants
  }
  return BARBERS.find((b) => b.id === id) ?? { id: asBarberId(id), name: id, ig: '' }
}

export const supabaseCancellationAdapter: CancellationPort = {
  async lookup(params: CancelLookupParams): Promise<CancelLookupResult> {
    const notFound: CancelLookupResult = { ok: false, error: cancelStrings(params.lang).errLookup }
    try {
      const { data, error } = await getSupabase().rpc('lookup_booking', {
        p_contact: params.contact,
      })
      if (error !== null) return notFound

      const parsed = parseWith(bookingLookupResponse, data)
      if (!parsed.ok || !parsed.value.ok) return notFound

      const b = parsed.value.booking
      const start = new Date(b.start_at)
      const booking: CancelBooking = {
        id: b.id,
        barber: await barberFromId(b.barber_id),
        serviceName: b.service_name,
        price: b.price,
        start,
        // Label the stored instant in SALON time — the wall-clock the customer picked the slot in —
        // not the browser's timezone (a traveller must see the same "13:30" they booked).
        whenLabel: formatWhenLabel(params.lang, stockholmWallClockDate(start)),
        contact: b.contact,
      }
      return { ok: true, booking }
    } catch {
      return notFound
    }
  },

  async cancel(booking: CancelBooking): Promise<CancelResult> {
    // The dialog shows its OWN localized `t.errCancel` on failure (it ignores this field's content),
    // so this required error string is a neutral fallback — never user-displayed.
    const failed: CancelResult = { ok: false, error: 'cancel_failed' }
    try {
      const { data, error } = await getSupabase().rpc('cancel_booking', {
        p_booking_id: booking.id,
        p_contact: booking.contact,
      })
      if (error !== null) return failed

      const parsed = parseWith(bookingLookupResponse, data)
      if (!parsed.ok || !parsed.value.ok) return failed
      return { ok: true, booking }
    } catch {
      return failed
    }
  },
}
