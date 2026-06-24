// Reviews adapter ↔ live stack. Reviews are now PHONE-GATED: a review may be left only by a phone
// with a FINISHED confirmed booking (end_at < now()), at most one per booking, and the shown name is
// DERIVED server-side from the booking's customer_name ("Anna Andersson" → "Anna A."). So each test
// seeds a finished booking directly (superuser), then drives `supabaseReviewsAdapter.submit` (the anon
// create_review RPC) and asserts the derived name + the one-review-per-booking gate. Truncates first.

import { beforeEach, describe, expect, it } from 'vitest'
import { supabaseReviewsAdapter } from '../../src/about/reviews/adapters/supabaseReviews'
import type { Phone } from '../../src/booking/validation'
import {
  backendReady,
  readStackEnv,
  seedFinishedBooking,
  truncateAll,
  uniquePhone,
  uniqueReviewMarker,
} from './_helpers'

describe.skipIf(!backendReady())('supabaseReviewsAdapter (integration)', () => {
  beforeEach(async () => {
    const env = readStackEnv()
    if (env) await truncateAll(env.dbUrl)
  })

  it('an eligible phone publishes a review with the server-derived name; a 2nd review → no_booking', async () => {
    const env = readStackEnv()
    if (!env) return

    const phone = uniquePhone()
    await seedFinishedBooking(env.dbUrl, { phone, customerName: 'Anna Andersson' })

    const marker = uniqueReviewMarker()
    const submitted = await supabaseReviewsAdapter.submit({
      phone: phone as Phone,
      rating: 5,
      text: `Great cut — ${marker}`,
    })
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    // Name is DERIVED from the booking, not supplied by the reviewer.
    expect(submitted.review.name).toBe('Anna A.')
    expect(submitted.review.rating).toBe(5)

    const list = await supabaseReviewsAdapter.list()
    const found = list.find((r) => r.id === submitted.review.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe('Anna A.')

    // The booking is now spent: a second review on the same finished booking is gated out.
    const second = await supabaseReviewsAdapter.submit({
      phone: phone as Phone,
      rating: 4,
      text: `again — ${marker}`,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe('no_booking')
  })

  it('a phone with no finished booking → no_booking', async () => {
    const env = readStackEnv()
    if (!env) return

    const result = await supabaseReviewsAdapter.submit({
      phone: uniquePhone() as Phone,
      rating: 5,
      text: 'No booking, no review.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('no_booking')
  })

  it('list() returns reviews newest-first', async () => {
    const env = readStackEnv()
    if (!env) return

    const olderPhone = uniquePhone()
    const newerPhone = uniquePhone()
    await seedFinishedBooking(env.dbUrl, { phone: olderPhone, customerName: 'Olle Olsson' })
    await seedFinishedBooking(env.dbUrl, { phone: newerPhone, customerName: 'Nina Nilsson' })

    const first = await supabaseReviewsAdapter.submit({ phone: olderPhone as Phone, rating: 4, text: 'old' })
    const second = await supabaseReviewsAdapter.submit({ phone: newerPhone as Phone, rating: 5, text: 'new' })
    expect(first.ok && second.ok).toBe(true)

    const list = await supabaseReviewsAdapter.list()
    // Clean table → exactly the two we inserted; the later insert (newer created_at) is first.
    expect(list).toHaveLength(2)
    expect(list[0]?.name).toBe('Nina N.')
    expect(list[1]?.name).toBe('Olle O.')
  })
})
