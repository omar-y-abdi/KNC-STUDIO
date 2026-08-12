// The real (Supabase) BookingPort adapter. `submit` calls the `create_booking` RPC; `availability`
// calls the schedule-aware `available_slots` RPC and returns its AVAILABLE start times VERBATIM (the
// ascending `"HH:MM"` list the UI renders as selectable chips). Links for a successful submit are
// built with the EXACT same `buildLinks` the mock uses, so the confirmation modal (.ics + Google Cal
// + maps) is identical regardless of backend.
//
// `available_slots(p_barber_id, p_date, p_duration_min)` is schedule-aware: it returns NOTHING when
// the barber is off that weekday or on time-off, and otherwise the AVAILABLE start times on a fixed
// 15-min grid where the service fits (ends by close, overlaps no booking/block) — computed in Europe/Stockholm on
// the server. So an OFF day yields an empty list here (no times shown), exactly matching "barber off".
//
// Boundary discipline: every RPC response is Zod-parsed (never trust the wire) and every failure —
// transport error or malformed payload — is mapped to an empty list rather than thrown. On a submit
// failure the UI shows `t.errSubmit`. On an availability error we FAIL CLOSED (show no times rather
// than wrong ones); create_booking still validates the slot on submit, so a stale read can't confirm
// an unavailable time.

import { bookingStrings } from '../../i18n/index'
import { DEFAULT_BUSINESS } from '../../config'
import { getSupabase } from '../../backend/supabaseClient'
import { availableSlotsResponse, createBookingResponse, parseWith } from '../../backend/rpcSchemas'
import type { Booking, BookingError, BookingResult } from '../domain'
import type { AvailabilityParams, BookingPort } from '../port'
import { localWallClockToStockholmIso } from '../stockholmTime'
import { buildLinks } from './localCalendar'
import type { BusinessSettings } from '../../site/siteChrome'

/** A short, friendly submit error. The UI shows `t.errSubmit`; this keeps the domain error localized. */
function submitError(booking: Booking): BookingError {
  return { kind: 'submit', message: bookingStrings(booking.lang).errSubmit }
}

/** Map a gateway/RPC error code to a localized `BookingError`. `rate_limited` + `failed_challenge`
 * (added by the submit-booking gateway) get their own messages; every create_booking error code
 * (slot_taken, outside_hours, invalid_time, …) collapses to the generic submit error. */
function bookingErrorFor(booking: Booking, code: string): BookingError {
  const t = bookingStrings(booking.lang)
  const message =
    code === 'rate_limited'
      ? t.errRateLimited
      : code === 'failed_challenge'
        ? t.errChallenge
        : t.errSubmit
  return { kind: 'submit', message }
}

export const supabaseBookingAdapter: BookingPort = {
  async submit(
    booking: Booking,
    business: BusinessSettings = DEFAULT_BUSINESS,
  ): Promise<BookingResult> {
    try {
      // The browser no longer calls create_booking directly — it POSTs to the `submit-booking` edge
      // function (the gateway: Turnstile verification + IP/phone rate-limit, then create_booking via
      // service_role). `functions.invoke` attaches the anon apikey and parses the JSON response; the
      // gateway returns HTTP 200 with the create_booking Result verbatim (or a rate_limited /
      // failed_challenge Result), so a `{ok:false}` is a real rejection, not a transport error.
      const { data, error } = await getSupabase().functions.invoke('submit-booking', {
        body: {
          booking: {
            barberId: booking.barber.id,
            serviceId: booking.service.id,
            // H2: `booking.start` is the selected slot in the BROWSER's local components (its wall-clock
            // reads back "13:30" in any tz). Re-anchor to Europe/Stockholm and send the STRING — sending
            // the raw Date would let JSON.stringify serialize it in the browser tz and shift the instant.
            startAt: localWallClockToStockholmIso(booking.start),
            phone: booking.phone,
            email: booking.email,
            lang: booking.lang,
            customerName: booking.customerName,
          },
          turnstileToken: booking.turnstileToken,
        },
      })
      if (error !== null) return { ok: false, error: submitError(booking) }

      const parsed = parseWith(createBookingResponse, data)
      if (!parsed.ok) return { ok: false, error: submitError(booking) }
      if (!parsed.value.ok)
        return { ok: false, error: bookingErrorFor(booking, parsed.value.error) }

      // Success — build the calendar/map links from the SAME builder the mock uses.
      const links = buildLinks(booking, new Date(), business)
      return { ok: true, booking, links }
    } catch {
      return { ok: false, error: submitError(booking) }
    }
  },

  async availability(params: AvailabilityParams): Promise<readonly string[]> {
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
      // The RPC already returns the AVAILABLE start times, ascending — render them as-is. Any failure
      // (transport, malformed) fell through to `[]` above: fail closed rather than show wrong times.
      return parsed.value
    } catch {
      return []
    }
  },
}
