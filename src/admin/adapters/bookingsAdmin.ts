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
import {
  adminBookingRows,
  adminCancelResponse,
  adminCreateBookingResponse,
  adminDeleteBookingsResponse,
  adminPurgeHistoryResponse,
  parseWith,
} from '../adminSchemas'
import type { AdminBarberId, AdminBooking, AdminResult } from '../types'
import { err, ok } from '../types'
import { localWallClockToStockholmIso } from '../../booking/stockholmTime'

const READ_ERROR = 'Kunde inte läsa bokningar.'
const CANCEL_ERROR = 'Kunde inte avboka. Försök igen.'
const RESERVE_ERROR = 'Kunde inte reservera. Försök igen.'
const DELETE_ERROR = 'Kunde inte radera bokningar. Försök igen.'
const PURGE_ERROR = 'Kunde inte tömma historiken. Försök igen.'

/** Fields for a manual "Reservera kund" booking (all but the time are optional at the UI). */
export interface ManualBooking {
  readonly startAt: Date
  readonly durationMin: number
  readonly serviceName: string
  readonly price: number
  readonly customerName: string
  /** Normalized phone, or null for a contact-less walk-in. */
  readonly phone: string | null
}

/**
 * Reserve a customer via the `admin_create_booking` RPC (owner any barber; a barber only their own).
 * Writes a real booking row honoring the no-double-book constraint; a phone makes it visible under
 * "Mina bokningar". Maps the RPC's typed errors to admin errors the dialog can message precisely.
 */
export async function createManualBooking(
  barberId: AdminBarberId,
  b: ManualBooking,
): Promise<AdminResult<true>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_create_booking', {
      p_barber_id: barberId,
      // `startAt` carries the salon-local WALL CLOCK the barber picked, in a browser-local Date.
      // Re-anchor it to the Stockholm instant at the wire boundary — same as the public booking flow
      // (supabaseBooking.ts) — so an admin on a non-Stockholm machine can't store the wrong time.
      p_start_at: localWallClockToStockholmIso(b.startAt),
      p_duration_min: b.durationMin,
      p_service_name: b.serviceName,
      p_price: b.price,
      p_customer_name: b.customerName,
      p_phone: b.phone,
    })
    if (error !== null) return err('network', RESERVE_ERROR)

    const parsed = parseWith(adminCreateBookingResponse, data)
    if (!parsed.ok) return err('malformed', RESERVE_ERROR)
    if (!parsed.value.ok) {
      if (parsed.value.error === 'forbidden') return err('forbidden', 'Du saknar behörighet.')
      if (parsed.value.error === 'slot_taken') return err('validation', 'Tiden är redan bokad.')
      if (parsed.value.error === 'outside_hours') {
        return err('validation', 'Tiden ligger utanför arbetstid eller är blockerad.')
      }
      return err('validation', 'Kontrollera uppgifterna och försök igen.')
    }
    return ok(true)
  } catch {
    return err('network', RESERVE_ERROR)
  }
}

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
  method: 'phone' | 'email' | 'walkin'
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
 * still gets only their own rows (RLS), so the filter cannot widen access. `fromIso` (an ISO
 * instant) trims the result to bookings starting at/after it — the day grid passes local midnight
 * so its payload stays bounded as history accumulates.
 */
export async function listBookings(
  barberId?: AdminBarberId,
  fromIso?: string,
): Promise<AdminResult<readonly AdminBooking[]>> {
  try {
    const base = getAdminClient().from('bookings').select(COLUMNS)
    const scoped = barberId === undefined ? base : base.eq('barber_id', barberId)
    const query = fromIso === undefined ? scoped : scoped.gte('start_at', fromIso)
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

/**
 * Permanently delete bookings by id via the `admin_delete_bookings` RPC (owner any barber; a barber
 * only their own — the RPC re-derives authority). Intended for past/cancelled rows: the RPC REFUSES
 * (`has_upcoming`) if any id is still a live upcoming appointment, and rejects an empty selection
 * (`empty`). Returns the number of rows actually deleted.
 */
export async function deleteBookings(ids: readonly string[]): Promise<AdminResult<number>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_delete_bookings', {
      p_ids: ids,
    })
    if (error !== null) return err('network', DELETE_ERROR)

    const parsed = parseWith(adminDeleteBookingsResponse, data)
    if (!parsed.ok) return err('malformed', DELETE_ERROR)
    if (!parsed.value.ok) {
      if (parsed.value.error === 'forbidden') {
        return err('forbidden', 'Du kan bara radera egna bokningar.')
      }
      if (parsed.value.error === 'has_upcoming') {
        return err('validation', 'Kommande bokningar kan inte raderas.')
      }
      return err('validation', 'Inga bokningar valda.')
    }
    return ok(parsed.value.count)
  } catch {
    return err('network', DELETE_ERROR)
  }
}

/**
 * Purge ALL past/cancelled booking history via the `admin_purge_history` RPC (owner-only; a barber is
 * denied with `forbidden`). Returns the number of rows removed. Irreversible — the caller confirms first.
 */
export async function purgeHistory(): Promise<AdminResult<number>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_purge_history')
    if (error !== null) return err('network', PURGE_ERROR)

    const parsed = parseWith(adminPurgeHistoryResponse, data)
    if (!parsed.ok) return err('malformed', PURGE_ERROR)
    if (!parsed.value.ok) return err('forbidden', 'Bara ägaren kan tömma all historik.')
    return ok(parsed.value.count)
  } catch {
    return err('network', PURGE_ERROR)
  }
}
