// Reviews adapter ↔ live stack. Drives `supabaseReviewsAdapter`: a submitted review is persisted
// (published) and then appears in `list()` newest-first. Truncates before each test.

import { beforeEach, describe, expect, it } from 'vitest'
import { supabaseReviewsAdapter } from '../../src/about/reviews/adapters/supabaseReviews'
import { backendReady, readStackEnv, truncateAll, uniqueReviewMarker } from './_helpers'

describe.skipIf(!backendReady())('supabaseReviewsAdapter (integration)', () => {
  beforeEach(async () => {
    const env = readStackEnv()
    if (env) await truncateAll(env.dbUrl)
  })

  it('submit persists a published review that then appears in list()', async () => {
    const marker = uniqueReviewMarker()
    const submitted = await supabaseReviewsAdapter.submit({
      name: marker,
      rating: 5,
      text: `Great cut — ${marker}`,
    })
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return

    const list = await supabaseReviewsAdapter.list()
    const found = list.find((r) => r.id === submitted.review.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe(marker)
    expect(found?.rating).toBe(5)
  })

  it('list() returns reviews newest-first', async () => {
    const older = uniqueReviewMarker()
    const newer = uniqueReviewMarker()

    const first = await supabaseReviewsAdapter.submit({ name: older, rating: 4, text: `old ${older}` })
    const second = await supabaseReviewsAdapter.submit({ name: newer, rating: 5, text: `new ${newer}` })
    expect(first.ok && second.ok).toBe(true)

    const list = await supabaseReviewsAdapter.list()
    // Clean table → exactly the two we inserted; the later insert (newer created_at) is first.
    expect(list).toHaveLength(2)
    expect(list[0]?.name).toBe(newer)
    expect(list[1]?.name).toBe(older)
  })
})
