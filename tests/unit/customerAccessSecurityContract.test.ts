import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { consumeBookingAccessLink } from '../../src/mybookings/accessLink'

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

  it('sends permanent root links through the durable external-action worker', () => {
    const gateway = readFileSync('supabase/functions/public-booking-actions/index.ts', 'utf8')
    const worker = readFileSync('supabase/functions/_shared/externalActions.ts', 'utf8')
    const outboxMigrationName = readdirSync('supabase/migrations').find((name) =>
      name.endsWith('_customer_access_outbox_ciphertext.sql'),
    )
    expect(outboxMigrationName).toBeDefined()
    const migration = readFileSync(`supabase/migrations/${outboxMigrationName}`, 'utf8')

    expect(worker).toContain('decryptCustomerAccessToken')
    expect(worker).toContain('customerAccessUrl(accessCode)')
    expect(worker).not.toContain('customerAccessUrl(action.access_code)')
    expect(worker).not.toContain('#booking_access=${action.access_code}')
    expect(gateway).toContain("service.rpc('rotate_customer_booking_access_token'")
    expect(gateway).toContain('p_access_code: code')
    expect(gateway).not.toContain('edgeRuntime.waitUntil(')
    expect(gateway).not.toContain('sendAccessEmail(')
    expect(migration).toContain("'customer_access_email_send'")
    expect(migration).toContain('customer_booking_access_tokens')
    expect(migration).toContain('payload = pg_catalog.jsonb_build_object(')
    expect(migration).toContain("'challenge_id', payload->'challenge_id'")
    expect(migration).toContain("'lang', payload->'lang'")
  })

  it('uses an opaque HttpOnly session cookie rather than browser storage for return visits', () => {
    const gateway = readFileSync('supabase/functions/public-booking-actions/index.ts', 'utf8')
    const adapter = readFileSync('src/mybookings/adapters/supabaseMyBookings.ts', 'utf8')
    const client = readFileSync('src/backend/supabaseClient.ts', 'utf8')
    const actionClient = readFileSync('src/backend/publicBookingActions.ts', 'utf8')
    expect(gateway).toContain('__Host-bladeblend_customer_session')
    expect(gateway).toContain('HttpOnly; Secure; SameSite=None')
    expect(gateway).toContain('sessionCookie(req)')
    expect(gateway).not.toContain('customer_email')
    expect(adapter).not.toContain('sessionStorage')
    expect(client).not.toContain("credentials: 'include'")
    expect(client).not.toContain("credentials: 'same-origin'")
    expect(actionClient).toContain("credentials: 'same-origin'")
    expect(gateway).toContain('establish_customer_booking_session')
    expect(gateway).not.toContain('Set-Cookie: ${CUSTOMER_SESSION_COOKIE}=${accessToken}')
  })

  it('uses permanent root links in access and booking-confirmation email paths', () => {
    const accessWorker = readFileSync('supabase/functions/_shared/externalActions.ts', 'utf8')
    const confirmationWorker = readFileSync('supabase/functions/send-confirmation/index.ts', 'utf8')

    expect(accessWorker).toContain('customerAccessUrl(accessCode)')
    expect(confirmationWorker).toContain("'customer_confirmation'")
    expect(confirmationWorker).toContain('customerAccessUrl')
    expect(confirmationWorker).not.toContain(
      "ctaHref: adminLink ? 'https://bladeblendstudio.se/admin' : 'https://bladeblendstudio.se'",
    )
  })
})

async function localTransportConfig() {
  const config = (await import('../../vite.config')).default
  if (typeof config !== 'function') throw new Error('Expected Vite config factory')
  return config({ command: 'serve', mode: 'test' })
}

describe('local first-party transport boundaries', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOMER_GATEWAY_PROXY_URL', 'http://127.0.0.1:8787')
    vi.stubEnv('LOCAL_SUPABASE_URL', '')
    vi.stubEnv('LOCAL_HTTPS_KEY', '')
    vi.stubEnv('LOCAL_HTTPS_CERT', '')
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

  it('real proxy isolates Supabase cookies and forwards only the exact customer routes', async () => {
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
      const config = await localTransportConfig()
      vite = await createViteServer({
        configFile: false,
        cacheDir,
        appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
        logLevel: 'silent',
        server: { proxy: config.server?.proxy, host: '127.0.0.1', port: 0, strictPort: true },
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
