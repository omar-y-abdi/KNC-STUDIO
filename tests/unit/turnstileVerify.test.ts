import { describe, expect, it, vi } from 'vitest'
import { verifyTurnstile } from '../../supabase/functions/_shared/turnstile'

describe('Turnstile siteverify seam', () => {
  it('accepts only a successful validation response and sends the token and IP', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const form = init?.body as URLSearchParams
      expect(form.get('secret')).toBe('test-secret')
      expect(form.get('response')).toBe('dummy-token')
      expect(form.get('remoteip')).toBe('203.0.113.10')
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    })

    await expect(
      verifyTurnstile('dummy-token', '203.0.113.10', 'test-secret', fetcher),
    ).resolves.toBe(true)
  })

  it('maps an always-fail validation to false', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
          {
            status: 200,
          },
        ),
    )

    await expect(
      verifyTurnstile('always-fail-token', 'unknown', 'test-secret', fetcher),
    ).resolves.toBe(false)
  })

  it('fails closed on a Siteverify transport or response error', async () => {
    const networkError = vi.fn<typeof fetch>(async () => {
      throw new Error('connection reset')
    })
    const httpError = vi.fn<typeof fetch>(
      async () => new Response('upstream unavailable', { status: 503 }),
    )

    await expect(verifyTurnstile('token', 'unknown', 'test-secret', networkError)).resolves.toBe(
      false,
    )
    await expect(verifyTurnstile('token', 'unknown', 'test-secret', httpError)).resolves.toBe(false)
  })
})
