// The real (Supabase) ReviewsPort adapter. `list` reads PUBLISHED reviews directly (allowed by the
// `reviews_select_published` RLS policy) newest-first; `submit` goes through the protected public
// action Edge gateway (the only browser write path — direct insert/RPC access is denied to anon).
//
// Boundary discipline: every row / RPC response is Zod-parsed. A malformed review row is DROPPED
// (rather than crashing the list); a submit failure (transport / malformed / `{ok:false}`) maps to
// a `ReviewError`. The rating is guarded into the 1..5 `Rating` union by the schema.

import { getSupabase } from '../../../backend/supabaseClient'
import { invokePublicBookingAction } from '../../../backend/publicBookingActions'
import { createReviewResponse, parseWith, reviewRow } from '../../../backend/rpcSchemas'
import type { Review, ReviewError, ReviewResult, ValidReview } from '../domain'
import type { ReviewsPort } from '../port'

/** Friendly submit-error message (the form maps the kind to its own localized note, but keep it human). */
const SUBMIT_ERROR_MESSAGE = 'Kunde inte skicka recensionen. Försök igen.'
/** No finished, not-yet-reviewed booking matches the phone — the review gate. */
const NO_BOOKING_MESSAGE = 'Vi hittade ingen avslutad bokning för det numret.'
/** The server rejected the review shape (phone / rating / text). */
const INVALID_MESSAGE = 'Recensionen kunde inte valideras.'
const CHALLENGE_MESSAGE = 'Verifieringen misslyckades. Försök igen.'
const RATE_LIMITED_MESSAGE = 'För många försök. Vänta en stund och försök igen.'

function reviewError(kind: ReviewError['kind'], message: string): ReviewResult {
  return { ok: false, error: { kind, message } }
}

export const supabaseReviewsAdapter: ReviewsPort = {
  async list(): Promise<readonly Review[]> {
    try {
      const { data, error } = await getSupabase()
        .from('reviews')
        .select('id,name,rating,text')
        .eq('published', true)
        .order('created_at', { ascending: false })
      if (error !== null || data === null) return []

      // Drop any malformed row (guarding rating into 1..5) rather than failing the whole list.
      const reviews: Review[] = []
      for (const raw of data) {
        const parsed = parseWith(reviewRow, raw)
        if (parsed.ok) reviews.push(parsed.value)
      }
      return reviews
    } catch {
      return []
    }
  },

  async submit(review: ValidReview, turnstileToken: string): Promise<ReviewResult> {
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'review',
        phone: review.phone,
        rating: review.rating,
        text: review.text,
        turnstileToken,
      })
      if (failed) return reviewError('submit', SUBMIT_ERROR_MESSAGE)

      const parsed = parseWith(createReviewResponse, data)
      if (!parsed.ok) return reviewError('submit', SUBMIT_ERROR_MESSAGE)
      if (!parsed.value.ok) {
        switch (parsed.value.error) {
          case 'no_booking':
            return reviewError('no_booking', NO_BOOKING_MESSAGE)
          case 'invalid':
            return reviewError('invalid', INVALID_MESSAGE)
          case 'failed_challenge':
            return reviewError('challenge', CHALLENGE_MESSAGE)
          case 'rate_limited':
            return reviewError('rate_limited', RATE_LIMITED_MESSAGE)
        }
      }
      return { ok: true, review: parsed.value.review }
    } catch {
      return reviewError('submit', SUBMIT_ERROR_MESSAGE)
    }
  },
}
