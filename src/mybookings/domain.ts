// Domain ADTs for the "Mina bokningar" (My appointments) self-service flow. Mirrors the cancellation
// domain's shape — branded-ish Result unions, a pre-formatted display label so the dialog stays
// presentation-only — but returns the customer's FULL confirmed history split into upcoming/past
// rather than a single appointment.

import type { Barber } from '../booking/domain'

/** A single appointment in a customer's history — everything one dialog row renders. */
export interface MyBooking {
  readonly id: string
  readonly barber: Barber
  readonly serviceName: string
  readonly price: number
  readonly durationMin: number
  /** Local appointment start (salon wall-clock). Kept raw for the upcoming/past split. */
  readonly start: Date
  /** Localised "Weekday D Month kl HH:MM" row label, built by the adapter. */
  readonly whenLabel: string
}

/** A customer's confirmed bookings, pre-split for the two dialog sections. */
export interface MyBookings {
  /** Soonest first — the always-visible upcoming section. */
  readonly upcoming: readonly MyBooking[]
  /** Most recent first — the collapsible past section. */
  readonly past: readonly MyBooking[]
}

/**
 * Result of listing a phone's bookings.
 *  - `not_found`: the phone has no confirmed bookings (unknown/never-booked number).
 *  - `system`: a network/parse failure (distinct from not_found so the dialog can message + retry
 *    without the "contact the salon" escalation, which is reserved for a genuinely unknown number).
 */
export type MyBookingsResult =
  | { readonly ok: true; readonly bookings: MyBookings }
  | {
      readonly ok: false
      readonly error: 'not_found' | 'failed_challenge' | 'rate_limited' | 'system'
    }

/** Result of cancelling one upcoming booking. */
export type MyCancelResult =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false
      readonly error: 'not_found' | 'failed_challenge' | 'rate_limited' | 'system'
    }
