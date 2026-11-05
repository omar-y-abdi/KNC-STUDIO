import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CUSTOMER_RECEIPT_COOKIE,
  CUSTOMER_SESSION_COOKIE,
} from '../../supabase/functions/_shared/customerCookies'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }))

const receipt = 'a'.repeat(64)
const session = 'b'.repeat(64)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const payload = {
  action: 'review',
  phone: '0701234567',
  rating: 5,
  text: 'Great cut',
  turnstileToken: 'challenge',
}

describe('device review Edge gateway', () => {
  let handler: (request: Request) => Promise<Response>
  let challenge: ReturnType<typeof vi.fn<typeof fetch>>
  beforeEach(async () => {
    vi.resetModules()
    rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === 'consume_public_action_attempt') return { data: true, error: null }
      if (name === 'create_review_for_browser') return { data: { ok: true }, error: null }
      throw new Error(`Unexpected review RPC: ${name}`)
    })
    const config: Record<string, string> = {
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
      PUBLIC_SITE_ORIGINS: 'https://salon.example.test',
      TURNSTILE_SECRET: 'unit-turnstile',
      PUBLIC_ACTION_HASH_SALT: 'unit-public-action-salt',
      CUSTOMER_GATEWAY_SECRET: 'unit-gateway-secret-long-enough-for-signing',
    }
    vi.stubGlobal('Deno', {
      env: { get: (key: string) => config[key] },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    })
    challenge = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        hostname: 'salon.example.test',
        action: 'review',
      }),
    )
    vi.stubGlobal('fetch', challenge)
    await vi.importActual('../../supabase/functions/public-booking-actions/index.ts')
  })
  afterEach(() => vi.unstubAllGlobals())

  function request(cookie: string, extra: Record<string, unknown> = {}, headers = {}) {
    return handler(
      new Request('https://edge.example.test/public-booking-actions', {
        method: 'POST',
        headers: { Origin: 'https://salon.example.test', Cookie: cookie, ...headers },
        body: JSON.stringify({ ...payload, ...extra }),
      }),
    )
  }

  it.each([
    [`${CUSTOMER_RECEIPT_COOKIE}=${receipt}`, null, hash(receipt)],
    [`${CUSTOMER_SESSION_COOKIE}=${session}`, hash(session), null],
    [
      `${CUSTOMER_RECEIPT_COOKIE}=${receipt}; ${CUSTOMER_SESSION_COOKIE}=${session}`,
      hash(session),
      hash(receipt),
    ],
  ] as const)(
    'passes hashed browser credentials through existing challenge and limit gates: %s',
    async (cookie, sessionHash, receiptHash) => {
      const response = await request(cookie)
      await expect(response.json()).resolves.toEqual({ ok: true })
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(challenge).toHaveBeenCalledOnce()
      expect(rpc).toHaveBeenNthCalledWith(
        1,
        'consume_public_action_attempt',
        expect.objectContaining({ p_action: 'review' }),
      )
      expect(rpc).toHaveBeenNthCalledWith(2, 'create_review_for_browser', {
        p_session_hash: sessionHash,
        p_receipt_hash: receiptHash,
        p_phone: payload.phone,
        p_rating: payload.rating,
        p_text: payload.text,
      })
      expect(rpc).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['', `${CUSTOMER_RECEIPT_COOKIE}=invalid`, 'unrelated_cookie=valid'])(
    'rejects missing or malformed credentials: %s',
    async (cookie) => {
      await expect((await request(cookie)).json()).resolves.toEqual({
        ok: false,
        error: 'no_booking',
      })
      expect(rpc).not.toHaveBeenCalled()
    },
  )

  it('does not fall back to a device cookie when an explicit bearer was supplied', async () => {
    await request(`${CUSTOMER_RECEIPT_COOKIE}=${receipt}; ${CUSTOMER_SESSION_COOKIE}=${session}`, {
      accessToken: 'c'.repeat(64),
    })
    expect(rpc).toHaveBeenLastCalledWith(
      'create_review_for_browser',
      expect.objectContaining({
        p_session_hash: hash('c'.repeat(64)),
        p_receipt_hash: null,
      }),
    )
  })

  it('retains Turnstile rejection before review writes', async () => {
    challenge.mockResolvedValue(Response.json({ success: false }))
    await expect((await request(`${CUSTOMER_RECEIPT_COOKIE}=${receipt}`)).json()).resolves.toEqual({
      ok: false,
      error: 'failed_challenge',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('retains per-IP and per-phone rate limits before review writes', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    await expect((await request(`${CUSTOMER_RECEIPT_COOKIE}=${receipt}`)).json()).resolves.toEqual({
      ok: false,
      error: 'rate_limited',
    })
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith(
      'consume_public_action_attempt',
      expect.objectContaining({
        p_action: 'review',
        p_ip_limit: 5,
        p_phone_limit: 2,
      }),
    )
  })

  it.each([
    { Origin: 'https://attacker.example' },
    { 'x-customer-gateway-signature': 'forged', 'x-customer-gateway-ip': '127.0.0.1' },
  ])(
    'rejects untrusted origin or gateway signature before reading review authority',
    async (headers) => {
      const response = await request(`${CUSTOMER_RECEIPT_COOKIE}=${receipt}`, {}, headers)
      expect(response.status).toBe(403)
      expect(challenge).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    },
  )
})
