import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('retired Calendar deployment', () => {
  // Deployment manifests and entrypoint absence cannot be proved by invoking a current handler.
  it('has no legacy webhook entrypoint or deployment configuration', () => {
    expect(existsSync('supabase/functions/calendar-sync')).toBe(false)
    const config = readFileSync('supabase/config.toml', 'utf8')
    expect(config).not.toMatch(/^\[functions\.calendar-sync\]$/m)
  })
})
