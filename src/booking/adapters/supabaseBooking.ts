// First-party booking transport and server-authoritative availability. Optional device access
// is proved separately from booking success; contact fields never authenticate customer history.

import { bookingStrings } from '../../i18n/index'
import { DEFAULT_BUSINESS } from '../../config'
import { getSupabase } from '../../backend/supabaseClient'
import {
  availableSlotsResponse,
  bookingReceiptResponse,
  createBookingResponse,
  listCustomerBookingsResponse,
  parseWith,
} from '../../backend/rpcSchemas'
import { invokePublicBookingAction } from '../../backend/publicBookingActions'
import { readStoragePreferences } from '../../site/storageConsent'
import { withCustomerDeviceLock } from '../../mybookings/customerDeviceLock'
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
      return await withCustomerDeviceLock<BookingResult>(async (locked) => {
        const rememberBookings = locked && readStoragePreferences()?.functional === true
        const response = await globalThis.fetch('/api/bookings', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({
            booking: {
              barberId: booking.barber.id,
              serviceId: booking.service.id,
              // Selected browser wall-clock is anchored to the salon timezone before serialization.
              startAt: localWallClockToStockholmIso(booking.start),
              phone: booking.phone,
              email: booking.email,
              lang: booking.lang,
              customerName: booking.customerName,
            },
            turnstileToken: booking.turnstileToken,
            rememberBookings,
          }),
        })
        if (!response.ok) return { ok: false, error: submitError(booking) }
        const data: unknown = await response.json()
        const parsed = parseWith(createBookingResponse, data)
        if (!parsed.ok) return { ok: false, error: submitError(booking) }
        if (!parsed.value.ok)
          return { ok: false, error: bookingErrorFor(booking, parsed.value.error) }

        let customerAccess: 'ready' | 'email' = 'email'
        if (rememberBookings) {
          try {
            const receipt = bookingReceiptResponse.safeParse(data)
            if (receipt.success) {
              const probe = await invokePublicBookingAction({ action: 'list' })
              const listed = listCustomerBookingsResponse.safeParse(probe.data)
              if (
                !probe.failed &&
                listed.success &&
                listed.data.ok &&
                listed.data.receipt_proof === receipt.data.receipt_proof &&
                listed.data.bookings.some((row) => row.id === receipt.data.booking.id)
              ) {
                customerAccess = 'ready'
              }
            }
          } catch {
            // The booking already exists. Keep success and offer its email link as the fallback.
          }
        }
        return {
          ok: true,
          booking,
          links: buildLinks(booking, new Date(), business),
          customerAccess,
        }
      })
    } catch {
      return { ok: false, error: submitError(booking) }
    }
  },

  async availability(params: AvailabilityParams): Promise<readonly string[]> {
    try {
      // `p_date` is the calendar's local `YYYY-MM-DD` — the RPC derives the weekday in
      // Europe/Stockholm, so the day window matches the salon's timezone (correct on a UTC server).
      const rpc =
        params.serviceId === undefined
          ? getSupabase().rpc('available_slots', {
              p_barber_id: params.barberId,
              p_date: params.dateIso,
              p_duration_min: params.durationMin,
            })
          : getSupabase().rpc('available_slots_for_service', {
              p_barber_id: params.barberId,
              p_date: params.dateIso,
              p_service_id: params.serviceId,
            })
      const { data, error } = await rpc
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
