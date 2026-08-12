// The booking seam. A `BookingPort` turns a validated `Booking` into a `BookingResult`
// (links + echoed booking, or a domain error). The UI depends on this interface only; the
// concrete implementations are `localCalendarAdapter` (offline, no network) and
// `supabaseBookingAdapter` (the real backend).

import type { Booking, BookingResult, BarberId } from './domain'
import type { BusinessSettings } from '../site/siteChrome'

/** Inputs for an availability query: which barber, which local day, and the chosen service length. */
export interface AvailabilityParams {
  readonly barberId: BarberId
  /** Local date `YYYY-MM-DD` (the calendar's selected day). */
  readonly dateIso: string
  /** Selected service duration in minutes — the bookable start times step by this and pack tightly
   * around existing bookings/blocks. */
  readonly durationMin: number
}

export interface BookingPort {
  /** Submit a confirmed booking and build links with the current public business settings. */
  submit(booking: Booking, business?: BusinessSettings): Promise<BookingResult>
  /**
   * The AVAILABLE start times to render for `barberId` on `dateIso` given `durationMin` — ascending
   * `"HH:MM"` (e.g. `['09:00','09:30','10:30']`), duration-stepped and packed around existing
   * bookings/blocks (all packing math lives inside the adapter). An empty array means "no bookable
   * times" (barber off/on time-off, fully booked, or — for the backend adapter — a read error;
   * fail-closed). The UI renders each returned time as a selectable chip.
   */
  availability(params: AvailabilityParams): Promise<readonly string[]>
}
