import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type CmsPage } from '../../packages/content-contracts/src/cms'
import {
  BOOKING_ACTIONS,
  GATEWAY_RATE_LIMIT_PERIOD_SECONDS,
  customerGateway,
  gatewayError,
  type GatewayRateLimit,
} from '../../supabase/worker/customerGateway'
import worker, { PublicContent, isWorkerPath, maintenanceMode } from '../../supabase/worker/index'
import { ownHeaders } from '../../supabase/worker/responseHeaders'
import { NATIVE_PUBLIC_PATHS } from '../../modules/public-web/src/site/routeMetadata'

const SITE = 'https://bladeblendstudio.se'
const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const FILES: Readonly<Record<string, string>> = {
  '/index.html': read('index.html'),
  '/404.html': read('public/404.html'),
  '/500.html': read('public/500.html'),
  '/maintenance.html': read('public/maintenance.html'),
  '/contact.html': read('public/contact.html'),
  '/google-calendar.html': read('public/google-calendar.html'),
  '/sitemap.xml': read('public/sitemap.xml'),
  '/tokens.css': read('public/tokens.css'),
  '/info.css': read('public/info.css'),
}

/** The `/*` block of public/_headers: what the asset layer gives every deployed file. */
const FILE_HEADERS = new Map(
  (read('public/_headers').split(/\n(?=\S)/)[0] ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const colon = line.indexOf(':')
      return [line.slice(0, colon), line.slice(colon + 1).trim()] as const
    }),
)
const HSTS = FILE_HEADERS.get('Strict-Transport-Security')
const NOSNIFF = FILE_HEADERS.get('X-Content-Type-Options')

function expectOwnHeaders(response: Response): void {
  expect(response.headers.get('Strict-Transport-Security')).toBe(HSTS)
  expect(response.headers.get('X-Content-Type-Options')).toBe(NOSNIFF)
}

interface Vars {
  readonly MAINTENANCE?: string
  readonly CUSTOMER_GATEWAY_SECRET?: string
  readonly GATEWAY_RATE_LIMIT?: GatewayRateLimit
}

/** ASSETS answers GET and HEAD for a file, a 405 naming no method otherwise, and 404 without a
 *  file; a path in `broken` fails as an unreachable asset layer. */
function createEnv(
  vars: Vars = {},
  files: Readonly<Record<string, string>> = FILES,
  broken: readonly string[] = [],
) {
  const requested: string[] = []
  return {
    requested,
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_ANON_KEY: 'fixture-anon-key',
    ...vars,
    ASSETS: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const request = input instanceof Request ? input : new Request(input)
        const path = new URL(request.url).pathname
        requested.push(path)
        if (broken.includes(path)) throw new Error('The asset layer cannot be reached')
        const body = files[path]
        if (body === undefined) return new Response('Not found', { status: 404 })
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return new Response(null, { status: 405 })
        return new Response(body, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"deployed"' },
        })
      },
    },
  }
}
type TestEnv = ReturnType<typeof createEnv>
type WorkerContext = Parameters<typeof worker.fetch>[2]

// For routes that never use PublicContent; a call would show only as the failure page's status.
const noPublicContent: WorkerContext = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}

const brokenPublicContent: WorkerContext = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Worker exceeded CPU time limit')),
    },
  },
}

/** The cached public-content entrypoint, as production routes to it. */
function cached(env: TestEnv): WorkerContext {
  const publicContent = new PublicContent({} as never, env)
  return {
    exports: { PublicContent: { fetch: (request: Request) => publicContent.fetch(request) } },
  }
}

/** The last URL segment picks the answer from `answers`; any other call fails. */
function stubSupabase(answers: Readonly<Record<string, () => Response>> = {}): string[] {
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const name = (input instanceof Request ? input.url : String(input)).split('/').at(-1) ?? ''
    calls.push(name)
    return answers[name]?.() ?? new Response(null, { status: 503 })
  })
  return calls
}

function errorLog() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

const BARBER = '20000000-0000-4000-8000-000000000001'
const DISCOVERY = {
  settings: {
    business_name: 'Aktuell Salong',
    business_street: 'Nygatan 12',
    business_postal_code: '211 22',
    business_city: 'Malmö',
    business_phone_display: '040-123 45 67',
    business_phone_tel: '0401234567',
    business_email: 'owner@example.test',
  },
  barbers: [{ id: BARBER, name: 'Ada' }],
  services: [{ id: '30000000-0000-4000-8000-000000000001', barber_id: BARBER, price: 987 }],
  schedules: [{ barber_id: BARBER, weekday: 1, start_min: 600, end_min: 720 }],
}
const terms: CmsPage = {
  id: '10000000-0000-4000-8000-000000000006',
  kind: 'terms',
  path: '/terms',
  name: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  title: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  description: { sv: '', en: '' },
  inMenu: false,
  content: {
    sv: {
      html: '<main><h1>Bokningsvillkor</h1></main>',
      css: { light: 'body{color:#111}', dark: 'body{color:#eee}' },
    },
    en: {
      html: '<main><h1>Booking terms</h1></main>',
      css: { light: 'body{color:#111}', dark: 'body{color:#eee}' },
    },
  },
}
const publication = (pages: readonly CmsPage[] = []) => ({
  public_cms_presentation: () =>
    Response.json({ revision: 7, presentation: { ...emptyDocument().presentation, pages } }),
})
const REVISION_21 = '{"revision": 21, "presentation": {"pages": []}}'
const TOKEN = 'a'.repeat(64)
const CLIENT = '203.0.113.10'
const GATEWAY = { CUSTOMER_GATEWAY_SECRET: 'secret'.repeat(8) } as const

function gatewayRequest(
  path: '/api/customer-bookings' | '/api/bookings',
  body: unknown,
  ip: string | null = CLIENT,
): Request {
  const headers = new Headers({ Origin: SITE, 'Content-Type': 'application/json' })
  if (ip !== null) headers.set('CF-Connecting-IP', ip)
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function limiter(allowed: number): { readonly keys: string[]; readonly binding: GatewayRateLimit } {
  const keys: string[] = []
  return {
    keys,
    binding: {
      async limit({ key }) {
        keys.push(key)
        return { success: keys.filter((counted) => counted === key).length <= allowed }
      },
    },
  }
}

const wranglerConfig = JSON.parse(
  read('wrangler.jsonc')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1'),
) as {
  readonly vars: Readonly<Record<string, string>>
  readonly ratelimits?: readonly {
    readonly name: string
    readonly namespace_id: string
    readonly simple: { readonly limit: number; readonly period: number }
  }[]
}

// No test reaches the network: an unanswered read fails as an unreachable database does.
beforeEach(() => {
  stubSupabase()
})
afterEach(() => vi.restoreAllMocks())

describe('the security headers of a response the Worker builds itself (W2-6, W2-11)', () => {
  it('owns the two values public/_headers gives every deployed file', () => {
    expect(HSTS).toMatch(/^max-age=\d+/)
    expect(NOSNIFF).toBe('nosniff')
    expect([...ownHeaders()]).toEqual([
      ['strict-transport-security', HSTS],
      ['x-content-type-options', NOSNIFF],
    ])
  })

  it('keeps the headers it is given and never lets them replace the two', () => {
    const headers = ownHeaders({
      Location: 'https://bladeblendstudio.se/',
      'X-Content-Type-Options': 'sniff',
      'strict-transport-security': 'max-age=0',
    })
    expect(headers.get('Location')).toBe('https://bladeblendstudio.se/')
    expect(headers.get('Strict-Transport-Security')).toBe(HSTS)
    expect(headers.get('X-Content-Type-Options')).toBe(NOSNIFF)
  })

  const get = (url: string, context = noPublicContent, env = createEnv()): Promise<Response> =>
    worker.fetch(new Request(url), env, context)
  const accepting = (path: string, accept: string): Promise<Response> =>
    worker.fetch(
      new Request(`${SITE}${path}`, { headers: { Accept: accept } }),
      createEnv(),
      noPublicContent,
    )
  const viaCache = (path: string, method = 'GET'): Promise<Response> => {
    const env = createEnv()
    return worker.fetch(new Request(`${SITE}${path}`, { method }), env, cached(env))
  }

  const built: readonly (readonly [string, number, () => Promise<Response>])[] = [
    ['the redirect from the www host', 308, () => get('https://www.bladeblendstudio.se/about')],
    ['the redirect from a trailing slash', 308, () => get(`${SITE}/about/`)],
    ['the redirect from a file name', 308, () => get(`${SITE}/index.html`)],
    ['the redirect of a customer link', 302, () => get(`${SITE}/${TOKEN}`)],
    [
      'the 404 page',
      404,
      () => {
        stubSupabase()
        return get(`${SITE}/not-a-route`)
      },
    ],
    [
      'the Markdown 404',
      404,
      () => {
        stubSupabase()
        return accepting('/not-a-route', 'text/markdown')
      },
    ],
    [
      'a Markdown page',
      200,
      () => {
        stubSupabase()
        return accepting('/about', 'text/markdown')
      },
    ],
    ['the 406', 406, () => accepting('/about', 'application/json')],
    [
      'the 405 of the presentation',
      405,
      () =>
        worker.fetch(
          new Request(`${SITE}/api/cms/presentation`, { method: 'POST' }),
          createEnv(),
          noPublicContent,
        ),
    ],
    [
      'the 503 of the presentation',
      503,
      () => {
        stubSupabase()
        return get(`${SITE}/api/cms/presentation`)
      },
    ],
    [
      'the presentation',
      200,
      () => {
        stubSupabase({ public_cms_presentation: () => new Response(REVISION_21) })
        return get(`${SITE}/api/cms/presentation`)
      },
    ],
    [
      'one revision of the presentation',
      200,
      () => {
        stubSupabase({ public_cms_presentation: () => new Response(REVISION_21) })
        return viaCache('/api/cms/presentation?rev=21')
      },
    ],
    [
      'the generated llms.txt',
      200,
      () => {
        stubSupabase({ public_business_discovery: () => Response.json(DISCOVERY) })
        return viaCache('/llms.txt')
      },
    ],
    [
      'the generated sitemap',
      200,
      () => {
        stubSupabase(publication())
        return viaCache('/sitemap.xml')
      },
    ],
    ['the sitemap to HEAD', 200, () => viaCache('/sitemap.xml', 'HEAD')],
    [
      'security.txt',
      200,
      () => {
        stubSupabase({ public_business_discovery: () => Response.json(DISCOVERY) })
        return viaCache('/.well-known/security.txt')
      },
    ],
    [
      'security.txt when the business cannot be read',
      200,
      () => {
        stubSupabase()
        return viaCache('/.well-known/security.txt')
      },
    ],
    ['security.txt to HEAD', 200, () => viaCache('/.well-known/security.txt', 'HEAD')],
    [
      'security.txt when the cached entrypoint fails',
      200,
      () => get(`${SITE}/.well-known/security.txt`, brokenPublicContent),
    ],
    ['the 405 of the gateway', 405, () => get(`${SITE}/api/customer-bookings`)],
    [
      'the 503 of the gateway',
      503,
      () =>
        worker.fetch(
          gatewayRequest('/api/customer-bookings', { action: 'list' }),
          createEnv(),
          noPublicContent,
        ),
    ],
    [
      'the 429 of the gateway',
      429,
      () =>
        worker.fetch(
          gatewayRequest('/api/customer-bookings', { action: 'list' }),
          createEnv({ ...GATEWAY, GATEWAY_RATE_LIMIT: limiter(0).binding }),
          noPublicContent,
        ),
    ],
    [
      'an answer the gateway relays',
      200,
      () => {
        stubSupabase({ 'public-booking-actions': () => Response.json({ ok: true }) })
        return worker.fetch(
          gatewayRequest('/api/customer-bookings', { action: 'list' }),
          createEnv(GATEWAY),
          noPublicContent,
        )
      },
    ],
    [
      'the 405 of a deployed file',
      405,
      () =>
        worker.fetch(
          new Request(`${SITE}/contact`, { method: 'POST' }),
          createEnv(),
          noPublicContent,
        ),
    ],
    [
      'the failure page',
      500,
      () => {
        errorLog()
        return get(`${SITE}/login`, noPublicContent, brokenAt('/login'))
      },
    ],
    [
      'the failure in plain text',
      500,
      () => {
        errorLog()
        return get(`${SITE}/login`, noPublicContent, brokenAt('/login', '/500.html'))
      },
    ],
    [
      'the failure as JSON',
      500,
      () => {
        errorLog()
        return get(`${SITE}/api/x`, noPublicContent, brokenAt('/api/x'))
      },
    ],
    [
      'the maintenance page',
      503,
      () => get(`${SITE}/`, noPublicContent, createEnv({ MAINTENANCE: 'on' })),
    ],
    [
      'maintenance as JSON',
      503,
      () => get(`${SITE}/api/bookings`, noPublicContent, createEnv({ MAINTENANCE: 'on' })),
    ],
  ]

  it.each(built)('%s carries both (status %i)', async (_label, status, respond) => {
    const response = await respond()
    expect(response.status).toBe(status)
    expectOwnHeaders(response)
  })

  // The content, frame and embedding policies of public/_headers describe a document.
  it.each([
    ['a redirect', () => get(`${SITE}/about/`)],
    ['gateway JSON', () => get(`${SITE}/api/customer-bookings`)],
    ['security.txt', () => viaCache('/.well-known/security.txt', 'HEAD')],
  ] as const)('leaves the document policies off %s', async (_label, respond) => {
    const response = await respond()
    for (const name of FILE_HEADERS.keys()) {
      if (name === 'Strict-Transport-Security' || name === 'X-Content-Type-Options') continue
      expect(response.headers.has(name), name).toBe(false)
    }
  })
})

function brokenAt(...paths: readonly string[]): TestEnv {
  return createEnv({}, FILES, paths)
}

describe('a request whose handling fails (W2-1)', () => {
  const expectFailurePage = async (response: Response, body: string): Promise<void> => {
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    // The validator of the deployed file does not describe a 500.
    expect(response.headers.has('ETag')).toBe(false)
    expect(response.headers.has('Retry-After')).toBe(false)
    expect(await response.text()).toBe(body)
  }

  // Workers Logs get only the caught error, never the request: its path can be a customer's
  // credential. toEqual matches an Error by name and message.
  const ASSET_FAILURE = new Error('The asset layer cannot be reached')
  const rejecting = (error: Error): WorkerContext => ({
    exports: { PublicContent: { fetch: () => Promise.reject(error) } },
  })

  it.each(['GET', 'HEAD'])(
    'answers %s with status 500 and the deployed 500 page when the asset layer throws',
    async (method) => {
      const logged = errorLog()
      const env = brokenAt('/login')
      const response = await worker.fetch(
        new Request(`${SITE}/login`, { method }),
        env,
        noPublicContent,
      )
      await expectFailurePage(response, method === 'HEAD' ? '' : (FILES['/500.html'] ?? ''))
      expect(env.requested).toEqual(['/login', '/500.html'])
      expect(logged.mock.calls).toEqual([[ASSET_FAILURE]])
    },
  )

  it('answers with the 500 page when a published page cannot get its base stylesheet', async () => {
    const logged = errorLog()
    stubSupabase(publication([terms]))
    const files = Object.fromEntries(Object.entries(FILES).filter(([path]) => path !== '/info.css'))
    const response = await worker.fetch(
      new Request(`${SITE}/terms`),
      createEnv({}, files),
      noPublicContent,
    )
    await expectFailurePage(response, FILES['/500.html'] ?? '')
    expect(logged.mock.calls).toEqual([[new Error('Legal base stylesheet /info.css answered 404')]])
  })

  it('answers with the 500 page when the cached entrypoint fails on a path without a fallback', async () => {
    const logged = errorLog()
    const thrown = new Error('Worker exceeded CPU time limit')
    const response = await worker.fetch(
      new Request(`${SITE}/llms.txt`),
      createEnv(),
      rejecting(thrown),
    )
    await expectFailurePage(response, FILES['/500.html'] ?? '')
    expect(logged).toHaveBeenCalledOnce()
    expect(logged.mock.calls[0]).toHaveLength(1)
    expect(logged.mock.calls[0]?.[0]).toBe(thrown)
  })

  it.each([
    ['is not deployed', (): TestEnv => createEnv({}, { '/index.html': 'shell' }, ['/login'])],
    ['cannot be read', (): TestEnv => brokenAt('/login', '/500.html')],
  ])('answers in plain text, in both languages, when the 500 page %s', async (_label, env) => {
    const logged = errorLog()
    const response = await worker.fetch(new Request(`${SITE}/login`), env(), noPublicContent)
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(await response.text()).toBe(
      'Något gick fel. Försök igen om en stund.\nSomething went wrong. Please try again shortly.\n',
    )
    // The 500 page that cannot be read is not a second failure: the one caught is logged once.
    expect(logged.mock.calls).toEqual([[ASSET_FAILURE]])
  })

  it('answers an /api/ path with the JSON the gateway clients read', async () => {
    const logged = errorLog()
    const env = brokenAt('/api/unknown')
    const response = await worker.fetch(new Request(`${SITE}/api/unknown`), env, noPublicContent)
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: false, error: 'system' })
    expect(env.requested).toEqual(['/api/unknown'])
    expect(logged.mock.calls).toEqual([[ASSET_FAILURE]])
  })

  it('answers the presentation path with the JSON its failed read has always had', async () => {
    const logged = errorLog()
    const thrown = new Error('Worker exceeded CPU time limit')
    const env = createEnv()
    const response = await worker.fetch(
      new Request(`${SITE}/api/cms/presentation?rev=21`),
      env,
      rejecting(thrown),
    )
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'unavailable' })
    expect(env.requested).toEqual([])
    expect(logged).toHaveBeenCalledOnce()
    expect(logged.mock.calls[0]).toHaveLength(1)
    expect(logged.mock.calls[0]?.[0]).toBe(thrown)
  })

  it('leaves a request that does not fail as it was (control)', async () => {
    stubSupabase()
    const response = await worker.fetch(new Request(`${SITE}/login`), createEnv(), noPublicContent)
    expect(response.status).toBe(200)
  })

  const answer = (request: Request, env: TestEnv = createEnv()): Promise<Response> =>
    worker.fetch(request, env, noPublicContent)

  it.each([
    ['a request that does not fail', 200, () => answer(new Request(`${SITE}/login`))],
    [
      'a maintenance answer',
      503,
      () => answer(new Request(`${SITE}/`), createEnv({ MAINTENANCE: 'on' })),
    ],
    ['a 404', 404, () => answer(new Request(`${SITE}/not-a-route`))],
    ['a 405', 405, () => answer(new Request(`${SITE}/contact`, { method: 'POST' }))],
    [
      'a 429 of the gateway',
      429,
      () =>
        answer(
          gatewayRequest('/api/customer-bookings', { action: 'list' }),
          createEnv({ ...GATEWAY, GATEWAY_RATE_LIMIT: limiter(0).binding }),
        ),
    ],
    [
      'a 503 of the gateway',
      503,
      () => answer(gatewayRequest('/api/customer-bookings', { action: 'list' })),
    ],
  ] as const)('logs nothing for %s (control, status %i)', async (_label, status, respond) => {
    const logged = errorLog()
    expect((await respond()).status).toBe(status)
    expect(logged).not.toHaveBeenCalled()
  })
})

describe('the maintenance switch (W2-2)', () => {
  it('is on for the value "on" alone', () => {
    expect(maintenanceMode('on')).toBe('on')
    for (const value of [undefined, '', 'off', 'ON', 'On', ' on', 'on ', 'true', '1', 'yes'])
      expect(maintenanceMode(value), JSON.stringify(value)).toBe('off')
  })

  // The owner commits "on" in wrangler.jsonc; a misspelt value would leave the site open silently.
  it('ships set to exactly "on" or "off"', () => {
    expect(['on', 'off']).toContain(wranglerConfig.vars['MAINTENANCE'])
  })

  const closed = (): TestEnv => createEnv({ ...GATEWAY, MAINTENANCE: 'on' })
  const expectClosed = (response: Response): void => {
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('3600')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  }

  it.each([
    ['GET', `${SITE}/`],
    ['GET', `${SITE}/about?lang=en`],
    ['GET', `${SITE}/terms`],
    ['GET', `${SITE}/contact`],
    ['GET', `${SITE}/admin/cms`],
    ['GET', `${SITE}/not-a-route`],
    ['GET', `${SITE}/about/`],
    ['GET', `${SITE}/${TOKEN}`],
    ['GET', `${SITE}/sitemap.xml`],
    ['GET', `${SITE}/.well-known/security.txt`],
    ['GET', `${SITE}/llms.txt`],
    ['GET', `${SITE}/500.html`],
    ['GET', 'https://www.bladeblendstudio.se/booking'],
    ['POST', `${SITE}/contact`],
  ])(
    'answers %s %s with 503, Retry-After and the maintenance page, reading nothing else',
    async (method, url) => {
      const calls = stubSupabase(publication([terms]))
      const env = closed()
      const response = await worker.fetch(new Request(url, { method }), env, noPublicContent)
      expectClosed(response)
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
      expect(response.headers.has('Location')).toBe(false)
      expect(response.headers.has('ETag')).toBe(false)
      expect(await response.text()).toBe(FILES['/maintenance.html'])
      expect(env.requested).toEqual(['/maintenance.html'])
      expect(calls).toEqual([])
    },
  )

  it('answers HEAD with the same status and headers and no body', async () => {
    const response = await worker.fetch(
      new Request(`${SITE}/`, { method: 'HEAD' }),
      closed(),
      noPublicContent,
    )
    expectClosed(response)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toBe('')
  })

  it.each([
    [
      'a booking action',
      (): Request => gatewayRequest('/api/customer-bookings', { action: 'list' }),
    ],
    ['a booking submission', (): Request => gatewayRequest('/api/bookings', { name: 'Ada' })],
    ['an unknown /api/ path', (): Request => new Request(`${SITE}/api/unknown`)],
  ])(
    'answers %s with 503, Retry-After and the gateway JSON, calling nothing',
    async (_label, request) => {
      const calls = stubSupabase({ 'public-booking-actions': () => Response.json({ ok: true }) })
      const env = closed()
      const response = await worker.fetch(request(), env, noPublicContent)
      expectClosed(response)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
      expect(await response.json()).toEqual({ ok: false, error: 'maintenance' })
      expect(calls).toEqual([])
      expect(env.requested).toEqual([])
    },
  )

  it.each(['', '?rev=21'])(
    'answers the presentation%s with 503, the hour of maintenance and its own JSON',
    async (search) => {
      const calls = stubSupabase({ public_cms_presentation: () => new Response(REVISION_21) })
      const response = await worker.fetch(
        new Request(`${SITE}/api/cms/presentation${search}`),
        closed(),
        noPublicContent,
      )
      expectClosed(response)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(await response.json()).toEqual({ error: 'unavailable' })
      expect(calls).toEqual([])
    },
  )

  it('answers in plain text, in both languages, when the maintenance page cannot be read', async () => {
    const response = await worker.fetch(
      new Request(`${SITE}/`),
      createEnv({ MAINTENANCE: 'on' }, FILES, ['/maintenance.html']),
      noPublicContent,
    )
    expectClosed(response)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await response.text()).toBe(
      'Webbplatsen är tillfälligt stängd för underhåll. Försök igen om en stund.\n' +
        'The site is temporarily down for maintenance. Please try again shortly.\n',
    )
  })

  it.each([undefined, 'off', 'ON', 'true'])(
    'leaves the site open when the variable is %j (control)',
    async (value) => {
      stubSupabase()
      const response = await worker.fetch(
        new Request(`${SITE}/login`),
        createEnv(value === undefined ? {} : { MAINTENANCE: value }),
        noPublicContent,
      )
      expect(response.status).toBe(200)
      expect(response.headers.has('Retry-After')).toBe(false)
    },
  )
})

describe('Retry-After on every 503 (W2-3)', () => {
  const failures: readonly (readonly [string, () => Response | Promise<Response>])[] = [
    ['answers 503', () => new Response('boom', { status: 503 })],
    ['cannot be reached', () => Promise.reject(new TypeError('fetch failed'))],
  ]

  it.each(
    failures.flatMap(([label, upstream]) =>
      (['GET', 'HEAD'] as const).map((method) => [method, label, upstream] as const),
    ),
  )(
    'tells a %s of the presentation to ask again in a second when the database %s',
    async (method, _label, upstream) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => upstream())
      const response = await worker.fetch(
        new Request(`${SITE}/api/cms/presentation`, { method }),
        createEnv(),
        noPublicContent,
      )
      expect(response.status).toBe(503)
      expect(response.headers.get('Retry-After')).toBe('1')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      const body = await response.text()
      expect(body).toBe(method === 'HEAD' ? '' : '{"error":"unavailable"}')
    },
  )

  it('says the same for one revision, through the cached entrypoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('boom', { status: 503 }),
    )
    const env = createEnv()
    const response = await worker.fetch(
      new Request(`${SITE}/api/cms/presentation?rev=21`),
      env,
      cached(env),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('1')
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false)
  })

  it('says the same when the read of one revision is cut off after its first bytes', async () => {
    const opening = new TextEncoder().encode('{"revision": 21, "presentation": {"pages": [')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      let sent = false
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent) controller.error(new Error('The operation was aborted due to timeout'))
            else controller.enqueue(opening)
            sent = true
          },
        }),
      )
    })
    const env = createEnv()
    const response = await worker.fetch(
      new Request(`${SITE}/api/cms/presentation?rev=21`),
      env,
      cached(env),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('1')
    expect(await response.json()).toEqual({ error: 'unavailable' })
  })

  it('sends no Retry-After with a presentation that was read (control)', async () => {
    stubSupabase({ public_cms_presentation: () => new Response(REVISION_21) })
    const response = await worker.fetch(
      new Request(`${SITE}/api/cms/presentation`),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(response.headers.has('Retry-After')).toBe(false)
  })

  it.each([
    ['no signing secret', {}],
    ['a signing secret that is too short', { CUSTOMER_GATEWAY_SECRET: 'short' }],
  ])('tells a client of a gateway with %s to ask again in five minutes', async (_label, vars) => {
    const calls = stubSupabase()
    for (const path of ['/api/customer-bookings', '/api/bookings'] as const) {
      const response = await worker.fetch(
        gatewayRequest(path, { action: 'list' }),
        createEnv(vars),
        noPublicContent,
      )
      expect(response.status).toBe(503)
      expect(response.headers.get('Retry-After')).toBe('300')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({ ok: false, error: 'not_configured' })
    }
    expect(calls).toEqual([])
  })

  // Edge answers 503 only for a function without its secrets; the other rows are controls.
  it.each([
    [503, '300'],
    [500, null],
    [200, null],
  ] as const)('relays a %i from Edge with Retry-After %j', async (status, retryAfter) => {
    stubSupabase({
      'public-booking-actions': () => Response.json({ ok: status === 200 }, { status }),
    })
    const response = await worker.fetch(
      gatewayRequest('/api/customer-bookings', { action: 'list' }),
      createEnv(GATEWAY),
      noPublicContent,
    )
    expect(response.status).toBe(status)
    expect(response.headers.get('Retry-After')).toBe(retryAfter)
    expect(await response.json()).toEqual({ ok: status === 200 })
  })
})

describe('Allow on every 405 (W2-4)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'names GET and HEAD when the presentation refuses %s, without a read',
    async (method) => {
      const calls = stubSupabase({ public_cms_presentation: () => new Response(REVISION_21) })
      const response = await worker.fetch(
        new Request(`${SITE}/api/cms/presentation`, { method }),
        createEnv(),
        noPublicContent,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, HEAD')
      expect(await response.text()).toBe('')
      expect(calls).toEqual([])
    },
  )

  it.each(
    (['/api/customer-bookings', '/api/bookings'] as const).flatMap((path) =>
      ['GET', 'HEAD', 'PUT', 'DELETE'].map((method) => [method, path] as const),
    ),
  )('names POST when the gateway refuses %s %s', async (method, path) => {
    const calls = stubSupabase()
    const response = await worker.fetch(
      new Request(`${SITE}${path}`, { method, headers: { Origin: SITE } }),
      createEnv(GATEWAY),
      noPublicContent,
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(response.headers.get('Content-Type')).toBe('application/json')
    if (method !== 'HEAD')
      expect(await response.json()).toEqual({ ok: false, error: 'method_not_allowed' })
    expect(calls).toEqual([])
  })

  it.each(['/', '/contact', '/google-calendar', '/sitemap.xml', '/500.html'])(
    'names GET and HEAD when the asset layer refuses a POST to %s',
    async (path) => {
      stubSupabase()
      const response = await worker.fetch(
        new Request(`${SITE}${path}`, { method: 'POST' }),
        createEnv(),
        noPublicContent,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, HEAD')
    },
  )

  const offers: CmsPage = {
    ...terms,
    id: '10000000-0000-4000-8000-000000000008',
    kind: 'page',
    path: '/offers',
  }
  /** Paths whose GET the Worker answers itself; /offers is a published created page. */
  const WORKER_PATHS = [
    ...NATIVE_PUBLIC_PATHS,
    '/admin',
    '/admin/cms',
    '/admin/settings',
    '/login',
    '/reset',
    '/invite',
    '/auth/confirm',
    '/.well-known/security.txt',
    '/cms-public/source',
    `/${TOKEN}`,
    '/offers',
  ]
  const REFUSED = ['POST', 'PUT', 'PATCH', 'DELETE']

  it('isWorkerPath holds for the paths the Worker answers without a file, not a file-backed or unknown path', () => {
    for (const path of WORKER_PATHS.filter((path) => path !== '/offers'))
      expect(isWorkerPath(path), path).toBe(true)
    for (const path of [
      '/offers',
      '/not-a-route',
      '/contact',
      '/privacy',
      '/terms',
      '/google-calendar',
      '/llms.txt',
      '/sitemap.xml',
      '/404.html',
      '/api/cms/presentation',
      '/administrator',
      `/${TOKEN}/extra`,
    ])
      expect(isWorkerPath(path), path).toBe(false)
  })

  it.each(REFUSED.flatMap((method) => WORKER_PATHS.map((path) => [method, path] as const)))(
    'names GET and HEAD when the Worker refuses %s %s, with no body and no read GET does not make',
    async (method, path) => {
      const env = createEnv()
      const getReads = stubSupabase(publication([offers]))
      const served = await worker.fetch(new Request(`${SITE}${path}`), env, cached(env))
      expect(served.status).toBeLessThan(400)
      const calls = stubSupabase(publication([offers]))
      const response = await worker.fetch(
        new Request(`${SITE}${path}`, { method }),
        createEnv(),
        noPublicContent,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, HEAD')
      expectOwnHeaders(response)
      expect(await response.text()).toBe('')
      expect(calls.filter((call) => !getReads.includes(call))).toEqual([])
    },
  )

  it.each(['/admin', '/admin/settings', '/login', '/reset', '/invite', '/auth/confirm'])(
    'keeps the noindex of POST %s on its 405',
    async (path) => {
      const response = await worker.fetch(
        new Request(`${SITE}${path}`, { method: 'POST' }),
        createEnv(),
        noPublicContent,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    },
  )

  it.each(['GET', 'HEAD'].flatMap((method) => WORKER_PATHS.map((path) => [method, path] as const)))(
    'answers %s %s without a 405 or Allow (control)',
    async (method, path) => {
      stubSupabase(publication([offers]))
      const env = createEnv()
      const response = await worker.fetch(
        new Request(`${SITE}${path}`, { method }),
        env,
        cached(env),
      )
      expect(response.status).toBeLessThan(400)
      expect(response.headers.has('Allow')).toBe(false)
    },
  )

  it.each(
    REFUSED.flatMap((method) =>
      ['/not-a-route', '/offers', '/api/not-a-route', '/.well-known/not-a-file'].map(
        (path) => [method, path] as const,
      ),
    ),
  )(
    'answers %s %s, which names nothing, with 404 and no read GET does not make (control)',
    async (method, path) => {
      const env = createEnv()
      const getReads = stubSupabase(publication())
      const missing = await worker.fetch(new Request(`${SITE}${path}`), env, cached(env))
      expect(missing.status).toBe(404)
      const calls = stubSupabase(publication())
      const response = await worker.fetch(
        new Request(`${SITE}${path}`, { method }),
        createEnv(),
        noPublicContent,
      )
      expect(response.status).toBe(404)
      expect(response.headers.has('Allow')).toBe(false)
      expect(calls.filter((call) => !getReads.includes(call))).toEqual([])
    },
  )

  it.each(['/llms.txt', '/privacy', '/terms'])(
    'leaves the 405 to POST %s to its deployed file (control)',
    async (path) => {
      const files = {
        ...FILES,
        '/llms.txt': read('public/llms.txt'),
        '/privacy.html': read('public/privacy.html'),
        '/terms.html': read('public/terms.html'),
      }
      const response = await worker.fetch(
        new Request(`${SITE}${path}`, { method: 'POST' }),
        createEnv({}, files),
        noPublicContent,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, HEAD')
    },
  )

  it.each([
    ['/booking', 404],
    ['/', 405],
  ] as const)('answers OPTIONS %s as the asset layer does (control)', async (path, status) => {
    const response = await worker.fetch(
      new Request(`${SITE}${path}`, { method: 'OPTIONS' }),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(status)
  })

  it('adds no Allow to an answer that is not a 405 (control)', async () => {
    stubSupabase()
    for (const method of ['GET', 'HEAD', ...REFUSED]) {
      const response = await worker.fetch(
        new Request(`${SITE}/not-a-route`, { method }),
        createEnv(),
        noPublicContent,
      )
      expect(response.status).toBe(404)
      expect(response.headers.has('Allow')).toBe(false)
    }
  })
})

describe('the outage pages under their own file names (W2-9)', () => {
  it.each(['/500.html', '/maintenance.html'])(
    'serves %s with status 200, its body and noindex',
    async (path) => {
      stubSupabase()
      for (const method of ['GET', 'HEAD']) {
        const env = createEnv()
        const response = await worker.fetch(
          new Request(`${SITE}${path}`, { method }),
          env,
          noPublicContent,
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
        expect(env.requested).toEqual([path])
        // The asset layer drops the body of its own answer to HEAD; this stand-in does not.
        if (method === 'GET') expect(await response.text()).toBe(FILES[path])
      }
    },
  )

  it('keeps another deployed file without that header (control)', async () => {
    stubSupabase()
    const response = await worker.fetch(
      new Request(`${SITE}/tokens.css`),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(response.headers.has('X-Robots-Tag')).toBe(false)
  })
})

describe('the limit in front of the customer gateway (W2-7)', () => {
  const relayed = (): string[] =>
    stubSupabase({
      'public-booking-actions': () => Response.json({ ok: true }),
      'submit-booking': () => Response.json({ ok: true }),
    })
  const env = (binding?: GatewayRateLimit) => ({
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_ANON_KEY: 'fixture-anon-key',
    ...GATEWAY,
    ...(binding === undefined ? {} : { GATEWAY_RATE_LIMIT: binding }),
  })
  const act = (body: unknown, binding?: GatewayRateLimit, ip: string | null = CLIENT) =>
    customerGateway(gatewayRequest('/api/customer-bookings', body, ip), env(binding))

  it('counts every booking action under its own name and the client address', async () => {
    const calls = relayed()
    const { keys, binding } = limiter(Infinity)
    for (const action of BOOKING_ACTIONS) {
      const response = await act({ action }, binding)
      expect(response.status).toBe(200)
    }
    expect((await act({ action: 'list' }, binding, '198.51.100.7')).status).toBe(200)
    expect(keys).toEqual([
      ...BOOKING_ACTIONS.map((action) => `${action}:${CLIENT}`),
      'list:198.51.100.7',
    ])
    expect(calls).toHaveLength(BOOKING_ACTIONS.length + 1)
  })

  // One customer line usually holds a whole /64, so IPv6 is counted by its first four groups in one
  // spelling; IPv4 written as IPv6 is counted as the plain IPv4 address.
  it.each([
    ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3:8d3::/64'],
    ['2001:0DB8:85A3:08D3:1319:8A2E:0370:7348', '2001:db8:85a3:8d3::/64'],
    ['2001:db8:85a3:8d3::7348', '2001:db8:85a3:8d3::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['2001:DB8:0:0:FFFF::', '2001:db8:0:0::/64'],
    ['2001:db8::', '2001:db8:0:0::/64'],
    ['::2:3:4:5:6:7:8', '0:2:3:4::/64'],
    ['1:2:3:4:5:6:7::', '1:2:3:4::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['64:ff9b::203.0.113.10', '64:ff9b:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['::ffff:203.0.113.10', CLIENT],
    ['::FFFF:cb00:710a', CLIENT],
    ['0:0:0:0:0:ffff:203.0.113.10', CLIENT],
    [CLIENT, CLIENT],
    ['198.51.100.7', '198.51.100.7'],
  ])('counts the client address %s under %s', async (address, client) => {
    relayed()
    const { keys, binding } = limiter(Infinity)
    expect((await act({ action: 'list' }, binding, address)).status).toBe(200)
    expect(keys).toEqual([`list:${client}`])
  })

  it.each([
    '2001:db8::1::2',
    '2001:db8:::1',
    '1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:8:9',
    '1::2:3:4:5:6:7:8',
    ':1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:',
    '12345::',
    '2001:db8:g::1',
    '+1::',
    '::ffff:203.0.113.256',
    '::ffff:203.0.113.010',
    '::ffff:203.0.113',
    '203.0.113.10::',
    '203.0.113.10:443',
    'unknown',
  ])('counts a value that is no address, %j, under itself as received', async (address) => {
    relayed()
    const { keys, binding } = limiter(Infinity)
    expect((await act({ action: 'list' }, binding, address)).status).toBe(200)
    expect(keys).toEqual([`list:${address}`])
  })

  it('gives two addresses in one /64 one allowance', async () => {
    relayed()
    const { binding } = limiter(1)
    expect((await act({ action: 'list' }, binding, '2001:db8:1:2::a')).status).toBe(200)
    const sameLine = await act({ action: 'list' }, binding, '2001:DB8:1:2:ffff:ffff:ffff:ffff')
    expect(sameLine.status).toBe(429)
  })

  it('gives two /64s an allowance each', async () => {
    relayed()
    const { binding } = limiter(1)
    expect((await act({ action: 'list' }, binding, '2001:db8:1:2::a')).status).toBe(200)
    expect((await act({ action: 'list' }, binding, '2001:db8:1:3::a')).status).toBe(200)
  })

  it('signs the address as received, not the /64 it is counted under', async () => {
    const signed: (string | null)[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      signed.push(new Headers(init?.headers).get('x-customer-gateway-ip'))
      return Response.json({ ok: true })
    })
    const address = '2001:DB8:1:2::a'
    const { keys, binding } = limiter(Infinity)
    expect((await act({ action: 'list' }, binding, address)).status).toBe(200)
    expect(keys).toEqual(['list:2001:db8:1:2::/64'])
    expect(signed).toEqual([address])
  })

  it('names the actions the Edge Function accepts', () => {
    const source = read('supabase/functions/public-booking-actions/request.ts')
    const accepted = [...source.matchAll(/action: z\.literal\('([a-z_]+)'\)/g)].map(
      (match) => match[1],
    )
    expect(accepted.length).toBeGreaterThan(0)
    expect([...accepted].sort()).toEqual([...BOOKING_ACTIONS].sort())
  })

  it('refuses a request over the limit with 429, Retry-After and the gateway JSON, without calling Edge', async () => {
    const calls = relayed()
    const { binding } = limiter(1)
    expect((await act({ action: 'list' }, binding)).status).toBe(200)
    const refused = await act({ action: 'list' }, binding)
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe(String(GATEWAY_RATE_LIMIT_PERIOD_SECONDS))
    expect(refused.headers.get('Content-Type')).toBe('application/json')
    expect(refused.headers.get('Cache-Control')).toBe('no-store')
    expect(refused.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(await refused.json()).toEqual({ ok: false, error: 'rate_limited' })
    expect(calls).toEqual(['public-booking-actions'])
    expect((await act({ action: 'cancel' }, binding)).status).toBe(200)
    expect((await act({ action: 'list' }, binding, '198.51.100.7')).status).toBe(200)
  })

  it.each([
    ['an invented action', '{"action":"invented-1"}'],
    ['another invented action', '{"action":"invented-2"}'],
    ['an action that is not a string', '{"action":5}'],
    ['the name of an object member', '{"action":"constructor"}'],
    ['no action', '{}'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"list"'],
    ['a body that is not JSON', 'action=list'],
  ])('counts %s in the one bucket of unknown actions', async (_label, body) => {
    relayed()
    const { keys, binding } = limiter(Infinity)
    await act(body, binding)
    expect(keys).toEqual([`other:${CLIENT}`])
  })

  it('shares that bucket between invented action names', async () => {
    relayed()
    const { binding } = limiter(1)
    expect((await act({ action: 'invented-1' }, binding)).status).toBe(200)
    expect((await act({ action: 'invented-2' }, binding)).status).toBe(429)
  })

  it('lets every request on where no limiter is bound', async () => {
    const calls = relayed()
    for (let request = 0; request < 3; request++)
      expect((await act({ action: 'list' })).status).toBe(200)
    expect(calls).toHaveLength(3)
  })

  it.each([
    ['rejects', (): Promise<{ success: boolean }> => Promise.reject(new Error('limiter down'))],
    [
      'throws',
      (): Promise<{ success: boolean }> => {
        throw new Error('limiter down')
      },
    ],
  ])('lets the request on when the limiter %s', async (_label, limit) => {
    const calls = relayed()
    expect((await act({ action: 'list' }, { limit })).status).toBe(200)
    expect(calls).toEqual(['public-booking-actions'])
  })

  it('counts nothing for a request it refuses before reading the body or without a client address', async () => {
    relayed()
    const { keys, binding } = limiter(Infinity)
    const refused = [
      await customerGateway(new Request(`${SITE}/api/customer-bookings`), env(binding)),
      await customerGateway(
        new Request(`${SITE}/api/customer-bookings`, {
          method: 'POST',
          headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
          body: '{"action":"list"}',
        }),
        env(binding),
      ),
      await act({ action: 'list' }, binding, null),
    ]
    expect(refused.map((response) => response.status)).toEqual([405, 403, 502])
    expect(keys).toEqual([])
  })

  it('counts through the Worker route, and leaves the booking submission uncounted', async () => {
    const calls = relayed()
    const { keys, binding } = limiter(0)
    const bindings = createEnv({ ...GATEWAY, GATEWAY_RATE_LIMIT: binding })
    const action = await worker.fetch(
      gatewayRequest('/api/customer-bookings', { action: 'cancel' }),
      bindings,
      noPublicContent,
    )
    expect(action.status).toBe(429)
    expect(keys).toEqual([`cancel:${CLIENT}`])
    // The submission is limited in the database, not by this binding.
    const submission = await worker.fetch(
      gatewayRequest('/api/bookings', { action: 'list' }),
      bindings,
      noPublicContent,
    )
    expect(submission.status).toBe(200)
    expect(keys).toEqual([`cancel:${CLIENT}`])
    expect(calls).toEqual(['submit-booking'])
  })

  it('answers in the shape every gateway error has', async () => {
    const response = gatewayError('rate_limited', 429, { 'Retry-After': '60' })
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ ok: false, error: 'rate_limited' })
    expectOwnHeaders(response)
  })

  it('binds one limiter in wrangler.jsonc, with the period the Worker tells a refused client', () => {
    expect(wranglerConfig.ratelimits).toEqual([
      {
        name: 'GATEWAY_RATE_LIMIT',
        namespace_id: expect.stringMatching(/^[1-9][0-9]*$/),
        simple: { limit: 60, period: GATEWAY_RATE_LIMIT_PERIOD_SECONDS },
      },
    ])
    // The periods the binding accepts (node_modules/wrangler/config-schema.json).
    expect([10, 60]).toContain(GATEWAY_RATE_LIMIT_PERIOD_SECONDS)
  })
})
