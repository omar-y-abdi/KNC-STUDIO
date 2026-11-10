import { createHash } from 'node:crypto'
import { Webhook } from 'standardwebhooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  profile: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.createClient }))

const SECRET = Buffer.from('unit-send-email-hook-secret-0123456789').toString('base64')
const USER_ID = '7d0c4f1e-6d1f-4a55-9c0a-2f5f3f1b8a10'
const TOKEN_HASH = 'a'.repeat(56)
const RESEND_ID = '11111111-2222-4333-8444-555555555555'
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

let handler: (request: Request) => Promise<Response>
let config: Record<string, string>
let limited: boolean
let resend: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>

beforeEach(async () => {
  vi.resetModules()
  limited = false
  config = {
    SEND_EMAIL_HOOK_SECRET: `v1,whsec_${SECRET}`,
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
    RESEND_API_KEY: 'unit-resend',
  }
  boundary.profile.mockReset().mockResolvedValue({ data: { account_enabled: true }, error: null })
  boundary.rpc.mockReset().mockImplementation((name: string) => {
    if (name === 'consume_auth_email_send') return Promise.resolve({ data: !limited, error: null })
    if (name === 'public_business_discovery') {
      return Promise.resolve({
        data: {
          settings: {
            business_name: 'Unit Studio',
            business_email: 'contact@unit.example',
            business_street: 'Unit Street 1',
            business_postal_code: '411 11',
            business_city: 'Göteborg',
            cancellation_policy_hours: '24',
          },
        },
        error: null,
      })
    }
    // No published template row: the built-in copy is used. The log write succeeds.
    return Promise.resolve({ data: null, error: null })
  })
  boundary.createClient.mockReset().mockReturnValue({
    rpc: boundary.rpc,
    from: () => ({ select: () => ({ eq: () => ({ single: boundary.profile }) }) }),
  })
  resend = vi.fn(() => Promise.resolve(Response.json({ id: RESEND_ID })))
  vi.stubGlobal('fetch', resend)
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => config[name] },
    serve: (callback: typeof handler) => {
      handler = callback
    },
  })
  // Deno entrypoints have a separate type-check gate; this exercises their HTTP boundary in Node.
  await vi.importActual('../../supabase/functions/send-auth-email/index.ts')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

interface HookOptions {
  readonly type?: string
  readonly redirectTo?: string
  readonly newEmail?: string
  readonly secret?: string
  readonly tamper?: boolean
}

/** A request signed the way Auth signs its hook calls (Standard Webhooks). */
function hook(options: HookOptions = {}): Promise<Response> {
  const body = JSON.stringify({
    user: {
      id: USER_ID,
      aud: 'authenticated',
      email: 'staff@example.test',
      ...(options.newEmail === undefined ? {} : { new_email: options.newEmail }),
    },
    email_data: {
      token: '12345678',
      token_hash: TOKEN_HASH,
      redirect_to: options.redirectTo ?? 'https://bladeblendstudio.se/reset?lang=en',
      email_action_type: options.type ?? 'recovery',
      site_url: 'https://bladeblendstudio.se',
      token_new: '',
      token_hash_new: 'not-the-hash-for-the-new-address',
    },
  })
  const id = 'msg_unit'
  const sentAt = new Date()
  return handler(
    new Request('https://edge.example.test/send-auth-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(Math.floor(sentAt.getTime() / 1000)),
        'webhook-signature': new Webhook(options.secret ?? SECRET).sign(id, sentAt, body),
      },
      body: options.tamper ? body.replace('staff@', 'other@') : body,
    }),
  )
}

function sentMessage(): { headers: Record<string, string>; body: Record<string, string> } {
  expect(resend).toHaveBeenCalledOnce()
  const [url, init] = resend.mock.calls[0] ?? []
  expect(url).toBe('https://api.resend.com/emails')
  return {
    headers: init?.headers as Record<string, string>,
    body: JSON.parse(String(init?.body)) as Record<string, string>,
  }
}

function expectNothingSent(): void {
  expect(resend).not.toHaveBeenCalled()
  expect(boundary.rpc).not.toHaveBeenCalledWith('internal_record_email_send', expect.anything())
}

describe('Auth Send Email hook boundary', () => {
  it('answers a configuration error while the hook secret is missing', async () => {
    delete config['SEND_EMAIL_HOOK_SECRET']
    const response = await hook()
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 503, message: 'not_configured' },
    })
    expect(boundary.createClient).not.toHaveBeenCalled()
  })

  it.each([
    ['a signature made with another secret', { secret: Buffer.from('another').toString('base64') }],
    ['a body changed after signing', { tamper: true }],
  ])('refuses %s before any privileged work', async (_name, options) => {
    const response = await hook(options)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 401, message: 'invalid_signature' },
    })
    expect(boundary.createClient).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('refuses a request without signature headers and any method but POST', async () => {
    const unsigned = await handler(
      new Request('https://edge.example.test/send-auth-email', { method: 'POST', body: '{}' }),
    )
    expect(unsigned.status).toBe(401)
    const read = await handler(new Request('https://edge.example.test/send-auth-email'))
    expect(read.status).toBe(405)
    expect(boundary.createClient).not.toHaveBeenCalled()
  })

  it.each(['signup', 'invite', 'magiclink', 'reauthentication', 'email'])(
    'refuses the %s email it has no template for',
    async (type) => {
      const response = await hook({ type })
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        error: { http_code: 422, message: 'unsupported_email' },
      })
      expect(boundary.createClient).not.toHaveBeenCalled()
      expectNothingSent()
    },
  )
})

describe('password recovery through the hook', () => {
  it('sends the recovery link in the language of the redirect and logs the send', async () => {
    const response = await hook()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({})

    expect(boundary.rpc).toHaveBeenCalledWith('consume_auth_email_send', {
      p_kind: 'recovery',
      p_scope_hash: sha256('recovery:staff@example.test'),
    })
    expect(boundary.rpc).toHaveBeenCalledWith('email_template_for_delivery', {
      p_template: 'auth_recovery',
      p_lang: 'en',
    })
    const { headers, body } = sentMessage()
    expect(headers['Idempotency-Key']).toBe(`auth-recovery/${TOKEN_HASH.slice(0, 48)}`)
    expect(body['to']).toBe('staff@example.test')
    expect(body['subject']).toBe('Reset password')
    const link = `https://bladeblendstudio.se/reset?token_hash=${TOKEN_HASH}&type=recovery`
    expect(body['text']).toContain(link)
    expect(body['html']).toContain(`href="${link.replace('&', '&amp;')}"`)
    expect(boundary.rpc).toHaveBeenCalledWith(
      'internal_record_email_send',
      expect.objectContaining({
        p_kind: 'auth_recovery',
        p_recipient: 'staff@example.test',
        p_status: 'sent',
      }),
    )
  })

  it.each([
    'https://bladeblendstudio.se/reset?lang=sv',
    'https://bladeblendstudio.se/reset',
    'https://bladeblendstudio.se/reset?lang=de',
    '',
  ])('writes Swedish unless the redirect asks for English: "%s"', async (redirectTo) => {
    await hook({ redirectTo })
    expect(sentMessage().body['subject']).toBe('Återställ lösenord')
  })

  it('answers success and sends nothing when the address is rate limited', async () => {
    limited = true
    const response = await hook()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expectNothingSent()
  })

  it.each([
    [
      'the provider rejects the message',
      () => resend.mockResolvedValue(new Response('{}', { status: 500 })),
    ],
    ['the provider cannot be reached', () => resend.mockRejectedValue(new TypeError('offline'))],
    ['delivery is not configured', () => delete config['RESEND_API_KEY']],
  ])('answers success when %s', async (_name, arrange) => {
    arrange()
    const response = await hook()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
  })

  it('answers success at the deadline while the provider is still silent', async () => {
    vi.useFakeTimers()
    resend.mockReturnValue(new Promise(() => undefined))
    const pending = hook()
    await vi.waitFor(() => expect(resend).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(3_500)
    const response = await pending
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
  })
})

describe('email change through the hook', () => {
  const change = (options: HookOptions = {}): Promise<Response> =>
    hook({
      type: 'email_change',
      newEmail: 'New@Example.test',
      redirectTo: 'https://bladeblendstudio.se/auth/confirm?lang=sv',
      ...options,
    })

  it('sends the confirmation to the new address with the hash that confirms it', async () => {
    const response = await change()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})

    expect(boundary.rpc).toHaveBeenCalledWith('consume_auth_email_send', {
      p_kind: 'email_change',
      p_scope_hash: sha256(`email-change:${USER_ID}`),
    })
    const { headers, body } = sentMessage()
    expect(headers['Idempotency-Key']).toBe(`auth-email-change/${TOKEN_HASH.slice(0, 48)}`)
    expect(body['to']).toBe('new@example.test')
    expect(body['subject']).toBe('Bekräfta ny e-postadress')
    expect(body['text']).toContain('Bekräfta new@example.test som ny e-postadress')
    expect(body['text']).toContain(
      `https://bladeblendstudio.se/auth/confirm?token_hash=${TOKEN_HASH}&type=email_change`,
    )
    expect(boundary.rpc).toHaveBeenCalledWith(
      'internal_record_email_send',
      expect.objectContaining({ p_kind: 'auth_email_change', p_recipient: 'new@example.test' }),
    )
  })

  it('writes English when the redirect asks for it', async () => {
    await change({ redirectTo: 'https://bladeblendstudio.se/auth/confirm?lang=en' })
    expect(sentMessage().body['subject']).toBe('Confirm new email address')
  })

  it.each([
    ['a disabled account', { data: { account_enabled: false }, error: null }],
    ['an account without a profile', { data: null, error: { code: 'PGRST116' } }],
  ])('refuses %s before the limiter and the provider', async (_name, profile) => {
    boundary.profile.mockResolvedValue(profile)
    const response = await change()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 403, message: 'forbidden' },
    })
    expect(boundary.rpc).not.toHaveBeenCalled()
    expectNothingSent()
  })

  it('refuses a rate-limited account without sending', async () => {
    limited = true
    const response = await change()
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeNull()
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 429, message: 'rate_limited' },
    })
    expectNothingSent()
  })

  it('reports a failed send to Auth', async () => {
    resend.mockResolvedValue(new Response('{}', { status: 500 }))
    const response = await change()
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 502, message: 'send_failed' },
    })
  })

  it('refuses a payload that names no new address', async () => {
    const response = await hook({ type: 'email_change' })
    expect(response.status).toBe(422)
    expectNothingSent()
  })

  it('answers a failure at the deadline and never sends a link Auth has dropped', async () => {
    vi.useFakeTimers()
    let release = (): void => undefined
    boundary.profile.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ data: { account_enabled: true }, error: null })
      }),
    )
    const pending = change()
    await vi.advanceTimersByTimeAsync(3_500)
    const response = await pending
    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 504, message: 'timeout' },
    })
    release()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(boundary.rpc).toHaveBeenCalledWith('public_business_discovery'))
    await vi.advanceTimersByTimeAsync(0)
    expectNothingSent()
  })
})
