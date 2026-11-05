// Domain ADTs for the About-section reviews. Mirrors the booking domain's shape: branded-ish
// closed types, `null` for "not yet chosen", and a Result union for the port. A `Review` is an
// already-published item shown in the list; a `ReviewDraft` is the raw, unvalidated form state.
// The reviewer proves a finished booking by PHONE; the displayed name is derived server-side.

import type { Phone } from '../../booking/validation'

/** A star rating, constrained to the 1..5 the UI can produce. */
export type Rating = 1 | 2 | 3 | 4 | 5

/** The closed set of valid ratings (used to render + iterate the star selector). */
export const RATINGS: readonly Rating[] = [1, 2, 3, 4, 5]

/** A published review shown in the list. `id` is stable so list keys never collide. */
export interface Review {
  readonly id: string
  readonly name: string
  readonly rating: Rating
  readonly text: string
}

/** Raw review-form state (unvalidated — mirrors the booking `ContactForm`). `rating` is `null`
 *  until the customer picks a star. The reviewer enters the PHONE they booked with. */
export interface ReviewDraft {
  readonly phone: string
  readonly rating: Rating | null
  readonly text: string
}

/** The pristine review draft. */
export const emptyReviewDraft: ReviewDraft = { phone: '', rating: null, text: '' }

/** A validated review ready to submit — phone validated, rating chosen, text within bounds. The
 *  published name comes back from the server (derived from the matched booking). */
export interface ValidReview {
  readonly phone: Phone
  readonly rating: Rating
  readonly text: string
}

/**
 * Domain error for submitting a review. `invalid` = the server rejected the shape; `no_booking` =
 * the phone has no finished, not-yet-reviewed confirmed booking (the review gate — one review per
 * finished haircut); `challenge` / `rate_limited` = gateway controls; `submit` = transport or
 * unexpected failure.
 */
export interface ReviewError {
  readonly kind: 'invalid' | 'no_booking' | 'challenge' | 'rate_limited' | 'submit' | 'unavailable'
  readonly message: string
}

/**
 * Result of submitting a review through a `ReviewsPort`. On success the port echoes the stored
 * `Review` (with its server-assigned id) so the caller can prepend it to the list.
 */
export type ReviewResult =
  | { readonly ok: true; readonly review: Review }
  | { readonly ok: false; readonly error: ReviewError }
