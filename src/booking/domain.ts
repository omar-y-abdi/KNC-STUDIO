// Domain ADTs for the booking flow. These describe exactly the states the flow produces (no new
// invariants that would alter its setState-merge / reset state machine). Branded primitives +
// closed unions keep invalid states unrepresentable at the boundaries.

import type { Lang } from '../i18n/index'

/** A barber, with their Instagram handle. */
export interface Barber {
  readonly id: BarberId
  readonly name: string
  readonly ig: string
}

/**
 * A barber id. Originally a closed union (`'hassan' | 'victor' | 'salman'`); now an OPEN branded
 * string so an owner-added DB barber (any id matching `^[a-z0-9-]+$`) is a valid value, while the
 * The brand is purely nominal — it erases to `string` at runtime and carries no cost — yet it
 * keeps a `barberId` from being confused with an arbitrary string: a raw string is narrowed to a
 * `BarberId` only at the boundaries (the seed constants, the DB-row mapper, the `BookingDraft`'s own
 * state), never implicitly.
 */
export type BarberId = string & { readonly __brand: 'BarberId' }

/** Narrow a raw DB `barbers.id` into a `BarberId` at the boundary. */
export function asBarberId(raw: string): BarberId {
  return raw as BarberId
}

/** A single bookable service line. */
export interface ServiceItem {
  readonly id: string
  readonly name: string
  readonly price: number
  readonly dur: number
}

/** A titled group of services with an optional note. */
export interface ServiceGroup {
  readonly title: string
  readonly note: string
  readonly items: readonly ServiceItem[]
}

/** Customer-entered contact form (raw, unvalidated). Phone identifies bookings in self-service;
 * email receives transactional confirmation. */
export interface ContactForm {
  readonly name: string
  readonly phone: string
  readonly email: string
}

/** Empty contact form. */
export const emptyContactForm: ContactForm = { name: '', phone: '', email: '' }

/**
 * The full mutable-by-replacement booking draft — the `BookingFlow` `state` object.
 * `null` means "not yet chosen".
 */
export interface BookingDraft {
  readonly lang: Lang | null
  readonly monthOffset: number
  readonly barberId: BarberId | null
  readonly dateIso: string | null
  readonly time: string | null
  readonly service: ServiceItem | null
  readonly showPopup: boolean
  readonly booked: boolean
  readonly form: ContactForm
}

/** The pristine draft (initial `useState` value). */
export const initialDraft: BookingDraft = {
  lang: null,
  monthOffset: 0,
  barberId: null,
  dateIso: null,
  time: null,
  service: null,
  showPopup: false,
  booked: false,
  form: emptyContactForm,
}

/**
 * A fully specified, validated booking — every field present. Produced only after the
 * customer has chosen a barber, date, time and service, and contact details validate.
 */
export interface Booking {
  readonly barber: Barber
  readonly service: ServiceItem
  /** Local appointment start. */
  readonly start: Date
  /** Local appointment end (start + service duration). */
  readonly end: Date
  readonly customerName: string
  readonly phone: string
  readonly email: string
  readonly lang: Lang
  /** Cloudflare Turnstile token, proving the submitter is human, attached at submit time. Empty in
   * local mock mode; production gateway rejects empty tokens and missing server configuration. */
  readonly turnstileToken: string
}

/** Calendar / map links derived from a confirmed booking (produced by a `BookingPort`). */
export interface BookingLinks {
  /** `data:text/calendar` URL holding the RFC5545 .ics payload. */
  readonly icsHref: string
  /** Google Calendar "render template" URL. */
  readonly gcalHref: string
  /** Apple/`maps.apple.com` directions URL. */
  readonly mapsHref: string
}

/** Domain error union for a booking submission. */
export type BookingError =
  | { readonly kind: 'validation'; readonly message: string }
  | { readonly kind: 'submit'; readonly message: string }

/** Result of submitting a booking through a `BookingPort`. */
export type BookingResult =
  | { readonly ok: true; readonly booking: Booking; readonly links: BookingLinks }
  | { readonly ok: false; readonly error: BookingError }
