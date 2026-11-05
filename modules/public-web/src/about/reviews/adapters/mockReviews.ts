// Offline review fallback: never invent customer testimony. Published customer reviews require the
// configured database, and local development has no authority to simulate a successful submission.

import type { ReviewResult } from '../domain'
import type { ReviewsPort } from '../port'

export const mockReviewsAdapter: ReviewsPort = {
  list(): Promise<readonly []> {
    return Promise.resolve([])
  },
  submit(): Promise<ReviewResult> {
    return Promise.resolve({
      ok: false,
      error: { kind: 'unavailable', message: 'Reviews require the configured booking service.' },
    })
  },
}
