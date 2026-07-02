// The booking seam. A `BookingPort` turns a validated `Booking` into a `BookingResult`
// (links + echoed booking, or a domain error). The UI depends on this interface only; the
// concrete implementations are `localCalendarAdapter` (offline, no network) and
// `supabaseBookingAdapter` (the real backend).

import type { Booking, BookingResult, BarberId } from './domain'

/** Inputs for an availability query: which barber, which local day, and the chosen service length. */
export interface AvailabilityParams {
  readonly barberId: BarberId
  /** Local date `YYYY-MM-DD` (the calendar's selected day). */
  readonly dateIso: string
  /** Selected service duration in minutes (a slot is blocked iff it would overlap a booking). */
  readonly durationMin: number
}

export interface BookingPort {
  /** Submit a confirmed booking. Pure-local adapters resolve synchronously-wrapped. */
  submit(booking: Booking): Promise<BookingResult>
  /**
   * The TAKEN slot times for `barberId` on `dateIso` given `durationMin` — a subset of `SLOTS`
   * (e.g. `['09:45','13:30']`). The UI greys a slot iff its time is in this list (simple membership;
   * all overlap math lives inside the adapter). Resolves to the taken times.
   */
  availability(params: AvailabilityParams): Promise<readonly string[]>
}
