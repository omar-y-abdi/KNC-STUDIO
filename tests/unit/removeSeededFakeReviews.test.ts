import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const seed = readFileSync('supabase/seed.sql', 'utf8')

describe('seeded testimonials', () => {
  it('does not permit a local reset to recreate testimonials', () => {
    expect(seed).not.toMatch(/insert\s+into\s+public\.reviews/i)
  })
})
