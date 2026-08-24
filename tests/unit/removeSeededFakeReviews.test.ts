import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260824080527_remove_seeded_fake_reviews.sql',
  'utf8',
)

describe('seeded testimonial removal migration', () => {
  it('targets only the three known unlinked, published seed rows', () => {
    expect(migration).toContain('delete from public.reviews')
    expect(migration).toContain('where published is true')
    expect(migration).toContain('and booking_id is null')
    expect(migration).toContain("'Johan A.'")
    expect(migration).toContain("'Emir K.'")
    expect(migration).toContain("'Daniel M.'")
  })
})
