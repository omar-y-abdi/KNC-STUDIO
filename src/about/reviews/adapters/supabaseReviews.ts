// The real (Supabase) ReviewsPort adapter. `list` reads PUBLISHED reviews directly (allowed by the
// `reviews_select_published` RLS policy) newest-first; `submit` goes through the `create_review`
// SECURITY DEFINER RPC (the only write path — direct insert is denied to anon).
//
// Boundary discipline: every row / RPC response is Zod-parsed. A malformed review row is DROPPED
// (rather than crashing the list); a submit failure (transport / malformed / `{ok:false}`) maps to
// a `ReviewError`. The rating is guarded into the 1..5 `Rating` union by the schema.

import { getSupabase } from '../../../backend/supabaseClient'
import { createReviewResponse, parseWith, reviewRow } from '../../../backend/rpcSchemas'
import type { Review, ReviewResult, ValidReview } from '../domain'
import type { ReviewsPort } from '../port'

/** Friendly submit-error message (the form only surfaces a generic failure, but keep it human). */
const SUBMIT_ERROR_MESSAGE = 'Kunde inte skicka recensionen. Försök igen.'

function submitError(): ReviewResult {
  return { ok: false, error: { kind: 'submit', message: SUBMIT_ERROR_MESSAGE } }
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
        p_name: review.name,
        p_rating: review.rating,
        p_text: review.text,
      })
      if (error !== null) return submitError()

      const parsed = parseWith(createReviewResponse, data)
      if (!parsed.ok || !parsed.value.ok) return submitError()
      return { ok: true, review: parsed.value.review }
    } catch {
      return submitError()
    }
  },
}
