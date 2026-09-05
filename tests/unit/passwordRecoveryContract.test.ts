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
      "import { verifyTurnstile } from '../_shared/turnstile.ts'",
      "typeof body.turnstileToken === 'string'",
      "Deno.env.get('TURNSTILE_SECRET')",
      'verifyTurnstile(turnstileToken',
      "service.rpc('consume_auth_email_send'",
    ])
  })

  it('keeps failed challenge outcomes neutral to the recovery requester', () => {
    const source = readFileSync('supabase/functions/send-recovery-email/index.ts', 'utf8')

    const failedChallenge = source.indexOf("return json({ ok: false, error: 'failed_challenge' })")
    const challengeCheck = source.indexOf('if (!(await verifyTurnstile(')

    expect(failedChallenge).toBeGreaterThan(challengeCheck)
    expect(source).not.toContain('return json({ ok: true })\n  }\n  const url')
  })

  it('does not require delivery configuration before rejecting a challenge', () => {
    const source = readFileSync('supabase/functions/send-recovery-email/index.ts', 'utf8')
    const secret = source.indexOf("const turnstileSecret = Deno.env.get('TURNSTILE_SECRET')")
    const verify = source.indexOf('if (!(await verifyTurnstile(')
    const serviceConfig = source.indexOf("const url = Deno.env.get('SUPABASE_URL')")
    const resendConfig = source.indexOf("const resendKey = Deno.env.get('RESEND_API_KEY')")

    expect(secret).toBeGreaterThan(-1)
    expect(verify).toBeGreaterThan(secret)
    expect(serviceConfig).toBeGreaterThan(verify)
    expect(resendConfig).toBeGreaterThan(verify)
  })
})
