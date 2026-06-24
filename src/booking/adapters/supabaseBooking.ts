// The real (Supabase) BookingPort adapter. `submit` calls the `create_booking` RPC; `availability`
// calls the schedule-aware `available_slots` RPC and returns the TAKEN set = `SLOTS` minus the
// AVAILABLE slots the RPC reports. Returning TAKEN (not available) keeps the BookingFlow change
// minimal: the UI still greys a slot iff its time is in this list (`takenTimes.includes(time)`).
// Links for a successful submit are built with the EXACT same `buildLinks` the mock uses, so the
// confirmation modal (.ics + Google Cal + maps) is identical regardless of backend.
//
// `available_slots(p_barber_id, p_date, p_duration_min)` is schedule-aware: it returns NOTHING when
// the barber is off that weekday or on time-off, and otherwise the fixed SLOTS that fit the working
// hours AND don't overlap a confirmed booking — all computed in Europe/Stockholm on the server. So
// an OFF day yields every slot TAKEN here (the whole grid greys), exactly matching "barber off".
//
// Boundary discipline: every RPC response is Zod-parsed (never trust the wire) and every failure —
// transport error, malformed payload, or `{ok:false}` — is mapped to a `BookingError`/empty
// availability rather than thrown. On a submit failure the UI shows `t.errSubmit`. On an availability
// error we fall back to "nothing taken" (an empty TAKEN set) and let the DB exclusion constraint be
// the backstop, so a transient read error never blocks booking.

import { bookingStrings } from '../../i18n/index'
import { getSupabase } from '../../backend/supabaseClient'
import {
  availableSlotsResponse,
  createBookingResponse,
  parseWith,
} from '../../backend/rpcSchemas'
import type { Booking, BookingError, BookingResult } from '../domain'
import type { AvailabilityParams, BookingPort } from '../port'
import { SLOTS } from '../slots'
import { buildLinks } from './localCalendar'

/** A short, friendly submit error. The UI shows `t.errSubmit`; this keeps the domain error localized. */
function submitError(booking: Booking): BookingError {
  return { kind: 'submit', message: bookingStrings(booking.lang).errSubmit }
}

export const supabaseBookingAdapter: BookingPort = {
  async submit(booking: Booking): Promise<BookingResult> {
    try {
      const { data, error } = await getSupabase().rpc('create_booking', {
        p_barber_id: booking.barber.id,
        p_service_id: booking.service.id,
        p_service_name: booking.service.name,
        p_price: booking.service.price,
        p_duration_min: booking.service.dur,
        p_start_at: booking.start.toISOString(),
        p_method: booking.confirmMethod,
        // Only the chosen channel carries a value; the other is null (the RPC also enforces this).
        p_phone: booking.phone === '' ? null : booking.phone,
        p_email: booking.email === '' ? null : booking.email,
        p_lang: booking.lang,
        // 11th arg — REQUIRED by the DB (customer_name is NOT NULL); echoed back to nobody.
        p_customer_name: booking.customerName,
      })
      if (error !== null) return { ok: false, error: submitError(booking) }

      const parsed = parseWith(createBookingResponse, data)
      if (!parsed.ok || !parsed.value.ok) return { ok: false, error: submitError(booking) }

      // Success — build the calendar/map links from the SAME builder the mock uses.
      const links = buildLinks(booking)
      return { ok: true, booking, links }
    } catch {
      return { ok: false, error: submitError(booking) }
    }
  },

  async availability(params: AvailabilityParams): Promise<readonly string[]> {
    let available: ReadonlySet<string>
    try {
      // `p_date` is the calendar's local `YYYY-MM-DD` — the RPC derives the weekday in
      // Europe/Stockholm, so the day window matches the salon's timezone (correct on a UTC server).
      const { data, error } = await getSupabase().rpc('available_slots', {
        p_barber_id: params.barberId,
        p_date: params.dateIso,
        p_duration_min: params.durationMin,
      })
      if (error !== null) return []
      const parsed = parseWith(availableSlotsResponse, data)
      if (!parsed.ok) return []
      available = new Set(parsed.value)
    } catch {
      return []
    }

    // TAKEN = the fixed grid minus what the RPC reports as available. A slot the RPC omits (booked,
    // outside hours, off day, or on time-off) is greyed; an OFF day greys the whole grid.
    return SLOTS.filter((time) => !available.has(time))
  },
}
