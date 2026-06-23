// The real (Supabase) BookingPort adapter. `submit` calls the `create_booking` RPC; `availability`
// calls `taken_slots` and computes which fixed SLOTS would overlap a confirmed booking. Links for a
// successful submit are built with the EXACT same `buildLinks` the mock uses, so the confirmation
// modal (.ics + Google Cal + maps) is identical regardless of backend.
//
// Boundary discipline: every RPC response is Zod-parsed (never trust the wire) and every failure —
// transport error, malformed payload, or `{ok:false}` — is mapped to a `BookingError`/empty
// availability rather than thrown. The UI shows `t.errSubmit` on a submit failure; on an availability
// error we fall back to "nothing taken" and let the DB exclusion constraint be the backstop.

import { bookingStrings } from '../../i18n/index'
import { getSupabase } from '../../backend/supabaseClient'
import {
  createBookingResponse,
  parseWith,
  takenSlotsResponse,
} from '../../backend/rpcSchemas'
import type { TakenSlotRow } from '../../backend/rpcSchemas'
import type { Booking, BookingError, BookingResult } from '../domain'
import type { AvailabilityParams, BookingPort } from '../port'
import { SLOTS } from '../slots'
import { buildLinks } from './localCalendar'

/** A short, friendly submit error. The UI shows `t.errSubmit`; this keeps the domain error localized. */
function submitError(booking: Booking): BookingError {
  return { kind: 'submit', message: bookingStrings(booking.lang).errSubmit }
}

/** Parse `YYYY-MM-DD` into numeric parts (NaN-safe; callers build local Dates from these). */
function parseDateIso(dateIso: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateIso.split('-').map(Number)
  return { year: y ?? 0, month: m ?? 1, day: d ?? 1 }
}

/** Parse `HH:MM` into numeric parts (NaN-safe). */
function parseTime(time: string): { hours: number; minutes: number } {
  const [hh, mm] = time.split(':').map(Number)
  return { hours: hh ?? 0, minutes: mm ?? 0 }
}

/** Does `[candStart, candEnd)` overlap `[rangeStart, rangeEnd)`? (half-open, instant comparison) */
function overlaps(candStart: Date, candEnd: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return candStart < rangeEnd && candEnd > rangeStart
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
    const { year, month, day } = parseDateIso(params.dateIso)
    // Browser-LOCAL day window [00:00, next 00:00) — matches BookingFlow's slot-start convention
    // (`new Date(y, m-1, d, hh, mm)`), serialized to instants for the timestamptz query.
    const from = new Date(year, month - 1, day, 0, 0, 0)
    const to = new Date(year, month - 1, day + 1, 0, 0, 0)

    let rows: readonly TakenSlotRow[]
    try {
      const { data, error } = await getSupabase().rpc('taken_slots', {
        p_barber_id: params.barberId,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      })
      if (error !== null) return []
      const parsed = parseWith(takenSlotsResponse, data)
      if (!parsed.ok) return []
      rows = parsed.value
    } catch {
      return []
    }

    const ranges = rows.map((r) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }))
    // A slot is taken iff its [start, start+duration) window overlaps ANY confirmed booking range.
    return SLOTS.filter((time) => {
      const { hours, minutes } = parseTime(time)
      const candStart = new Date(year, month - 1, day, hours, minutes)
      const candEnd = new Date(candStart.getTime() + params.durationMin * 60000)
      return ranges.some((rng) => overlaps(candStart, candEnd, rng.start, rng.end))
    })
  },
}
