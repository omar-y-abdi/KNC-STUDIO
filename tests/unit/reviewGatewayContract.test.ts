import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokePublicBookingAction } = vi.hoisted(() => ({
  invokePublicBookingAction: vi.fn(),
}))

vi.mock('../../src/backend/publicBookingActions', () => ({ invokePublicBookingAction }))
vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => ({ data: [], error: null }) }),
      }),
    }),
  }),
}))

import { createReviewResponse } from '../../src/backend/rpcSchemas'
import { supabaseReviewsAdapter } from '../../src/about/reviews/adapters/supabaseReviews'
import type { ValidReview } from '../../src/about/reviews/domain'

const review: ValidReview = { phone: '0701234567', rating: 5, text: 'Bra.' }

describe('review gateway response contract', () => {
  beforeEach(() => invokePublicBookingAction.mockReset())

  it.each([
    ['invalid', 'invalid'],
    ['no_booking', 'no_booking'],
    ['failed_challenge', 'challenge'],
    ['rate_limited', 'rate_limited'],
    ['system', 'submit'],
  ] as const)('accepts and maps %s intentionally', async (wireError, domainKind) => {
    const wire = { ok: false, error: wireError }
    expect(createReviewResponse.safeParse(wire).success).toBe(true)
    invokePublicBookingAction.mockResolvedValue({ data: wire, failed: false })

    const result = await supabaseReviewsAdapter.submit(review, 'challenge-token')

    expect(invokePublicBookingAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'review' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe(domainKind)
  })

  it('maps malformed and transport responses to submit', async () => {
    invokePublicBookingAction.mockResolvedValueOnce({
      data: { ok: false, error: 'unknown' },
      failed: false,
    })
    const malformed = await supabaseReviewsAdapter.submit(review, 'challenge-token')
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) expect(malformed.error.kind).toBe('submit')

    invokePublicBookingAction.mockResolvedValueOnce({ data: null, failed: true })
    const transport = await supabaseReviewsAdapter.submit(review, 'challenge-token')
    expect(transport.ok).toBe(false)
    if (!transport.ok) expect(transport.error.kind).toBe('submit')
  })
})
