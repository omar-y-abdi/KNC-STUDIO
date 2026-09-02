import { describe, expect, it } from 'vitest'
import { backendReady } from './_helpers'

const functionsBase = (
  process.env.SUPABASE_FUNCTIONS_URL ??
  `${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/functions/v1`
).replace(/\/$/, '')

describe.skipIf(!backendReady())('password recovery Edge function', () => {
  it('returns the same generic challenge failure before any delivery path', async () => {
    const responses = await Promise.all(
      ['unknown@example.test', 'staff@example.test'].map((email) =>
        fetch(`${functionsBase}/send-recovery-email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            lang: 'en',
            // An empty token is deterministically rejected before Auth, Resend, or the limiter.
            turnstileToken: '',
          }),
          signal: AbortSignal.timeout(2_000),
        }),
      ),
    )

    for (const response of responses) {
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'failed_challenge',
      })
    }
  })
})
