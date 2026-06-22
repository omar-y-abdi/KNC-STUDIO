// The "backend-ready" seam for reviews. A `ReviewsPort` lists the existing reviews and submits a
// new one, returning the stored `Review` (with a server-assigned id). The About section depends on
// this interface only; today the one concrete implementation is `mockReviewsAdapter` (no network,
// nothing persisted). A future backend implements the same interface — intentionally not stubbed.

import type { Review, ReviewResult, ValidReview } from './domain'

export interface ReviewsPort {
  /** The reviews to show on first render (seed/placeholder data for the mock). */
  list(): Promise<readonly Review[]>
  /** Submit a validated review; resolves with the stored item (or a domain error). */
  submit(review: ValidReview): Promise<ReviewResult>
}
