import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyState } from '../../supabase/functions/_shared/calendar'

const caller = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: caller.getUser },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({
          data: { role: 'barber', barber_id: 'victor', account_enabled: true },
          error: null,
        }),
      }
      return query
    },
  }),
}))

const SECRET = 'unit-state-secret'
let handler: (request: Request) => Promise<Response>
let config: Record<string, string>
beforeEach(async () => {
  vi.resetModules()
  caller.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'staff' } }, error: null })
  config = {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
    GOOGLE_OAUTH_CLIENT_ID: 'unit-client',
    CALENDAR_STATE_SECRET: SECRET,
  }
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
  await vi.importActual('../../supabase/functions/calendar-oauth-start/index.ts')
})
afterEach(() => vi.unstubAllGlobals())

function start(origin: string | null, authorization = 'Bearer barber-token'): Promise<Response> {
  return handler(
    new Request('https://edge.example.test/calendar-oauth-start', {
      method: 'POST',
      headers: { authorization, ...(origin === null ? {} : { origin }) },
      body: '{}',
    }),
  )
}

/** The origin the callback would redirect to: `return_to` of the signed state in the consent URL. */
async function returnTo(response: Response): Promise<string | undefined> {
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  expect(body).toMatchObject({ ok: true, url: expect.any(String) })
  const url = typeof body === 'object' && body !== null && 'url' in body ? String(body.url) : ''
  const payload = await verifyState(
    new URL(url).searchParams.get('state') ?? '',
    SECRET,
    600,
    Date.now(),
  )
  expect(payload?.barber_id).toBe('victor')
  return payload?.return_to
}

describe('Calendar OAuth start return origin', () => {
  it.each(['https://bladeblendstudio.se', 'https://www.bladeblendstudio.se'])(
    'returns the barber to the site origin %s by default',
    async (origin) => {
      expect(await returnTo(await start(origin))).toBe(origin)
    },
  )

  it('reads the site origins from PUBLIC_SITE_ORIGINS, which replaces the default list', async () => {
    config['PUBLIC_SITE_ORIGINS'] = ' https://salon.example.test , https://127.0.0.1:4197,'
    expect(await returnTo(await start('https://salon.example.test'))).toBe(
      'https://salon.example.test',
    )
    expect(await returnTo(await start('https://127.0.0.1:4197'))).toBe('https://127.0.0.1:4197')
    expect((await start('https://bladeblendstudio.se')).status).toBe(403)
  })

  it('signs the parsed origin, not the header text', async () => {
    expect(await returnTo(await start('https://BLADEBLENDSTUDIO.SE:443'))).toBe(
      'https://bladeblendstudio.se',
    )
  })

  it.each([
    'https://attacker.example',
    'https://bladeblendstudio.se.attacker.example',
    'https://bladeblendstudio.se@attacker.example',
    'https://admin.bladeblendstudio.se',
    'https://bladeblendstudio.se:8443',
    'https://localhost:5173',
  ])('refuses the foreign https origin %s and mints no consent link', async (origin) => {
    const response = await start(origin)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'origin_not_allowed' })
  })

  it('mints a link without a return origin when the caller sends no Origin', async () => {
    expect(await returnTo(await start(null))).toBeUndefined()
  })

  it.each(['http://localhost:5173', 'http://127.0.0.1:4173', 'http://attacker.example', 'null'])(
    'mints a link without a return origin for %s, also when it is listed',
    async (origin) => {
      expect(await returnTo(await start(origin))).toBeUndefined()
      config['PUBLIC_SITE_ORIGINS'] = `${origin},https://127.0.0.1:4197`
      expect(await returnTo(await start(origin))).toBeUndefined()
    },
  )

  it('keeps the caller gate ahead of the origin answer', async () => {
    const anonymous = await start('https://attacker.example', '')
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({ ok: false, error: 'unauthorized' })
    caller.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    expect((await start('https://attacker.example')).status).toBe(401)
  })

  it('lets only the panel read the answer', async () => {
    const allowed = await start('https://bladeblendstudio.se')
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://bladeblendstudio.se')
    const refused = await start('https://attacker.example')
    expect(refused.headers.has('access-control-allow-origin')).toBe(false)
  })
})
