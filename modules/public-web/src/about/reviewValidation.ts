// Boundary validation for the review form (plain functions + Result shape, mirroring
// booking/validation.ts). The phone parser is reused from the booking validation (same branded
// `Phone`, Swedish-mobile rule); the review text and rating get their own checks here. Per-field
// flags drive the same red-border + note UI. The phone is the review gate — a finished booking is
// proven by it.

import { parsePhone, type ValidationResult } from '../booking/validation'
import type { Rating, ValidReview } from './reviews/domain'

const MAX_TEXT = 600

/** Trimmed review text: at least one and at most `MAX_TEXT` UTF-16 code units. */
function parseReviewText(raw: string): ValidationResult<string> {
  const text = raw.trim()
  if (text.length < 1) return { ok: false, error: 'Review text is required' }
  if (text.length > MAX_TEXT) return { ok: false, error: 'Review text is too long' }
  return { ok: true, value: text }
}

/**
 * Per-field validity flags — `true` means that field FAILED validation. Drives the per-field red
 * note in the review form, exactly like the booking form's `FieldErrors`.
 */
export interface ReviewFieldErrors {
  readonly phone: boolean
  readonly rating: boolean
  readonly text: boolean
}

/** No fields flagged — the pristine form. */
export const NO_REVIEW_ERRORS: ReviewFieldErrors = { phone: false, rating: false, text: false }

/** Result of validating the whole review form. */
export type ReviewValidation =
  | { readonly ok: true; readonly value: ValidReview }
  | { readonly ok: false; readonly fields: ReviewFieldErrors }

/**
 * Validate the review form, reporting which field(s) failed. Phone is validated with the shared
 * booking phone parser (Swedish mobile); rating must be chosen; text must be non-empty and within
 * the length cap.
 */
export function parseReview(input: {
  phone: string
  rating: Rating | null
  text: string
}): ReviewValidation {
  const phone = parsePhone(input.phone)
  const rating = input.rating
  const text = parseReviewText(input.text)

  const fields: ReviewFieldErrors = {
    phone: !phone.ok,
    rating: rating === null,
    text: !text.ok,
  }
  if (fields.phone || fields.rating || fields.text) {
    return { ok: false, fields }
  }
  // All three guaranteed valid here; re-narrow for the type system (no `!`, no casts of unions).
  if (!phone.ok || rating === null || !text.ok) return { ok: false, fields }
  return { ok: true, value: { phone: phone.value, rating, text: text.value } }
}
