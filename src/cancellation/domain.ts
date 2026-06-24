// Domain ADTs for the cancellation flow. A `CancelBooking` is the appointment surfaced by a
// lookup; the port models lookup + cancel as Result unions so a future backend's "not found" /
// "already cancelled" outcomes are representable (the mock only ever succeeds). Mirrors the booking
// domain's shape (branded-ish closed unions, explicit failure in the type).

import type { Barber } from '../booking/domain'

/**
 * An appointment returned by a lookup. Carries everything the confirm step needs to render the
 * booking summary (barber, when, service · price). Pre-formatted display strings keep the dialog
 * presentation-only; the raw `start` is kept too for any future logic.
 */
export interface CancelBooking {
  readonly id: string
  readonly barber: Barber
  readonly serviceName: string
  readonly price: number
  /** Local appointment start. */
  readonly start: Date
  /** Localised "Weekday D Month, HH:MM" line for the summary (built by the demo builder). */
  readonly whenLabel: string
  /** Contact (phone) the lookup was performed with (echoed for the confirmation line). */
  readonly contact: string
}

/** Result of looking up a booking by contact (phone). */
export type CancelLookupResult =
  | { readonly ok: true; readonly booking: CancelBooking }
  | { readonly ok: false; readonly error: string }

/** Result of cancelling a looked-up booking. */
export type CancelResult =
  | { readonly ok: true; readonly booking: CancelBooking }
  | { readonly ok: false; readonly error: string }
