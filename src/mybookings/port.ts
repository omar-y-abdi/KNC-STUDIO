// The "Mina bokningar" seam. A `MyBookingsPort` lists a phone's confirmed bookings (split
// upcoming/past) and cancels one upcoming booking. The dialog depends on this interface only; the
// concrete implementations are `mockMyBookingsAdapter` (offline demo data) and
// `supabaseMyBookingsAdapter` (the real backend: `list_bookings_by_phone` + `cancel_booking`).

import type { Lang } from '../i18n/index'
import type { MyBooking, MyBookingsResult, MyCancelResult } from './domain'

/** Validated lookup params — the contact is already format-checked (`parsePhone`) by the caller. */
export interface MyBookingsLookupParams {
  readonly contact: string
  /** UI language — the row labels are built in this language. */
  readonly lang: Lang
}

export interface MyBookingsPort {
  /** List a phone's confirmed bookings, split upcoming/past. `not_found` if the phone has none. */
  listByPhone(params: MyBookingsLookupParams): Promise<MyBookingsResult>
  /** Cancel one upcoming booking, guarded by the proven `contact` (phone). */
  cancel(booking: MyBooking, contact: string): Promise<MyCancelResult>
}
