import { describe, expect, it, vi } from 'vitest'
import { verifyTurnstile, turnstilePolicy } from '../../supabase/functions/_shared/turnstile'

const policy = turnstilePolicy('booking')

describe('Turnstile siteverify seam', () => {
  it.each([
    { success: true, hostname: 'attacker.example', action: 'booking' },
    { success: true, hostname: 'bladeblendstudio.se.attacker.example', action: 'booking' },
    { success: true, hostname: 'bladeblendstudio.se', action: 'review' },
    { success: true, hostname: 'bladeblendstudio.se' },
    { success: true, action: 'booking' },
    { success: false, hostname: 'bladeblendstudio.se', action: 'booking' },
    null,
  ])('denies malformed, wrong-host, missing-action and cross-action proofs: %j', async (data) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(data))
    expect(await verifyTurnstile('token', 'unknown', 'real-secret', policy, fetcher)).toBe(false)
  })

  it('bounds tokens before network I/O', async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await verifyTurnstile('', 'unknown', 'real-secret', policy, fetcher)).toBe(false)
    expect(await verifyTurnstile('x'.repeat(2049), 'unknown', 'real-secret', policy, fetcher)).toBe(
      false,
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses deployment hostnames, ignores invalid configuration, and never derives trust from a request', () => {
    expect(
      turnstilePolicy('review', 'https://bladeblendstudio.se,https://bladeblendstudio.se,invalid'),
    ).toEqual({ action: 'review', hostnames: ['bladeblendstudio.se'] })
    expect(turnstilePolicy('review', 'invalid').hostnames).toEqual([])
  })

  it('permits official dummy tokens only for an entirely loopback deployment', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        hostname: 'example.com',
        metadata: { result_with_testing_key: true },
      }),
    )
    const secret = '1x0000000000000000000000000000000AA'
    expect(await verifyTurnstile('dummy-token', 'unknown', secret, policy, fetcher)).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      await verifyTurnstile(
        'dummy-token',
        'unknown',
        secret,
        turnstilePolicy('booking', 'http://127.0.0.1:4173,https://localhost:4197'),
        fetcher,
      ),
    ).toBe(true)
    expect(
      await verifyTurnstile(
        'dummy-token',
        'unknown',
        secret,
        turnstilePolicy('booking', 'http://localhost:4197,https://bladeblendstudio.se'),
        fetcher,
      ),
    ).toBe(false)
  })

  it('aborts an unavailable provider after the configured deadline', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    try {
      const fetcher = vi.fn<typeof fetch>(
        async (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Timed out', 'TimeoutError')),
            )
            controller.abort()
          }),
      )
      expect(await verifyTurnstile('token', 'unknown', 'real-secret', policy, fetcher)).toBe(false)
      expect(timeout).toHaveBeenCalledWith(8000)
    } finally {
      timeout.mockRestore()
    }
  })

  it('accepts only a successful validation response and sends the token and IP', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const form = init?.body as URLSearchParams
      expect(form.get('secret')).toBe('test-secret')
      expect(form.get('response')).toBe('dummy-token')
      expect(form.get('remoteip')).toBe('203.0.113.10')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(
        JSON.stringify({ success: true, hostname: 'bladeblendstudio.se', action: 'booking' }),
        { status: 200 },
      )
    })

    await expect(
      verifyTurnstile('dummy-token', '203.0.113.10', 'test-secret', policy, fetcher),
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
      verifyTurnstile('always-fail-token', 'unknown', 'test-secret', policy, fetcher),
    ).resolves.toBe(false)
  })

  it('fails closed on a Siteverify transport or response error', async () => {
    const networkError = vi.fn<typeof fetch>(async () => {
      throw new Error('connection reset')
    })
    const httpError = vi.fn<typeof fetch>(
      async () => new Response('upstream unavailable', { status: 503 }),
    )

    await expect(
      verifyTurnstile('token', 'unknown', 'test-secret', policy, networkError),
    ).resolves.toBe(false)
    await expect(
      verifyTurnstile('token', 'unknown', 'test-secret', policy, httpError),
    ).resolves.toBe(false)
  })
})
