// Bookings admin adapter. READS go through RLS (owner sees every booking via bookings_select_owner;
// a barber sees ONLY their own via bookings_select_own) — so a barber CANNOT read another barber's
// bookings even by asking. CANCEL goes through the `admin_cancel_booking` SECURITY DEFINER RPC (the
// single audited write path; it re-derives authority from the caller's role).
//
// Filtering: `listBookings(barberId)` adds an explicit `.eq('barber_id', ...)` so the owner can scope
// to one barber; with no id it lists everything the RLS policy allows (owner=all). The barber role's
// RLS already restricts the result regardless of the filter.
//
// Boundary discipline: rows + RPC response Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { adminBookingRows, adminCancelResponse, parseWith } from '../adminSchemas'
import type { AdminBarberId, AdminBooking, AdminResult } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa bokningar.'
const CANCEL_ERROR = 'Kunde inte avboka. Försök igen.'

/** Map a parsed raw booking row into the admin domain type (timestamps -> Date). */
function toBooking(r: {
  id: string
  barber_id: string
  service_name: string
  price: number
  duration_min: number
  start_at: string
  end_at: string
  customer_name: string
  method: 'sms' | 'email'
  phone: string | null
  email: string | null
  lang: 'sv' | 'en'
  status: 'confirmed' | 'cancelled'
}): AdminBooking {
  return {
    id: r.id,
    barberId: r.barber_id,
    serviceName: r.service_name,
    price: r.price,
    durationMin: r.duration_min,
    startAt: new Date(r.start_at),
    endAt: new Date(r.end_at),
    customerName: r.customer_name,
    method: r.method,
    phone: r.phone,
    email: r.email,
    lang: r.lang,
    status: r.status,
  }
}

const COLUMNS =
  'id,barber_id,service_name,price,duration_min,start_at,end_at,customer_name,method,phone,email,lang,status'

/**
 * List bookings, newest start first. With `barberId` the owner scopes to one barber; without it the
 * caller sees everything RLS allows (owner=all bookings, barber=own). A barber passing another id
 * still gets only their own rows (RLS), so the filter cannot widen access.
 */
export async function listBookings(
  barberId?: AdminBarberId,
): Promise<AdminResult<readonly AdminBooking[]>> {
  try {
    const base = getAdminClient().from('bookings').select(COLUMNS)
    const query = barberId === undefined ? base : base.eq('barber_id', barberId)
    const { data, error } = await query.order('start_at', { ascending: false })
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(adminBookingRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map(toBooking))
  } catch {
    return err('network', READ_ERROR)
  }
}

/**
 * Cancel a CONFIRMED booking via the RPC. Returns the booking id on success. The RPC's own
 * authorization maps to a typed error: 'forbidden' (not owner/owning-barber) or 'not_found' (missing
 * or already cancelled) — surfaced so the UI can message precisely.
 */
export async function cancelBooking(bookingId: string): Promise<AdminResult<{ id: string }>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_cancel_booking', {
      p_booking_id: bookingId,
    })
    if (error !== null) return err('network', CANCEL_ERROR)

    const parsed = parseWith(adminCancelResponse, data)
    if (!parsed.ok) return err('malformed', CANCEL_ERROR)
    if (!parsed.value.ok) {
      if (parsed.value.error === 'forbidden') {
        return err('forbidden', 'Du kan bara avboka egna bokningar.')
      }
      return err('not_found', 'Bokningen finns inte eller är redan avbokad.')
    }
    return ok({ id: parsed.value.booking.id })
  } catch {
    return err('network', CANCEL_ERROR)
  }
}
