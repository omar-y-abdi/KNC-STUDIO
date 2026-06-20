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

/** Closed set of barber ids (the only valid `barberId` values). */
export type BarberId = 'hassan' | 'victor' | 'salman'

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

/** The confirmation channel the customer picks (source `confirmMethod`). */
export type ConfirmMethod = 'sms' | 'email'

/** The customer-entered contact form (raw, unvalidated — mirrors source `state.form`). */
export interface ContactForm {
  readonly name: string
  readonly phone: string
  readonly email: string
}

/** Empty contact form (source initial `form`). */
export const emptyContactForm: ContactForm = { name: '', phone: '', email: '' }

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
  readonly confirmMethod: ConfirmMethod | null
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
  confirmMethod: null,
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
  readonly confirmMethod: ConfirmMethod
  readonly customerName: string
  readonly phone: string
  readonly email: string
  readonly lang: Lang
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
