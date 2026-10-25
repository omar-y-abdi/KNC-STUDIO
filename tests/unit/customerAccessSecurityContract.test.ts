import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer, type UserConfig, type UserConfigFn } from 'vite'
import { consumeBookingAccessLink } from '../../src/mybookings/accessLink'
import { customerGateway } from '../../src/mybookings/customerGateway'
import {
  customerCookie,
  customerCookieHeader,
  CUSTOMER_SESSION_COOKIE,
} from '../../supabase/functions/_shared/customerCookies'
import { encryptCustomerAccessToken } from '../../supabase/functions/_shared/customerAccess'
import {
  executeExternalAction,
  type ExternalActionService,
} from '../../supabase/functions/_shared/externalActions'

const confirmationDb = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: confirmationDb.rpc }) }))

describe('customer booking access links', () => {
  it('consumes permanent random root-path links as direct access tokens', () => {
    const token = 'a'.repeat(64)
    expect(consumeBookingAccessLink(`https://bladeblendstudio.se/${token}`)).toEqual({
      code: token,
      cleanPath: '/',
      direct: true,
    })
  })

  it('consumes new fragment links without exposing access codes to HTTP requests', () => {
    expect(
      consumeBookingAccessLink(
        'https://bladeblendstudio.se/?campaign=mail#booking_access=abc123&source=customer',
      ),
    ).toEqual({
      code: 'abc123',
      cleanPath: '/?campaign=mail#source=customer',
      direct: false,
    })
  })

  it('keeps already-sent query links compatible while stripping their code', () => {
    expect(
      consumeBookingAccessLink(
        'https://bladeblendstudio.se/?booking_access=legacy123&campaign=mail#section=bookings',
      ),
    ).toEqual({
      code: 'legacy123',
      cleanPath: '/?campaign=mail#section=bookings',
      direct: false,
    })
  })

  it('prioritises a valid email-link proof and strips every other credential', () => {
    const rootToken = 'b'.repeat(64)
    const emailLink = 'A'.repeat(64)
    const parsed = consumeBookingAccessLink(
      `https://bladeblendstudio.se/${rootToken}/?booking_access=legacy#booking_token=fragment&email_link=${emailLink}&booking_access=hash&keep=1`,
    )

    expect(parsed).toMatchObject({
      code: null,
      direct: false,
      emailLinkCode: emailLink.toLowerCase(),
    })
    expect(parsed.cleanPath).toBe('/#keep=1')
    for (const credential of [rootToken, 'legacy', 'fragment', emailLink.toLowerCase()])
      expect(parsed.cleanPath).not.toContain(credential)
    expect(parsed.cleanPath).not.toContain('booking_access')
    expect(parsed.cleanPath).not.toContain('booking_token')
    expect(parsed.cleanPath).not.toContain('email_link')
  })

  it.each(['short', 'g'.repeat(64), 'not-a-token', ''])(
    'returns a null email-link proof for malformed supplied credentials (%s)',
    (value) => {
      const parsed = consumeBookingAccessLink(
        `https://bladeblendstudio.se/?booking_access=legacy#email_link=${encodeURIComponent(value)}&keep=1`,
      )
      expect(parsed).toEqual({
        code: null,
        cleanPath: '/#keep=1',
        direct: false,
        emailLinkCode: null,
      })
    },
  )

  it('rejects duplicate email-link proofs instead of choosing one', () => {
    const code = 'c'.repeat(64)
    expect(
      consumeBookingAccessLink(
        `https://bladeblendstudio.se/#email_link=${code}&email_link=${code}`,
      ),
    ).toEqual({
      code: null,
      cleanPath: '/',
      direct: false,
      emailLinkCode: null,
    })
  })

  it('queues access-link delivery through rotation without sending provider email in the request', async () => {
    const secret = 'unit-customer-access-encryption-secret'
    const config: Record<string, string> = {
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
      PUBLIC_SITE_ORIGINS: 'https://salon.example.test',
      TURNSTILE_SECRET: 'unit-turnstile',
      PUBLIC_ACTION_HASH_SALT: secret,
      RESEND_API_KEY: 'unit-resend',
    }
    confirmationDb.rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === 'consume_public_action_attempt') return { data: true, error: null }
      if (name === 'rotate_customer_booking_access_token')
        return { data: { ok: true }, error: null }
      throw new Error(`Unexpected access request RPC ${name}`)
    })
    const network = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input) !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
        throw new Error('Unexpected provider email request')
      return Response.json({
        success: true,
        hostname: 'salon.example.test',
        action: 'customer_access',
      })
    })
    let handler: ((request: Request) => Promise<Response>) | undefined
    vi.stubGlobal('Deno', {
      env: { get: (key: string) => config[key] },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    })
    vi.stubGlobal('fetch', network)
    const waitUntil = vi.fn()
    vi.stubGlobal('EdgeRuntime', { waitUntil })
    try {
      await vi.importActual('../../supabase/functions/public-booking-actions/index.ts')
      if (!handler) throw new Error('Missing customer action handler')
      const response = await handler(
        new Request('https://edge.example.test/customer-bookings', {
          method: 'POST',
          headers: { origin: 'https://salon.example.test' },
          body: JSON.stringify({
            action: 'request_access',
            email: 'customer@example.test',
            lang: 'en',
            turnstileToken: 'challenge',
          }),
        }),
      )
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
      expect(confirmationDb.rpc).toHaveBeenCalledTimes(2)
      expect(confirmationDb.rpc).toHaveBeenLastCalledWith('rotate_customer_booking_access_token', {
        p_email: 'customer@example.test',
        p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_token_ciphertext: expect.stringMatching(/^v1\./),
        p_access_code: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_lang: 'en',
      })
      expect(network).toHaveBeenCalledOnce()
      expect(waitUntil).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends a decrypted permanent root link through the durable external-action worker', async () => {
    const token = 'a'.repeat(64)
    const secret = 'unit-customer-access-encryption-secret'
    const id = '54000000-0000-4000-8000-000000000001'
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === 'public_business_discovery'
          ? {
              settings: {
                business_name: 'Owner Salon',
                business_email: 'owner@example.test',
                business_street: 'Street 1',
                business_postal_code: '12345',
                business_city: 'City',
                cancellation_policy_hours: '24',
              },
            }
          : name === 'consume_customer_access_email_challenge'
            ? true
            : null,
      error: null,
    }))
    const service: ExternalActionService = {
      rpc,
      storage: { from: () => ({ remove: vi.fn() }) },
      auth: { admin: { updateUserById: vi.fn(), deleteUser: vi.fn() } },
    }
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id }))
    vi.stubGlobal('fetch', send)
    try {
      const ciphertext = await encryptCustomerAccessToken(token, secret)
      await executeExternalAction(
        {
          id,
          dispatch_token: id,
          action_type: 'customer_access_email_send',
          challenge_id: id,
          email: 'customer@example.test',
          lang: 'en',
          token_ciphertext: ciphertext,
        },
        service,
        {
          googleClientId: undefined,
          googleClientSecret: undefined,
          resendApiKey: 'unit-resend',
          customerAccessHashSalt: secret,
        },
      )
      expect(send).toHaveBeenCalledOnce()
      const request = send.mock.calls[0]
      expect(request?.[0]).toBe('https://api.resend.com/emails')
      const message = JSON.parse(String(request?.[1]?.body)) as { html: string; text: string }
      expect(message.html).toContain(`href="https://bladeblendstudio.se/${token}"`)
      expect(message.text).toContain(`https://bladeblendstudio.se/${token}`)
      expect(message.html).not.toContain(ciphertext)
      expect(rpc).toHaveBeenLastCalledWith('consume_customer_access_email_challenge', {
        p_challenge_id: id,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reuses the stored permanent root link in a booking-confirmation email', async () => {
    const id = '54000000-0000-4000-8000-000000000001'
    const token = 'c'.repeat(64)
    const secret = 'unit-customer-access-encryption-secret'
    const ciphertext = await encryptCustomerAccessToken(token, secret)
    const config: Record<string, string> = {
      WEBHOOK_SECRET: 'unit-webhook',
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
      PUBLIC_ACTION_HASH_SALT: secret,
      RESEND_API_KEY: 'unit-resend',
    }
    confirmationDb.rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === 'booking_confirmation_details')
        return {
          data: {
            id,
            email: 'customer@example.test',
            phone: '0701234567',
            customer_name: 'Customer',
            start_at: '2040-03-18T12:00:00Z',
            service_name: 'Cut',
            price: 300,
            duration_min: 30,
            barber_name: 'Barber',
            barber_email: null,
            lang: 'en',
            status: 'confirmed',
          },
          error: null,
        }
      if (name === 'public_business_discovery')
        return {
          data: {
            settings: {
              business_name: 'Owner Salon',
              business_email: 'owner@example.test',
              business_street: 'Street 1',
              business_postal_code: '12345',
              business_city: 'City',
              cancellation_policy_hours: '24',
            },
          },
          error: null,
        }
      if (name === 'ensure_customer_booking_access_token')
        return { data: { token_ciphertext: ciphertext, generation: 1 }, error: null }
      if (name === 'email_template_for_delivery') return { data: null, error: null }
      throw new Error(`Unexpected confirmation RPC ${name}`)
    })
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id }))
    let handler: ((request: Request) => Promise<Response>) | undefined
    vi.stubGlobal('Deno', {
      env: { get: (key: string) => config[key] },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    })
    vi.stubGlobal('fetch', send)
    try {
      await vi.importActual('../../supabase/functions/send-confirmation/index.ts')
      if (!handler) throw new Error('Missing confirmation handler')
      const response = await handler(
        new Request('https://edge.example.test/confirmation', {
          method: 'POST',
          headers: { 'x-webhook-secret': 'unit-webhook' },
          body: JSON.stringify({ id }),
        }),
      )
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ ok: true, sent: ['customer'] })
      expect(send).toHaveBeenCalledOnce()
      const message = JSON.parse(String(send.mock.calls[0]?.[1]?.body)) as {
        html: string
        text: string
      }
      expect(message.html).toContain(`href="https://bladeblendstudio.se/${token}"`)
      expect(message.text).toContain(`https://bladeblendstudio.se/${token}`)
      expect(message.html).not.toContain(ciphertext)
      expect(confirmationDb.rpc).not.toHaveBeenCalledWith(
        'replace_customer_booking_access_token',
        expect.anything(),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('serializes an opaque host-only HttpOnly session and accepts only well-formed cookie tokens', () => {
    const token = 'b'.repeat(64)
    const header = customerCookieHeader(CUSTOMER_SESSION_COOKIE, token, 3600)
    expect(header).toBe(
      `__Host-bladeblend_customer_session=${token}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=None`,
    )
    const request = (value: string) =>
      new Request('https://salon.example.test', { headers: { Cookie: value } })
    expect(
      customerCookie(
        request(`other=value; ${CUSTOMER_SESSION_COOKIE}=${token}`),
        CUSTOMER_SESSION_COOKIE,
      ),
    ).toBe(token)
    expect(
      customerCookie(
        request(`${CUSTOMER_SESSION_COOKIE}=customer@example.test`),
        CUSTOMER_SESSION_COOKIE,
      ),
    ).toBeNull()
    expect(customerCookie(request('other=value'), CUSTOMER_SESSION_COOKIE)).toBeNull()
  })
})

describe('production customer response cookies', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])(
    'isolates the session from Supabase bot cookies (provider first=%s)',
    async (providerFirst) => {
      const session = `__Host-bladeblend_customer_session=${'a'.repeat(64)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=None`
      const provider =
        '__cf_bm=provider-cookie; HttpOnly; Secure; Path=/; Domain=supabase.co; Expires=Thu, 10 Sep 2026 22:19:54 GMT'
      const headers = new Headers({ 'Content-Type': 'application/json' })
      for (const cookie of providerFirst ? [provider, session] : [session, provider])
        headers.append('Set-Cookie', cookie)
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"ok":true}', { headers })),
      )
      const response = await customerGateway(
        new Request('https://bladeblendstudio.se/api/customer-bookings', {
          method: 'POST',
          headers: {
            Origin: 'https://bladeblendstudio.se',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.10',
          },
          body: JSON.stringify({ action: 'list', accessToken: 'b'.repeat(64) }),
        }),
        {
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_ANON_KEY: 'anon',
          CUSTOMER_GATEWAY_SECRET: 'secret'.repeat(8),
        },
      )
      expect(response.status).toBe(200)
      expect(response.headers.getSetCookie()).toEqual([
        session.replace('SameSite=None', 'SameSite=Lax'),
      ])
      expect(response.headers.get('Set-Cookie')).not.toContain('Domain=')
      expect(response.headers.get('Set-Cookie')).not.toContain('__cf_bm')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    },
  )
})

async function localTransportConfig(): Promise<UserConfig> {
  // vite.config.ts is type-checked by tsconfig.node.json. A literal import would also check it under
  // the stricter options of tsconfig.tests.json, so load it by path and declare what it exports.
  const { default: config } = await vi.importActual<{ default: UserConfigFn }>('../../vite.config')
  if (typeof config !== 'function') throw new Error('Expected Vite config factory')
  return config({ command: 'serve', mode: 'test' })
}

describe('local first-party transport boundaries', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOMER_GATEWAY_PROXY_URL', 'http://127.0.0.1:8787')
    vi.stubEnv('LOCAL_SUPABASE_URL', '')
    vi.stubEnv('LOCAL_HTTPS_KEY', '')
    vi.stubEnv('LOCAL_HTTPS_CERT', '')
    vi.stubEnv('LOCAL_WORKER_DOCUMENTS', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['http://127.0.0.1:8787', 'https://localhost:8787', 'http://[::1]:8787'])(
    'accepts loopback Worker %s for both dev and preview',
    async (origin) => {
      vi.stubEnv('CUSTOMER_GATEWAY_PROXY_URL', origin)
      const config = await localTransportConfig()
      expect(config.server?.proxy).toEqual(config.preview?.proxy)
      expect(Object.keys(config.server?.proxy ?? {})).toEqual([
        '^/api/customer-bookings(?:\\?.*)?$',
        '^/api/bookings(?:\\?.*)?$',
        '^/api/cms/presentation(?:\\?.*)?$',
        '^/[0-9a-f]{64}(?:\\?.*)?$',
      ])
      for (const route of Object.values(config.server?.proxy ?? {})) {
        expect(route).toMatchObject({ target: origin, changeOrigin: false })
      }
    },
  )

  for (const setting of ['CUSTOMER_GATEWAY_PROXY_URL', 'LOCAL_SUPABASE_URL']) {
    it.each([
      'https://external.example',
      'http://127.0.0.1:8787/path',
      'http://user:password@localhost:8787',
      'ftp://localhost:8787',
    ])('rejects non-origin/local %s for ' + setting, async (value) => {
      vi.stubEnv(setting, value)
      await expect(localTransportConfig()).rejects.toThrow('must be a loopback origin')
    })
  }

  it('requires both local TLS files', async () => {
    vi.stubEnv('LOCAL_HTTPS_KEY', '/not-read-without-cert')
    await expect(localTransportConfig()).rejects.toThrow(
      'Set both LOCAL_HTTPS_KEY and LOCAL_HTTPS_CERT',
    )
  })

  it('real proxy isolates Supabase cookies and forwards only the exact public gateway routes', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'knc-proxy-test-'))
    const upstream = createHttpServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader(
        'Set-Cookie',
        '__Host-bladeblend_customer_session=not-from-customer-gateway; Path=/; Secure; HttpOnly',
      )
      response.end(
        JSON.stringify({
          cookie: request.headers.cookie,
          authorization: request.headers.authorization,
          url: request.url,
        }),
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    let vite: Awaited<ReturnType<typeof createViteServer>> | undefined
    try {
      const address = upstream.address()
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
      vi.stubEnv('LOCAL_SUPABASE_URL', `http://127.0.0.1:${address.port}`)
      vi.stubEnv('CUSTOMER_GATEWAY_PROXY_URL', `http://127.0.0.1:${address.port}`)
      vi.stubEnv('LOCAL_WORKER_DOCUMENTS', '1')
      const proxy = (await localTransportConfig()).server?.proxy
      if (!proxy) throw new Error('Expected the dev server proxy routes')
      vite = await createViteServer({
        configFile: false,
        cacheDir,
        appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
        logLevel: 'silent',
        server: { proxy, host: '127.0.0.1', port: 0, strictPort: true },
      })
      await vite.listen()
      const server = vite.httpServer?.address()
      if (!server || typeof server === 'string') throw new Error('Expected Vite TCP listener')
      const response = await fetch(`http://127.0.0.1:${server.port}/__supabase/echo?scope=public`, {
        headers: {
          Cookie: '__Host-bladeblend_customer_session=fixture; staff-auth=fixture',
          Authorization: 'Bearer fixture',
        },
      })
      expect(await response.json()).toEqual({
        authorization: 'Bearer fixture',
        url: '/echo?scope=public',
      })
      expect(response.headers.get('set-cookie')).toBeNull()
      for (const path of [
        '/api/customer-bookings',
        '/api/customer-bookings?x=1',
        '/api/cms/presentation',
        '/api/cms/presentation?x=1',
        '/',
        '/?lang=en&mode=dark',
        '/about',
        '/booking',
        '/my-bookings?lang=en',
        '/cms-public/source',
        `/${'a'.repeat(64)}`,
      ]) {
        const result = await fetch(`http://127.0.0.1:${server.port}${path}`, {
          headers: { Cookie: 'customer=fixture' },
        })
        expect(await result.json()).toMatchObject({ url: path, cookie: 'customer=fixture' })
        expect(result.headers.get('set-cookie')).toContain('__Host-bladeblend_customer_session=')
      }
      for (const path of [
        '/api/customer-bookings-extra',
        '/api/customer-bookings/nested',
        '/api/cms/presentation-extra',
        '/api/cms/presentation/nested',
        '/about-extra',
        '/booking/private',
        '/cms-public/source-extra',
        '/admin/cms',
        '/rest/v1/private',
        '/other',
      ]) {
        expect((await fetch(`http://127.0.0.1:${server.port}${path}`)).status).toBe(404)
      }
    } finally {
      await vite?.close()
      upstream.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      )
      rmSync(cacheDir, { recursive: true, force: true })
    }
  }, 15000)
})
