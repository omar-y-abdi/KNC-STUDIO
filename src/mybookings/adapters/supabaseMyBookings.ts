// The real (Supabase) MyBookingsPort adapter. `listByPhone` reaches `list_bookings_by_phone` through
// the Turnstile- and rate-limit-protected public action gateway
// (every confirmed booking for the proven phone — past + future) and splits them into upcoming/past;
// an empty result maps to `not_found`. `cancel` uses the same gateway's contact-guarded cancellation
// action as the Avbokning flow, so a customer can only cancel a booking they can prove is theirs.
//
// Boundary discipline: parse every response with the Zod schema; map any failure to a domain error
// rather than throwing. Barber identity resolves through the LIVE roster first (an owner-added DB
// barber must show its own name), then the offline constants, then a minimal id-echoing stub.

import { invokePublicBookingAction } from '../../backend/publicBookingActions'
import {
  bookingLookupResponse,
  listBookingsByPhoneResponse,
  parseWith,
} from '../../backend/rpcSchemas'
import { defaultBarbersPort } from '../../booking/adapters/barbersIndex'
import { BARBERS } from '../../booking/barbers'
import type { Barber } from '../../booking/domain'
import { asBarberId } from '../../booking/domain'
import { stockholmWallClockDate } from '../../booking/stockholmTime'
import { myBookingsStrings } from '../../i18n/index'
import type { MyBooking, MyBookingsResult, MyCancelResult } from '../domain'
import { formatRowLabel, splitByTime } from '../format'
import type { MyBookingsLookupParams, MyBookingsPort } from '../port'

/** Resolve the booked barber's display identity: live roster → offline constants → id-echoing stub. */
async function barberFromId(id: string): Promise<Barber> {
  try {
    const roster = await defaultBarbersPort.listActive()
    const hit = roster.find((r) => r.barber.id === id)
    if (hit !== undefined) return hit.barber
  } catch {
    // Roster unavailable — fall through to the offline constants.
  }
  return BARBERS.find((b) => b.id === id) ?? { id: asBarberId(id), name: id, ig: '' }
}

export const supabaseMyBookingsAdapter: MyBookingsPort = {
  async listByPhone(params: MyBookingsLookupParams): Promise<MyBookingsResult> {
    const system: MyBookingsResult = { ok: false, error: 'system' }
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'list',
        phone: params.contact,
        turnstileToken: params.turnstileToken,
      })
      if (failed) return system

      const parsed = parseWith(listBookingsByPhoneResponse, data)
      if (!parsed.ok) return system
      if (!parsed.value.ok) return { ok: false, error: parsed.value.error }
      const rows = parsed.value.bookings
      if (rows.length === 0) return { ok: false, error: 'not_found' }

      const sep = myBookingsStrings(params.lang).atSep
      const mapped: MyBooking[] = []
      for (const r of rows) {
        // `start` stays the real instant (split by real now); the LABEL is built in salon wall-clock
        // — the timezone the customer picked the slot in — so a traveller sees the same time they booked.
        const start = new Date(r.start_at)
        mapped.push({
          id: r.id,
          barber: await barberFromId(r.barber_id),
          serviceName: r.service_name,
          price: r.price,
          durationMin: r.duration_min,
          start,
          whenLabel: formatRowLabel(params.lang, stockholmWallClockDate(start), sep),
        })
      }
      return { ok: true, bookings: splitByTime(mapped, new Date()) }
    } catch {
      return system
    }
  },

  async cancel(
    booking: MyBooking,
    contact: string,
    turnstileToken: string,
  ): Promise<MyCancelResult> {
    const failed: MyCancelResult = { ok: false, error: 'system' }
    try {
      const { data, failed: invokeFailed } = await invokePublicBookingAction({
        action: 'cancel',
        bookingId: booking.id,
        phone: contact,
        turnstileToken,
      })
      if (invokeFailed) return failed

      const parsed = parseWith(bookingLookupResponse, data)
      if (!parsed.ok) return failed
      if (!parsed.value.ok) return { ok: false, error: parsed.value.error }
      return { ok: true, id: booking.id }
    } catch {
      return failed
    }
  },
}
