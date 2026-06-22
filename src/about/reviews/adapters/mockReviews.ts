// The ONE real ReviewsPort adapter: no network, NOTHING PERSISTED.
//
//  - `list()` returns a small set of ON-BRAND PLACEHOLDER reviews (a customer's words aren't
//    translated, so these are plain data, not i18n strings — swap them for real reviews, or have a
//    future backend adapter fetch them).
//  - `submit()` assigns a client-side id and resolves `ok`, echoing the stored review so the UI can
//    prepend it to the list. The new review lives ONLY in the page's React state for this session;
//    a reload clears it. A future networked adapter would POST and return the persisted row.
//
// Effects (id generation) live here at the edge; the generated id is monotonic + unique within the
// session via a module counter (no `Date.now()` collisions, deterministic enough for keys).

import type { Review, ReviewResult, ValidReview } from '../domain'
import type { ReviewsPort } from '../port'

/** Placeholder seed reviews shown on first render. Plain data (a review is the customer's words). */
const SEED_REVIEWS: readonly Review[] = [
  {
    id: 'seed-1',
    name: 'Johan A.',
    rating: 5,
    text: 'Bästa fadern jag fått i Göteborg. Lugn lokal, ingen stress och resultatet sitter perfekt. Återkommer varje gång.',
  },
  {
    id: 'seed-2',
    name: 'Emir K.',
    rating: 5,
    text: 'Skägget har aldrig sett bättre ut. Kunnig barberare som lyssnar på vad man vill ha. Rekommenderas starkt.',
  },
  {
    id: 'seed-3',
    name: 'Daniel M.',
    rating: 4,
    text: 'Riktigt bra klippning och trevligt bemötande. Lite väntetid men helt klart värt det.',
  },
]

/** Session-unique id counter for newly submitted reviews (effect, isolated to this edge). */
let nextId = 0
function makeReviewId(): string {
  nextId += 1
  return `review-${nextId}`
}

/**
 * Local-only ReviewsPort: lists the placeholder seeds and always accepts a submission, echoing the
 * stored review with a fresh id. Resolves through Promises so a future async backend is a drop-in
 * swap with no caller changes.
 */
export const mockReviewsAdapter: ReviewsPort = {
  list(): Promise<readonly Review[]> {
    return Promise.resolve(SEED_REVIEWS)
  },
  submit(review: ValidReview): Promise<ReviewResult> {
    const stored: Review = {
      id: makeReviewId(),
      name: review.name,
      rating: review.rating,
      text: review.text,
    }
    return Promise.resolve({ ok: true, review: stored })
  },
}
