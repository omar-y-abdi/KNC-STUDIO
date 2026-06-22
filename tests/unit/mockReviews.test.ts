import { describe, it, expect } from 'vitest'
import { mockReviewsAdapter } from '../../src/about/reviews/adapters/mockReviews'

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

  it('submit() resolves ok, echoes the review, and assigns a fresh unique id', async () => {
    const a = await mockReviewsAdapter.submit({ name: 'Omar', rating: 5, text: 'Top fade.' })
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.review.name).toBe('Omar')
      expect(a.review.rating).toBe(5)
      expect(a.review.text).toBe('Top fade.')
      expect(a.review.id.length).toBeGreaterThan(0)
    }
    const b = await mockReviewsAdapter.submit({ name: 'Eve', rating: 4, text: 'Clean lines.' })
    if (a.ok && b.ok) expect(a.review.id).not.toBe(b.review.id)
  })
})
