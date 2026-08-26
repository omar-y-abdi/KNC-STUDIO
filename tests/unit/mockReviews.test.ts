import { describe, it, expect } from 'vitest'
import { mockReviewsAdapter } from '../../src/about/reviews/adapters/mockReviews'
import type { Phone } from '../../src/booking/validation'
describe('mockReviewsAdapter', () => {
  it('lists no testimonials because the local fallback has no published-review authority', async () => {
    const list = await mockReviewsAdapter.list()
    expect(list).toEqual([])
  })

  it('never fabricates a successful customer review', async () => {
    const result = await mockReviewsAdapter.submit({
      phone: '0701234567' as Phone,
      rating: 5,
      text: 'Top fade.',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('unavailable')
  })
})
