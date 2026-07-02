// Domain ADTs for the booking flow. These describe exactly the states the source already
// produces (no new invariants that would alter its setState-merge / reset state machine).
// Branded primitives + closed unions keep invalid states unrepresentable at the boundaries.

import type { Lang } from '../i18n/index'

/** A barber, with their Instagram handle (source `BF_BARBERS`). */
export interface Barber {
  readonly id: BarberId
  readonly name: string
  readonly ig: string
}

/**
 * A barber id. Originally a closed union (`'hassan' | 'victor' | 'salman'`); now an OPEN branded
 * string so an owner-added DB barber (any id matching `^[a-z0-9-]+$`) is a valid value, while the
 * `BARBERS` constant + `barberIndex` keep working as the offline fallback (ADMIN_SPEC
 * §5). The brand is purely nominal — it erases to `string` at runtime and carries no cost — yet it
 * keeps a `barberId` from being confused with an arbitrary string: a raw string is narrowed to a
 * `BarberId` only at the boundaries (the seed constants, the DB-row mapper, the `BookingDraft`'s own
 * state), never implicitly.
 */
export type BarberId = string & { readonly __brand: 'BarberId' }

/** Narrow a raw string (a seed id or a DB `barbers.id`) into a `BarberId` at the boundary. */
export function asBarberId(raw: string): BarberId {
  return raw as BarberId
}

/** A single bookable service line (source pricing item). */
export interface ServiceItem {
  readonly id: string
  readonly name: string
  readonly price: number
  readonly dur: number
}

/** A titled group of services with an optional note (source pricing group). */
export interface ServiceGroup {
  readonly title: string
  readonly note: string
  readonly items: readonly ServiceItem[]
}

/** The customer-entered contact form (raw, unvalidated). Email was removed — every booking is
 * confirmed over SMS, so the only contact is the phone. */
export interface ContactForm {
  readonly name: string
  readonly phone: string
}

/** Empty contact form (source initial `form`). */
export const emptyContactForm: ContactForm = { name: '', phone: '' }

/**
 * The full mutable-by-replacement booking draft — a 1:1 model of the source `BookingFlow`
 * `state` object. `null` means "not yet chosen", exactly as in the source.
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

/** The pristine draft (source initial `useState`). */
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
  readonly lang: Lang
  /** Cloudflare Turnstile token, proving the submitter is human, attached at submit time. Empty
   * when the widget is unconfigured/offline (the gateway fails open on a missing secret). */
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
