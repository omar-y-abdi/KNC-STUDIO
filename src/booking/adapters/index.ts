// The booking-adapter swap point. `defaultBookingPort` is chosen ONCE at module load from the env:
// Supabase when configured, the offline local adapter otherwise. With no `VITE_SUPABASE_*` set this is
// the local adapter, so the UI's behavior (and the visual baseline) is byte-identical to today.
//
// The Supabase adapter is reached through a LAZY proxy: each method dynamically imports the real
// adapter (and, through it, supabase-js) on first call. supabase-js therefore lands in its own chunk,
// fetched only when the backend is configured AND a booking action runs — it never weighs down the
// main bundle, and with no env it is never loaded at all.

import { isBackendConfigured } from '../../backend/config'
import type { Booking } from '../domain'
import type { AvailabilityParams, BookingPort } from '../port'
import { localCalendarAdapter } from './localCalendar'

const lazySupabaseBookingPort: BookingPort = {
  submit: (booking: Booking) =>
    import('./supabaseBooking').then((m) => m.supabaseBookingAdapter.submit(booking)),
  availability: (params: AvailabilityParams) =>
    import('./supabaseBooking').then((m) => m.supabaseBookingAdapter.availability(params)),
}

export const defaultBookingPort: BookingPort = isBackendConfigured()
  ? lazySupabaseBookingPort
  : localCalendarAdapter
