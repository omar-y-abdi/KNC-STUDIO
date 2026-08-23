// Domain ADTs for the "Mina bokningar" (My appointments) self-service flow. The dialog receives
// pre-formatted rows and only renders the customer history issued to its email-scoped session.

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
 * Result of listing email-scoped customer bookings.
 */
export type MyBookingsResult =
  | { readonly ok: true; readonly bookings: MyBookings }
  | { readonly ok: false; readonly error: 'access_denied' | 'system' }

/** Result of cancelling one upcoming booking. */
export type MyCancelResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: 'access_denied' | 'not_found' | 'system' }
