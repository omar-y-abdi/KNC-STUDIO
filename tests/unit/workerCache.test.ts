import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type CmsPage } from '../../shared/cms'
import { resolveBusinessSettings } from '../../src/site/business'
import {
  CMS_REVISION_ATTRIBUTE,
  parseCmsRevision,
  presentationPath,
  requestedPresentationRevision,
} from '../../src/site/routeMetadata'
import worker, { PublicContent, isCmsPagePath, renderCmsPage } from '../../src/worker'

// E2 (worker-cache): non-page requests skip the CMS, independent reads overlap, the presentation is
// versioned and cached per revision, empty descriptions keep the defaults, and the static layer
// serves icons and info.css as assets.
const SITE = 'https://bladeblendstudio.se'
const SHELL = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const DISCOVERY = { settings: {}, barbers: [], services: [], schedules: [] }
// The Worker inlines these deployed sheets as the base of a CMS legal page (STY-7).
const LEGAL_SHEETS: Readonly<Record<string, string>> = {
  '/tokens.css': ':root{--bb-surface:#fff}',
  '/info.css': 'main.bb-doc{margin:0 auto}',
}

type WorkerContext = Parameters<typeof worker.fetch>[2]

// For routes that never use the cached public-content export: calling it rejects.
const noPublicContent: WorkerContext = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}

const variant = (heading: string) => ({
  html: `<main><h1>${heading}</h1></main>`,
  css: { light: 'body{color:#111}', dark: 'body{color:#eee}' },
})
const terms: CmsPage = {
  id: '10000000-0000-4000-8000-000000000006',
  kind: 'terms',
  path: '/terms',
  name: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  title: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  description: { sv: 'Villkor', en: 'Terms' },
  inMenu: false,
  content: { sv: variant('Bokningsvillkor'), en: variant('Booking terms') },
}
const offers: CmsPage = {
  ...terms,
  id: '10000000-0000-4000-8000-000000000008',
  kind: 'page',
  path: '/offers',
  name: { sv: 'Erbjudanden', en: 'Offers' },
  title: { sv: 'Erbjudanden', en: 'Offers' },
  content: { sv: variant('Erbjudanden'), en: variant('Offers') },
}
const presentationWith = (...pages: CmsPage[]) => ({ ...emptyDocument().presentation, pages })
const publishedWith =
  (...pages: CmsPage[]) =>
  () =>
    Response.json({ revision: 7, presentation: presentationWith(...pages) })

/** Counts how many reads are in flight at once, so a test can assert overlap and not order. */
function createFlight() {
  let active = 0
  let peak = 0
  return {
    get peak(): number {
      return peak
    },
    async run<T>(make: () => T): Promise<T> {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
      active -= 1
      return make()
    },
  }
}
type Flight = ReturnType<typeof createFlight>

function createAssets(files: Readonly<Record<string, string>>, flight?: Flight) {
  const requested: string[] = []
  return {
    requested,
    assets: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const path = new URL(input instanceof Request ? input.url : input).pathname
        requested.push(path)
        const respond = (): Response => {
          const body = files[path]
          return body === undefined
            ? new Response('Not found', { status: 404 })
            : new Response(body, { headers: { 'Content-Type': 'text/html' } })
        }
        return flight === undefined ? respond() : flight.run(respond)
      },
    },
  }
}

function createEnv(assets: ReturnType<typeof createAssets>['assets']) {
  return {
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_ANON_KEY: 'fixture-anon-key',
    ASSETS: assets,
  }
}
type TestEnv = ReturnType<typeof createEnv>

function publicContentContext(env: TestEnv): WorkerContext {
  const publicContent = new PublicContent({} as never, env)
  return {
    exports: { PublicContent: { fetch: (request: Request) => publicContent.fetch(request) } },
  }
}

/** Answers each Supabase RPC from `answers` (anything else is a 503) and records the RPC names. */
function stubRpcs(answers: Readonly<Record<string, () => Response>>, flight?: Flight) {
  const calls: string[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const name = new URL(url).pathname.split('/').pop() ?? ''
    calls.push(name)
    const respond = (): Response => answers[name]?.() ?? new Response(null, { status: 503 })
    return flight === undefined ? respond() : flight.run(respond)
  })
  return { calls, spy }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requests that cannot be CMS pages', () => {
  it.each(['/favicon.ico', '/x.css', '/wp-login.php'])(
    'answers %s from the asset layer without a Supabase RPC',
    async (path) => {
      const { assets } = createAssets({ '/404.html': '<main>Sidan finns inte</main>' })
      const { spy } = stubRpcs({})
      const response = await worker.fetch(
        new Request(`${SITE}${path}`),
        createEnv(assets),
        noPublicContent,
      )
      expect(response.status).toBe(404)
      expect(spy).not.toHaveBeenCalled()
    },
  )

  it('still looks up a page-shaped unknown path once, without a shell or discovery read', async () => {
    const files = createAssets({ '/404.html': '<main>Sidan finns inte</main>' })
    const { calls } = stubRpcs({ public_cms_presentation: publishedWith(terms) })
    const response = await worker.fetch(
      new Request(`${SITE}/not-a-route`),
      createEnv(files.assets),
      noPublicContent,
    )
    expect(response.status).toBe(404)
    expect(calls).toEqual(['public_cms_presentation'])
    expect(files.requested).toEqual(['/not-a-route', '/404.html'])
  })

  it.each([
    ['/privacy', true],
    ['/terms', true],
    ['/offers', true],
    ['/offers/summer', true],
    ['/favicon.ico', false],
    ['/x.css', false],
    ['/wp-login.php', false],
    ['/.well-known/acp.json', false],
    ['/admin', false],
    ['/login', false],
    ['/api/cms/presentation', false],
    ['/Offers', false],
  ] as const)('classifies %s as a possible CMS page: %s', (path, expected) => {
    expect(isCmsPagePath(path)).toBe(expected)
  })
})

describe('CMS page reads that do not depend on each other', () => {
  it('reads discovery while it looks up /terms in the CMS', async () => {
    const flight = createFlight()
    const files = createAssets({ '/index.html': SHELL, ...LEGAL_SHEETS }, flight)
    stubRpcs(
      {
        public_cms_presentation: publishedWith(terms),
        public_business_discovery: () => Response.json(DISCOVERY),
      },
      flight,
    )
    const response = await worker.fetch(
      new Request(`${SITE}/terms`),
      createEnv(files.assets),
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<h1>Bokningsvillkor</h1>')
    expect(flight.peak).toBeGreaterThanOrEqual(2)
  })

  it('reads the shell and discovery together once the lookup found a created page', async () => {
    const flight = createFlight()
    const files = createAssets({ '/index.html': SHELL }, flight)
    stubRpcs(
      {
        public_cms_presentation: publishedWith(offers),
        public_business_discovery: () => Response.json(DISCOVERY),
      },
      flight,
    )
    const response = await worker.fetch(
      new Request(`${SITE}/offers`),
      createEnv(files.assets),
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<h1>Erbjudanden</h1>')
    expect(flight.peak).toBeGreaterThanOrEqual(2)
  })

  it('reads discovery once for a legal page the CMS does not hold', async () => {
    const files = createAssets({ '/terms.html': '<main>terms</main>' })
    const { calls } = stubRpcs({
      public_cms_presentation: publishedWith(offers),
      public_business_discovery: () => Response.json(DISCOVERY),
    })
    const response = await worker.fetch(
      new Request(`${SITE}/terms`, { headers: { 'If-None-Match': 'old-company' } }),
      createEnv(files.assets),
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<main>terms</main>')
    expect([...calls].sort()).toEqual(['public_business_discovery', 'public_cms_presentation'])
    expect(files.requested).toEqual(['/terms.html'])
  })

  it('never reads discovery or the legal base sheets for a HEAD request', async () => {
    const files = createAssets({ '/index.html': SHELL, ...LEGAL_SHEETS })
    const { calls } = stubRpcs({ public_cms_presentation: publishedWith(terms) })
    const response = await worker.fetch(
      new Request(`${SITE}/terms`, { method: 'HEAD' }),
      createEnv(files.assets),
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(calls).toEqual(['public_cms_presentation'])
    expect(files.requested.filter((path) => path in LEGAL_SHEETS)).toEqual([])
  })
})

describe('versioned presentation', () => {
  const presentationRequest = (search: string, method = 'GET'): Request =>
    new Request(`${SITE}/api/cms/presentation${search}`, { method })
  const postgres = '{"revision": 21, "presentation": {"pages": []}}'
  const env = createEnv(createAssets({}).assets)

  it.each([
    ['PostgreSQL spacing', postgres],
    ['compact JSON', '{"revision":21,"presentation":{"pages":[]}}'],
  ])(
    'caches revision 21 at the edge for a day when the document opens with it (%s)',
    async (_label, upstream) => {
      const published = new Response(upstream)
      const parse = vi.spyOn(published, 'json')
      const decode = vi.spyOn(published, 'text')
      const { calls } = stubRpcs({ public_cms_presentation: () => published })
      const response = await worker.fetch(
        presentationRequest('?rev=21'),
        env,
        publicContentContext(env),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(
        'max-age=86400, must-revalidate',
      )
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Content-Type')).toBe('application/json')
      response.headers.forEach((value) => {
        expect(value).not.toMatch(/s-maxage|stale-while-revalidate/)
      })
      expect(await response.text()).toBe(upstream)
      expect(parse).not.toHaveBeenCalled()
      expect(decode).not.toHaveBeenCalled()
      expect(calls).toEqual(['public_cms_presentation'])
    },
  )

  it('answers a revision the database has moved past with the current document, uncached', async () => {
    stubRpcs({ public_cms_presentation: () => new Response(postgres) })
    const response = await worker.fetch(
      presentationRequest('?rev=20'),
      env,
      publicContentContext(env),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false)
    expect(await response.text()).toBe(postgres)
  })

  it.each([
    ['revision after the presentation', '{"presentation": {}, "revision": 21}'],
    ['revision as a string', '{"revision": "21", "presentation": {}}'],
    ['fractional revision', '{"revision": 21.5, "presentation": {}}'],
    ['leading zero', '{"revision": 021, "presentation": {}}'],
    ['no document', 'null'],
    ['empty body', ''],
  ])('never caches a document it cannot verify (%s)', async (_label, upstream) => {
    stubRpcs({ public_cms_presentation: () => new Response(upstream) })
    const response = await worker.fetch(
      presentationRequest('?rev=21'),
      env,
      publicContentContext(env),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false)
    expect(await response.text()).toBe(upstream)
  })

  it.each([
    '',
    '?rev=',
    '?rev=abc',
    '?rev=-1',
    '?rev=021',
    '?rev=1.5',
    '?rev=1e3',
    '?rev=21&x=1',
    '?x=1&rev=21',
    '?rev=21&rev=21',
    '?rev=%32%31',
    '?Rev=21',
    '?rev=99999999999999999999',
  ])('answers presentation%s uncached and outside the PublicContent export', async (search) => {
    stubRpcs({ public_cms_presentation: () => new Response(postgres) })
    const response = await worker.fetch(presentationRequest(search), env, noPublicContent)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false)
    expect(await response.text()).toBe(postgres)
  })

  it('sends only a versioned GET through the cached PublicContent export', async () => {
    stubRpcs({ public_cms_presentation: () => new Response(postgres) })
    const cachedFetch = vi.fn(async () => new Response('cached'))
    const context: WorkerContext = { exports: { PublicContent: { fetch: cachedFetch } } }

    const versioned = await worker.fetch(presentationRequest('?rev=21'), env, context)
    expect(await versioned.text()).toBe('cached')
    expect(cachedFetch).toHaveBeenCalledOnce()

    for (const [search, method] of [
      ['', 'GET'],
      ['?rev=abc', 'GET'],
      ['?rev=21&x=1', 'GET'],
      ['?rev=21', 'HEAD'],
    ] as const) {
      cachedFetch.mockClear()
      const response = await worker.fetch(presentationRequest(search, method), env, context)
      expect(response.status).toBe(200)
      expect(cachedFetch).not.toHaveBeenCalled()
    }
  })

  it('answers a HEAD request with the headers of an uncached read and no body', async () => {
    stubRpcs({ public_cms_presentation: () => new Response(postgres) })
    const response = await worker.fetch(
      presentationRequest('?rev=21', 'HEAD'),
      env,
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false)
    expect(await response.text()).toBe('')
  })

  it('answers 503, uncached, when the database read fails', async () => {
    stubRpcs({ public_cms_presentation: () => new Response('boom', { status: 503 }) })
    const response = await worker.fetch(
      presentationRequest('?rev=21'),
      env,
      publicContentContext(env),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false)
    expect(await response.json()).toEqual({ error: 'unavailable' })
  })

  it('never stores a document whose read was cut off after its first bytes', async () => {
    const opening = new TextEncoder().encode('{"revision": 21, "presentation": {"pages": [')
    stubRpcs({
      public_cms_presentation: () => {
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
      },
    })
    const response = await worker.fetch(
      presentationRequest('?rev=21'),
      env,
      publicContentContext(env),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false)
  })
})

describe('native shells', () => {
  async function shellFor(path: string, answer: Record<string, unknown>): Promise<Response> {
    const env = createEnv(createAssets({ '/index.html': SHELL }).assets)
    stubRpcs({
      public_cms_page_metadata: () => Response.json(answer),
      public_business_discovery: () => Response.json(DISCOVERY),
    })
    return worker.fetch(new Request(`${SITE}${path}`), env, publicContentContext(env))
  }
  const metadata = { title: 'CMS title', description: 'CMS description' }
  const rootTag = (html: string): string | undefined => html.match(/<html\b[^>]*>/)?.[0]

  it.each([
    ['/', ''],
    ['/about', ''],
    ['/booking', ' data-knc-view="booking"'],
    ['/my-bookings', ''],
  ])('names the published revision on the %s shell and keeps it uncached', async (path, view) => {
    const response = await shellFor(path, { ...metadata, revision: 41 })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Link') ?? '').not.toContain('preload')
    expect(rootTag(await response.text())).toBe(
      `<html lang="sv"${view} ${CMS_REVISION_ATTRIBUTE}="41">`,
    )
  })

  it.each([
    ['no revision', {}],
    ['a negative revision', { revision: -1 }],
    ['a fractional revision', { revision: 1.5 }],
    ['a revision sent as text', { revision: '7' }],
    ['a null revision', { revision: null }],
  ])('names no revision when the metadata RPC has %s', async (_label, extra) => {
    const response = await shellFor('/', { ...metadata, ...extra })
    expect(rootTag(await response.text())).toBe('<html lang="sv">')
  })

  const descriptions = (html: string): string[] =>
    ['business-description', 'business-og-description', 'business-twitter-description'].map(
      (id) => metaContent(html, id) ?? 'missing',
    )

  it.each(['/', '/booking'])(
    'keeps the business description on %s when the CMS page has none and replaces it otherwise',
    async (path) => {
      // As the attribute carries it: the default business name is "Blade & Blend Studio".
      const business = resolveBusinessSettings(new Map()).seo.sv.description.replaceAll(
        '&',
        '&amp;',
      )
      const empty = await shellFor(path, { ...metadata, description: '', revision: 1 })
      expect(descriptions(await empty.text())).toEqual([business, business, business])
      const written = await shellFor(path, { ...metadata, description: 'CMS description' })
      expect(descriptions(await written.text())).toEqual(Array(3).fill('CMS description'))
    },
  )
})

function metaContent(html: string, id: string): string | undefined {
  const start = html.indexOf(`id="${id}"`)
  return /content="([^"]*)"/.exec(html.slice(start, html.indexOf('>', start)))?.[1]
}

describe('page descriptions', () => {
  const shellDefault = metaContent(SHELL, 'business-description')
  const read = (description: string): string[] => {
    const page: CmsPage = { ...offers, description: { sv: description, en: description } }
    const html = renderCmsPage(SHELL, page, 'sv', 'light', `${SITE}/offers`)
    return ['business-description', 'business-og-description', 'business-twitter-description'].map(
      (id) => metaContent(html, id) ?? 'missing',
    )
  }

  it('keeps the shell description for a page without one and replaces it otherwise', () => {
    expect(shellDefault).toBeTruthy()
    expect(read('')).toEqual([shellDefault, shellDefault, shellDefault])
    expect(read('   ')).toEqual([shellDefault, shellDefault, shellDefault])
    expect(read('Erbjudanden hos oss')).toEqual(Array(3).fill('Erbjudanden hos oss'))
  })
})

describe('presentation URL contract', () => {
  it('builds exactly the form the Worker accepts', () => {
    for (const revision of [0, 1, 21, Number.MAX_SAFE_INTEGER]) {
      const path = presentationPath(revision)
      expect(path).toBe(`/api/cms/presentation?rev=${revision}`)
      expect(requestedPresentationRevision(new URL(`${SITE}${path}`))).toBe(revision)
    }
    expect(presentationPath(null)).toBe('/api/cms/presentation')
    expect(requestedPresentationRevision(new URL(`${SITE}/api/cms/presentation`))).toBeNull()
  })

  it('reads a revision only as plain digits', () => {
    expect(parseCmsRevision('0')).toBe(0)
    expect(parseCmsRevision('41')).toBe(41)
    for (const value of [null, undefined, '', ' 1', '1 ', '+1', '-1', '01', '1.5', '1e3', 'x']) {
      expect(parseCmsRevision(value)).toBeNull()
    }
    expect(parseCmsRevision('9007199254740993')).toBeNull()
  })

  it('names the attribute the Worker writes and the app reads', () => {
    expect(CMS_REVISION_ATTRIBUTE).toBe('data-cms-revision')
  })
})

describe('static asset layer', () => {
  const read = (path: string): string =>
    readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

  function headerRules(source: string): Map<string, string[]> {
    const rules = new Map<string, string[]>()
    let current: string[] | undefined
    for (const line of source.split('\n')) {
      if (line.trim() === '') current = undefined
      else if (/^\S/.test(line)) {
        current = []
        rules.set(line.trim(), current)
      } else current?.push(line.trim())
    }
    return rules
  }

  it('caches icons for a day and never as immutable, next to the unchanged rules', () => {
    const rules = headerRules(read('public/_headers'))
    expect([...rules.keys()]).toEqual(['/*', '/assets/*', '/fonts/*', '/icons/*'])
    expect(rules.get('/icons/*')).toEqual(['Cache-Control: public, max-age=86400'])
    for (const hashed of ['/assets/*', '/fonts/*'])
      expect(rules.get(hashed)).toEqual(['Cache-Control: public, max-age=31536000, immutable'])
    const everywhere = rules.get('/*') ?? []
    expect(everywhere).toHaveLength(9)
    expect(everywhere[0]).toMatch(/^Content-Security-Policy: default-src 'self'; /)
    expect(everywhere.some((line) => line.startsWith('Cache-Control'))).toBe(false)
  })

  it('serves info.css from the asset layer and still runs the Worker for the legal pages', () => {
    const source = read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')
    const config = JSON.parse(source.replace(/,\s*([}\]])/g, '$1')) as {
      readonly assets: { readonly run_worker_first: readonly string[] }
    }
    const runFirst = config.assets.run_worker_first
    expect(runFirst[0]).toBe('/*')
    expect(runFirst).toContain('!/info.css')
    expect(existsSync(new URL('../../public/info.css', import.meta.url))).toBe(true)
    for (const legal of ['terms', 'privacy']) {
      expect(runFirst).not.toContain(`!/${legal}`)
      expect(runFirst).not.toContain(`!/${legal}.html`)
    }
  })
})
