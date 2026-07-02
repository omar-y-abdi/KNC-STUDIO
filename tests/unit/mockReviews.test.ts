import { describe, it, expect } from 'vitest'
import { mockReviewsAdapter } from '../../src/about/reviews/adapters/mockReviews'
import type { Phone } from '../../src/booking/validation'

describe('mockReviewsAdapter', () => {
  it('lists a non-empty set of seed reviews with valid ratings', async () => {
    const list = await mockReviewsAdapter.list()
    expect(list.length).toBeGreaterThan(0)
    for (const r of list) {
      expect(r.id.length).toBeGreaterThan(0)
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.text.length).toBeGreaterThan(0)
      expect(r.rating).toBeGreaterThanOrEqual(1)
      expect(r.rating).toBeLessThanOrEqual(5)
    }
  })

  it('submit() resolves ok for an eligible phone, derives the name, and assigns a fresh unique id', async () => {
    // The demo phone has a finished booking → reviews as "Test T." (server-derived).
    const a = await mockReviewsAdapter.submit({
      phone: '0701234567' as Phone,
      rating: 5,
      text: 'Top fade.',
    })
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.review.name).toBe('Test T.')
      expect(a.review.rating).toBe(5)
      expect(a.review.text).toBe('Top fade.')
      expect(a.review.id.length).toBeGreaterThan(0)
    }
    const b = await mockReviewsAdapter.submit({
      phone: '0701234567' as Phone,
      rating: 4,
      text: 'Clean lines.',
    })
    if (a.ok && b.ok) expect(a.review.id).not.toBe(b.review.id)
  })

  it('submit() returns a no_booking error for a phone with no finished booking', async () => {
    const r = await mockReviewsAdapter.submit({
      phone: '0709999999' as Phone,
      rating: 5,
      text: 'Nice.',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('no_booking')
  })
})
