// The reviews-adapter swap point. Supabase when configured, the offline mock otherwise (chosen once
// at module load). With no `VITE_SUPABASE_*` set this is the mock (placeholder seeds, nothing
// persisted) — identical to today.
//
// The Supabase adapter is reached through a LAZY proxy (dynamic import on first call), so supabase-js
// lands in its own chunk — fetched only when the backend is configured and reviews load/submit.

import { isBackendConfigured } from '../../../backend/config'
import type { ValidReview } from '../domain'
import type { ReviewsPort } from '../port'
import { mockReviewsAdapter } from './mockReviews'

const lazySupabaseReviewsPort: ReviewsPort = {
  list: () => import('./supabaseReviews').then((m) => m.supabaseReviewsAdapter.list()),
  submit: (review: ValidReview, turnstileToken: string) =>
    import('./supabaseReviews').then((m) =>
      m.supabaseReviewsAdapter.submit(review, turnstileToken),
    ),
}

export const defaultReviewsPort: ReviewsPort = isBackendConfigured()
  ? lazySupabaseReviewsPort
  : mockReviewsAdapter
