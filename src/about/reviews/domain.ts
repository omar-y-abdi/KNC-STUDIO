// Domain ADTs for the About-section reviews. Mirrors the booking domain's shape: branded-ish
// closed types, `null` for "not yet chosen", and a Result union for the port. A `Review` is an
// already-published item shown in the list; a `ReviewDraft` is the raw, unvalidated form state.

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
 *  until the customer picks a star. */
export interface ReviewDraft {
  readonly name: string
  readonly rating: Rating | null
  readonly text: string
}

/** The pristine review draft. */
export const emptyReviewDraft: ReviewDraft = { name: '', rating: null, text: '' }

/** A validated review ready to publish — every field present and within bounds. */
export interface ValidReview {
  readonly name: string
  readonly rating: Rating
  readonly text: string
}

/** Domain error for submitting a review (single kind today; a future backend may add more). */
export interface ReviewError {
  readonly kind: 'submit'
  readonly message: string
}

/**
 * Result of submitting a review through a `ReviewsPort`. On success the port echoes the stored
 * `Review` (with its server-assigned id) so the caller can prepend it to the list.
 */
export type ReviewResult =
  | { readonly ok: true; readonly review: Review }
  | { readonly ok: false; readonly error: ReviewError }
