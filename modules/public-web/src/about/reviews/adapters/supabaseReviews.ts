// The real (Supabase) ReviewsPort adapter. Published reviews remain directly readable; review writes
// go through the protected public action gateway. The server authorizes a review through the same
// device receipt or verified session as My Bookings; phone is a cross-check, not an authorization
// secret. Browser requests carry the existing HttpOnly cookies through same-origin credentials.

import { getPublicRest } from '../../../backend/publicRest'
import { invokePublicBookingAction } from '../../../backend/publicBookingActions'
import {
  createReviewResponse,
  parseWith,
  reviewRow,
} from '@bladeblend/backend-contracts/rpcSchemas'
import type { Review, ReviewError, ReviewResult, ValidReview } from '../domain'
import type { ReviewsPort } from '../port'

const SUBMIT_ERROR_MESSAGE = 'Kunde inte skicka recensionen. Försök igen.'
const NO_BOOKING_MESSAGE =
  'Vi kunde inte hitta en avslutad bokning som du kan lämna omdöme om. Kontrollera telefonnumret och bokningen i Mina bokningar.'
const INVALID_MESSAGE = 'Recensionen kunde inte valideras.'
const CHALLENGE_MESSAGE = 'Verifieringen misslyckades. Försök igen.'
const RATE_LIMITED_MESSAGE = 'För många försök. Vänta en stund och försök igen.'

function reviewError(kind: ReviewError['kind'], message: string): ReviewResult {
  return { ok: false, error: { kind, message } }
}

export const supabaseReviewsAdapter: ReviewsPort = {
  async list(): Promise<readonly Review[]> {
    try {
      const { data, error } = await getPublicRest()
        .from('reviews')
        .select('id,name,rating,text')
        .eq('published', true)
        .order('created_at', { ascending: false })
      if (error !== null || data === null) return []

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

  async submit(
    review: ValidReview,
    turnstileToken: string,
    accessToken?: string,
  ): Promise<ReviewResult> {
    try {
      const { data, failed } = await invokePublicBookingAction({
        action: 'review',
        phone: review.phone,
        ...(accessToken === undefined ? {} : { accessToken }),
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
          case 'system':
            return reviewError('submit', SUBMIT_ERROR_MESSAGE)
        }
      }
      return { ok: true, review: parsed.value.review }
    } catch {
      return reviewError('submit', SUBMIT_ERROR_MESSAGE)
    }
  },
}
