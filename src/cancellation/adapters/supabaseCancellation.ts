// The real (Supabase) CancellationPort adapter. `lookup` calls the `lookup_booking` RPC (matches the
// caller's NEXT upcoming confirmed booking by PROVEN contact — wrong contact -> not_found, so no
// enumeration of others); `cancel` calls `cancel_booking` (contact-guarded, idempotent).
//
// The looked-up booking carries only barber_id + service_name + price + start_at + method + contact
// (no other PII). We map barber_id -> Barber on the client (barbers are a frontend constant) and
// build the SAME "Weekday D Month, HH:MM" label `buildDemoBooking` produces, so the confirm step
// renders identically to the mock. Boundary discipline: parse every response; map failure to a
// localized error string rather than throwing.

import { getSupabase } from '../../backend/supabaseClient'
import { bookingLookupResponse, parseWith } from '../../backend/rpcSchemas'
import { BARBERS } from '../../booking/barbers'
import { formatWhenLabel } from '../../booking/calendar'
import type { Barber } from '../../booking/domain'
import { asBarberId } from '../../booking/domain'
import { cancelStrings } from '../../i18n/index'
import type { CancelBooking, CancelLookupResult, CancelResult } from '../domain'
import type { CancellationPort, CancelLookupParams } from '../port'

/** Safe default barber if the roster lookup ever misses (the DB only stores valid ids, so unreachable). */
const FALLBACK_BARBER: Barber = { id: asBarberId('hassan'), name: 'Hassan', ig: 'freebandzcuts' }

/** Resolve a barber by its (wire-string) id without narrowing the input to `BarberId`. */
function barberFromId(id: string): Barber {
  return BARBERS.find((b) => b.id === id) ?? FALLBACK_BARBER
}

export const supabaseCancellationAdapter: CancellationPort = {
  async lookup(params: CancelLookupParams): Promise<CancelLookupResult> {
    const notFound: CancelLookupResult = { ok: false, error: cancelStrings(params.lang).errLookup }
    try {
      const { data, error } = await getSupabase().rpc('lookup_booking', {
        p_contact: params.contact,
        p_method: params.method,
      })
      if (error !== null) return notFound

      const parsed = parseWith(bookingLookupResponse, data)
      if (!parsed.ok || !parsed.value.ok) return notFound

      const b = parsed.value.booking
      const start = new Date(b.start_at)
      const booking: CancelBooking = {
        id: b.id,
        barber: barberFromId(b.barber_id),
        serviceName: b.service_name,
        price: b.price,
        start,
        whenLabel: formatWhenLabel(params.lang, start),
        method: b.method,
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
