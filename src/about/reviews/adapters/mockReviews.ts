// The ONE real ReviewsPort adapter: no network, NOTHING PERSISTED.
//
//  - `list()` returns a small set of ON-BRAND PLACEHOLDER reviews (a customer's words aren't
//    translated, so these are plain data, not i18n strings — swap them for real reviews, or have a
//    future backend adapter fetch them).
//  - `submit()` SIMULATES the server-side review gate: only a phone with a finished booking can
//    review, and the displayed name is DERIVED from that booking ("Förnamn E."). A tiny phone→name
//    map stands in for the DB; an unknown phone resolves to a `no_booking` domain error, exactly
//    like the real gate. On success it assigns a client-side id and echoes the stored review so the
//    UI can prepend it. The new review lives ONLY in this session's React state; a reload clears it.
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
 * The offline stand-in for the review gate: phones with a "finished booking" mapped to the booking's
 * `customer_name`. The demo phone `0701234567` reviews as "Test T."; every other phone is treated as
 * having no finished booking. Keyed by the normalized phone (the `Phone` brand `parsePhone` yields).
 */
const FINISHED_BOOKINGS: Readonly<Record<string, string>> = {
  '0701234567': 'Test Testsson',
}

/** Derive the public reviewer name from a full booking name: "Förnamn Efternamn" → "Förnamn E." */
function derivedName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0] ?? fullName.trim()
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  const initial = last && last.length > 0 ? ` ${last[0]}.` : ''
  return `${first}${initial}`
}

/** No finished, not-yet-reviewed booking matches the phone (mirrors the real gate's `no_booking`). */
const NO_BOOKING_MESSAGE = 'Vi hittade ingen avslutad bokning för det numret.'

/**
 * Local-only ReviewsPort: lists the placeholder seeds and simulates the phone-gated submission,
 * echoing the stored review (with a server-derived name) on a match, or a `no_booking` error on a
 * miss. Resolves through Promises so a future async backend is a drop-in swap with no caller changes.
 */
export const mockReviewsAdapter: ReviewsPort = {
  list(): Promise<readonly Review[]> {
    return Promise.resolve(SEED_REVIEWS)
  },
  submit(review: ValidReview): Promise<ReviewResult> {
    const customerName = FINISHED_BOOKINGS[review.phone]
    if (customerName === undefined) {
      return Promise.resolve({
        ok: false,
        error: { kind: 'no_booking', message: NO_BOOKING_MESSAGE },
      })
    }
    const stored: Review = {
      id: makeReviewId(),
      name: derivedName(customerName),
      rating: review.rating,
      text: review.text,
    }
    return Promise.resolve({ ok: true, review: stored })
  },
}
