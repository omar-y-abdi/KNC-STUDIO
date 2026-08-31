import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function ordered(source: string, tokens: readonly string[]): void {
  let cursor = -1
  for (const token of tokens) {
    const next = source.indexOf(token, cursor + 1)
    expect(next, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor)
    cursor = next
  }
}

describe('password recovery Turnstile contract', () => {
  it('verifies the challenge server-side before consuming the existing email limiter', () => {
    const source = readFileSync('supabase/functions/send-recovery-email/index.ts', 'utf8')

    ordered(source, [
      "const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'",
      'async function verifyTurnstile',
      "form.set('secret', secret)",
      "form.set('response', token)",
      "typeof body.turnstileToken === 'string'",
      "Deno.env.get('TURNSTILE_SECRET')",
      'verifyTurnstile(turnstileToken',
      "service.rpc('consume_auth_email_send'",
    ])
  })

  it('keeps failed challenge outcomes neutral to the recovery requester', () => {
    const source = readFileSync('supabase/functions/send-recovery-email/index.ts', 'utf8')

    expect(source).toContain('return json({ ok: true })')
    expect(source).toContain('if (!(await verifyTurnstile(')
  })
})
