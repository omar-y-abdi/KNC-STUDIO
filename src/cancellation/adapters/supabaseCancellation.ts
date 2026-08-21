// The real (Supabase) CancellationPort adapter. `lookup` reaches `lookup_booking` through the
// Turnstile- and rate-limit-protected public action gateway (matches the
// caller's NEXT upcoming confirmed booking by PROVEN contact — wrong contact -> not_found, so no
// enumeration of others); `cancel` reaches `cancel_booking` through the same gateway
// (contact-guarded, idempotent).
//
// The looked-up booking carries only barber_id + service_name + price + start_at + contact
// (no other PII). We map barber_id -> Barber via the LIVE roster (an owner-added DB barber must show
// its own name, never a constant's), and build the SAME "Weekday D Month, HH:MM" label
// `buildDemoBooking` produces — rendered in Europe/Stockholm wall-clock, the timezone the customer
// picked the slot in. Boundary discipline: parse every response; map failure to a localized error
// string rather than throwing.

import { invokePublicBookingAction } from '../../backend/publicBookingActions'
import { bookingLookupResponse, parseWith } from '../../backend/rpcSchemas'
import { defaultBarbersPort } from '../../booking/adapters/barbersIndex'
import { BARBERS } from '../../booking/barbers'
import { formatWhenLabel } from '../../booking/calendar'
import type { Barber } from '../../booking/domain'
import { asBarberId } from '../../booking/domain'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
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
    const system: CancelLookupResult = { ok: false, error: 'system' }
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'lookup',
        phone: params.contact,
        turnstileToken: params.turnstileToken,
      })
      if (failed) return system

      const parsed = parseWith(bookingLookupResponse, data)
      if (!parsed.ok) return system
      if (!parsed.value.ok) return { ok: false, error: parsed.value.error }

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
      return system
    }
  },

  async cancel(booking: CancelBooking, turnstileToken: string): Promise<CancelResult> {
    // The dialog shows its OWN localized `t.errCancel` on failure (it ignores this field's content),
    // so this required error string is a neutral fallback — never user-displayed.
    const failed: CancelResult = { ok: false, error: 'system' }
    try {
      const { data, failed: invokeFailed } = await invokePublicBookingAction({
        action: 'cancel',
        bookingId: booking.id,
        phone: booking.contact,
        turnstileToken,
      })
      if (invokeFailed) return failed

      const parsed = parseWith(bookingLookupResponse, data)
      if (!parsed.ok) return failed
      if (!parsed.value.ok) return { ok: false, error: parsed.value.error }
      return { ok: true, booking }
    } catch {
      return failed
    }
  },
}
