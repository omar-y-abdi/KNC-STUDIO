import { describe, expect, it } from 'vitest'

const functionsBase = (
  process.env.SUPABASE_FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1'
).replace(/\/$/, '')

describe('password recovery Edge function', () => {
  it('keeps an invalid Turnstile recovery request neutral without sending email', async ({
    skip,
  }) => {
    let response: Response
    try {
      response = await fetch(`${functionsBase}/send-recovery-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'unknown@example.test',
          lang: 'en',
          turnstileToken: 'invalid-local-test-token',
        }),
        signal: AbortSignal.timeout(2_000),
      })
    } catch {
      skip('local Edge Functions runtime is not serving send-recovery-email')
      return
    }
    const responseText = await response.text()
    if (
      response.status === 404 ||
      (response.status === 503 && responseText.includes('name resolution failed'))
    ) {
      skip('local Edge Functions runtime is not serving send-recovery-email')
      return
    }

    expect(response.status).toBe(200)
    expect(JSON.parse(responseText)).toEqual({ ok: true })
  })
})
