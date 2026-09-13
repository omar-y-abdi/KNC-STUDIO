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

export interface CustomerProfile {
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly emails?: readonly string[]
  readonly phones?: readonly string[]
}

export type CustomerEmailLinkResult =
  | { readonly ok: true; readonly status: 'queued' | 'already_linked' | 'waiting' | 'linked' }
  | {
      readonly ok: false
      readonly error: 'access_denied' | 'invalid' | 'stale' | 'rate_limited' | 'system'
    }

/**
 * Result of listing email-scoped customer bookings.
 */
export type MyBookingsResult =
  | {
      readonly ok: true
      readonly authority: 'verified'
      readonly bookings: MyBookings
      readonly profile: CustomerProfile
    }
  | {
      readonly ok: true
      readonly authority: 'device'
      readonly bookings: MyBookings
      readonly profile?: never
    }
  | { readonly ok: false; readonly error: 'access_denied' | 'cookies_disabled' | 'system' }

/** Result of cancelling one upcoming booking. */
export type MyCancelResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: 'access_denied' | 'not_found' | 'system' }
