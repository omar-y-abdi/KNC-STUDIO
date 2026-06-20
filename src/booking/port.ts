// The "backend-ready" seam. A `BookingPort` turns a validated `Booking` into a `BookingResult`
// (links + echoed booking, or a domain error). The UI depends on this interface only; the one
// concrete implementation today is `localCalendarAdapter` (no network). Future adapters
// (Supabase, webhook) would implement the same interface — they are intentionally not stubbed.

import type { Booking, BookingResult } from './domain'

export interface BookingPort {
  /** Submit a confirmed booking. Pure-local adapters resolve synchronously-wrapped. */
  submit(booking: Booking): Promise<BookingResult>
}
