import type * as TurnstileModule from '../../supabase/functions/_shared/turnstile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ verify: vi.fn(), createClient: vi.fn(), rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.createClient }))
vi.mock('../../supabase/functions/_shared/turnstile', async (original) => ({
  ...(await original<typeof TurnstileModule>()),
  verifyTurnstile: boundary.verify,
}))

let handler: (request: Request) => Promise<Response>
let config: Record<string, string>
beforeEach(async () => {
  vi.resetModules()
  boundary.verify.mockReset().mockResolvedValue(false)
  boundary.createClient.mockReset().mockReturnValue({ rpc: boundary.rpc })
  boundary.rpc.mockReset().mockResolvedValue({ data: false, error: null })
  config = { TURNSTILE_SECRET: 'unit-secret', PUBLIC_SITE_ORIGINS: 'https://salon.example.test' }
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request')
    }),
  )
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => config[name] },
    serve: (callback: typeof handler) => {
      handler = callback
    },
  })
  // Deno entrypoints have a separate type-check gate; this exercises their HTTP boundary in Node.
  await vi.importActual('../../supabase/functions/send-recovery-email/index.ts')
})
afterEach(() => vi.unstubAllGlobals())

function recover(email = 'staff@example.test', token = 'challenge'): Promise<Response> {
  return handler(
    new Request('https://edge.example.test/send-recovery-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ email, lang: 'en', turnstileToken: token }),
    }),
  )
}

describe('password recovery challenge boundary', () => {
  it.each(['unknown@example.test', 'staff@example.test'])(
    'rejects a failed challenge neutrally for %s without delivery configuration or limiter consumption',
    async (email) => {
      const response = await recover(email)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: false, error: 'failed_challenge' })
      expect(boundary.verify).toHaveBeenCalledWith('challenge', '203.0.113.9', 'unit-secret', {
        action: 'password_recovery',
        hostnames: ['salon.example.test'],
      })
      expect(boundary.createClient).not.toHaveBeenCalled()
      expect(boundary.rpc).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('consumes the email limiter only after verification succeeds', async () => {
    Object.assign(config, {
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
      RESEND_API_KEY: 'unit-resend',
    })
    boundary.verify.mockResolvedValue(true)
    const response = await recover()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(boundary.rpc).toHaveBeenCalledWith('consume_auth_email_send', {
      p_kind: 'recovery',
      p_scope_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(boundary.verify.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.rpc.mock.invocationCallOrder[0] ?? 0,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unknown request keys before challenge verification', async () => {
    const response = await handler(
      new Request('https://edge.example.test/recovery', {
        method: 'POST',
        body: JSON.stringify({
          email: 'staff@example.test',
          lang: 'en',
          turnstileToken: 'challenge',
          extra: true,
        }),
      }),
    )
    expect(response.status).toBe(400)
    expect(boundary.verify).not.toHaveBeenCalled()
    expect(boundary.rpc).not.toHaveBeenCalled()
  })
})
