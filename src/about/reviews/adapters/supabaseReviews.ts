// The real (Supabase) ReviewsPort adapter. `list` reads PUBLISHED reviews directly (allowed by the
// `reviews_select_published` RLS policy) newest-first; `submit` goes through the `create_review`
// SECURITY DEFINER RPC (the only write path — direct insert is denied to anon).
//
// Boundary discipline: every row / RPC response is Zod-parsed. A malformed review row is DROPPED
// (rather than crashing the list); a submit failure (transport / malformed / `{ok:false}`) maps to
// a `ReviewError`. The rating is guarded into the 1..5 `Rating` union by the schema.

import { getSupabase } from '../../../backend/supabaseClient'
import { createReviewResponse, parseWith, reviewRow } from '../../../backend/rpcSchemas'
import type { Review, ReviewError, ReviewResult, ValidReview } from '../domain'
import type { ReviewsPort } from '../port'

/** Friendly submit-error message (the form maps the kind to its own localized note, but keep it human). */
const SUBMIT_ERROR_MESSAGE = 'Kunde inte skicka recensionen. Försök igen.'
/** No finished, not-yet-reviewed booking matches the phone — the review gate. */
const NO_BOOKING_MESSAGE = 'Vi hittade ingen avslutad bokning för det numret.'
/** The server rejected the review shape (phone / rating / text). */
const INVALID_MESSAGE = 'Recensionen kunde inte valideras.'

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

  async submit(review: ValidReview): Promise<ReviewResult> {
    try {
      const { data, error } = await getSupabase().rpc('create_review', {
        p_phone: review.phone,
        p_rating: review.rating,
        p_text: review.text,
      })
      if (error !== null) return reviewError('submit', SUBMIT_ERROR_MESSAGE)

      const parsed = parseWith(createReviewResponse, data)
      if (!parsed.ok) return reviewError('submit', SUBMIT_ERROR_MESSAGE)
      if (!parsed.value.ok) {
        // Map the server's gate outcome to a domain error the form can localize.
        return parsed.value.error === 'no_booking'
          ? reviewError('no_booking', NO_BOOKING_MESSAGE)
          : reviewError('invalid', INVALID_MESSAGE)
      }
      return { ok: true, review: parsed.value.review }
    } catch {
      return reviewError('submit', SUBMIT_ERROR_MESSAGE)
    }
  },
}
