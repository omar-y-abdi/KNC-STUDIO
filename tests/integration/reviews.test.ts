// Reviews adapter ↔ live stack. Review writes require the short-lived customer-access session that
// proves possession of the booking email, and the submitted phone must match that session's scope.
// The tests seed the server-side session directly, then drive the real browser adapter + Edge gateway.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supabaseReviewsAdapter } from '../../src/about/reviews/adapters/supabaseReviews'
import type { Phone } from '../../src/booking/validation'
import { rememberCustomerAccessToken } from '../../src/mybookings/customerAccessSession'
import {
  backendReady,
  readStackEnv,
  TURNSTILE_TEST_TOKEN,
  truncateAll,
  uniquePhone,
  uniqueReviewMarker,
} from './_helpers'
import {
  memorySessionStorage,
  seedCustomerAccessSession,
  seedReviewableBooking,
} from './reviewAccessHelpers'

async function authorizeReview(dbUrl: string, phone: string, email: string): Promise<void> {
  const accessToken = await seedCustomerAccessSession(dbUrl, { phone, email })
  rememberCustomerAccessToken(accessToken)
}

describe.skipIf(!backendReady())('supabaseReviewsAdapter (integration)', () => {
  beforeEach(async () => {
    vi.stubGlobal('sessionStorage', memorySessionStorage())
    const env = readStackEnv()
    if (env) await truncateAll(env.dbUrl)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('an email-authorized finished booking publishes once with the server-derived name', async () => {
    const env = readStackEnv()
    if (!env) return

    const phone = uniquePhone()
    const email = `anna-${uniqueReviewMarker()}@example.test`
    await seedReviewableBooking(env.dbUrl, {
      phone,
      email,
      customerName: 'Anna Andersson',
    })
    await authorizeReview(env.dbUrl, phone, email)

    const marker = uniqueReviewMarker()
    const submitted = await supabaseReviewsAdapter.submit(
      {
        phone: phone as Phone,
        rating: 5,
        text: `Great cut — ${marker}`,
      },
      TURNSTILE_TEST_TOKEN,
    )
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    expect(submitted.review.name).toBe('Anna A.')
    expect(submitted.review.rating).toBe(5)

    const list = await supabaseReviewsAdapter.list()
    const found = list.find((review) => review.id === submitted.review.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe('Anna A.')

    const second = await supabaseReviewsAdapter.submit(
      {
        phone: phone as Phone,
        rating: 4,
        text: `again — ${marker}`,
      },
      TURNSTILE_TEST_TOKEN,
    )
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe('no_booking')
  })

  it('a valid customer session without a finished matching booking → no_booking', async () => {
    const env = readStackEnv()
    if (!env) return

    const phone = uniquePhone()
    const email = `none-${uniqueReviewMarker()}@example.test`
    await authorizeReview(env.dbUrl, phone, email)

    const result = await supabaseReviewsAdapter.submit(
      {
        phone: phone as Phone,
        rating: 5,
        text: 'No booking, no review.',
      },
      TURNSTILE_TEST_TOKEN,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('no_booking')
  })

  it('list() returns email-authorized reviews newest-first', async () => {
    const env = readStackEnv()
    if (!env) return

    const olderPhone = uniquePhone()
    const newerPhone = uniquePhone()
    const olderEmail = `older-${uniqueReviewMarker()}@example.test`
    const newerEmail = `newer-${uniqueReviewMarker()}@example.test`
    await seedReviewableBooking(env.dbUrl, {
      phone: olderPhone,
      email: olderEmail,
      customerName: 'Olle Olsson',
    })
    await seedReviewableBooking(env.dbUrl, {
      phone: newerPhone,
      email: newerEmail,
      customerName: 'Nina Nilsson',
    })

    await authorizeReview(env.dbUrl, olderPhone, olderEmail)
    const first = await supabaseReviewsAdapter.submit(
      { phone: olderPhone as Phone, rating: 4, text: 'old' },
      TURNSTILE_TEST_TOKEN,
    )

    await authorizeReview(env.dbUrl, newerPhone, newerEmail)
    const second = await supabaseReviewsAdapter.submit(
      { phone: newerPhone as Phone, rating: 5, text: 'new' },
      TURNSTILE_TEST_TOKEN,
    )
    expect(first.ok && second.ok).toBe(true)

    const list = await supabaseReviewsAdapter.list()
    expect(list).toHaveLength(2)
    expect(list[0]?.name).toBe('Nina N.')
    expect(list[1]?.name).toBe('Olle O.')
  })
})
