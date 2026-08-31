import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('handoff documentation contracts', () => {
  it('marks historical findings and avoids superseded deployment or test references', () => {
    const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    const findings = readFileSync(new URL('../../REVIEW_FINDINGS.md', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../../CODEBASE-MAP.md', import.meta.url), 'utf8')
    const emailSetup = readFileSync(
      new URL('../../supabase/functions/send-confirmation/README.md', import.meta.url),
      'utf8',
    )

    expect(env).not.toContain('Vercel')
    expect(findings).toMatch(/^> Status: ARCHIVED — historical reference only/m)
    expect(map).not.toContain('myBookingsEscalation')
    expect(map).not.toContain('Older prose describes broader past+future backfill')
    expect(emailSetup).toContain('retry or discard')
  })
})
