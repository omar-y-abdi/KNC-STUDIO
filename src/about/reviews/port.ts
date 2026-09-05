// The reviews seam. A `ReviewsPort` lists the existing reviews and submits a new one, returning
// the stored `Review` (with a server-assigned id). The About section depends on this interface
// only; the concrete implementations are `mockReviewsAdapter` (empty, no network) and
// `supabaseReviewsAdapter` (the real backend).

import type { Review, ReviewResult, ValidReview } from './domain'

export interface ReviewsPort {
  /** The reviews to show on first render (seed/placeholder data for the mock). */
  list(): Promise<readonly Review[]>
  /** Submit a validated review; resolves with the stored item (or a domain error). */
  submit(
    review: ValidReview,
    turnstileToken: string,
    /** Optional non-browser transport override used by integration adapters; browsers use HttpOnly cookie. */
    accessToken?: string,
  ): Promise<ReviewResult>
}
