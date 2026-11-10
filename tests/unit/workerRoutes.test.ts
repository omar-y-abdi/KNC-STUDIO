import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { emptyDocument, type CmsPage } from '../../packages/content-contracts/src/cms'
import worker, {
  PublicContent,
  customerAccessTokenFromPath,
  fixedRoutePath,
  isPrivatePath,
  isSpaPath,
  renderHomepageMetadata,
  renderLlmsText,
  renderPrivateMetadata,
  renderLegalMetadata,
} from '../../supabase/worker/index'
import {
  buildBusinessStructuredData,
  resolveBusinessSettings,
  type BusinessSettings,
} from '../../modules/public-web/src/site/business'

const assetBodies: Readonly<Record<string, string>> = {
  '/index.html': '<main>homepage</main>',
  '/privacy.html': '<main>privacy</main>',
  '/terms.html': '<main>terms</main>',
  '/404.html': '<main><h1>Sidan finns inte</h1><a href="/">Hem</a></main>',
  '/google-calendar.html': '<main>calendar</main>',
  '/assets/app.js': 'console.log("app")',
}

function createEnv() {
  const requestedPaths: string[] = []
  const requestHeaders: Headers[] = []
  return {
    requestedPaths,
    requestHeaders,
    ASSETS: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const assetRequest = input instanceof Request ? input : new Request(input)
        const url = new URL(assetRequest.url)
        requestedPaths.push(url.pathname)
        requestHeaders.push(assetRequest.headers)
        const body = assetBodies[url.pathname]
        return body === undefined
          ? new Response('Not found', { status: 404 })
          : new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } })
      },
    },
  }
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

function createWorkerContext(env: ReturnType<typeof createEnv>) {
  const publicContent = new PublicContent({} as never, env)
  return {
    exports: {
      PublicContent: {
        fetch(request: Request): Promise<Response> {
          return publicContent.fetch(request)
        },
      },
    },
  }
}

function readWranglerConfig(): {
  readonly workers_dev?: boolean
  readonly preview_urls?: boolean
  readonly cache?: { readonly enabled?: boolean }
  readonly exports?: Readonly<
    Record<
      string,
      {
        readonly type?: string
        readonly cache?: { readonly enabled?: boolean }
      }
    >
  >
} {
  const source = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')
  const withoutFullLineComments = source.replace(/^\s*\/\/.*$/gm, '')
  return JSON.parse(withoutFullLineComments.replace(/,\s*([}\]])/g, '$1')) as {
    readonly workers_dev?: boolean
    readonly preview_urls?: boolean
    readonly cache?: { readonly enabled?: boolean }
    readonly exports?: Readonly<
      Record<
        string,
        {
          readonly type?: string
          readonly cache?: { readonly enabled?: boolean }
        }
      >
    >
  }
}

describe('Worker route policy', () => {
  it('does not carry header rules for disabled Cloudflare preview routes', () => {
    const headers = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8')
    const config = readWranglerConfig()

    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(headers).not.toMatch(/^https:\/\/[^\s]+\.workers\.dev\/\*$/m)
    expect(headers).toContain('X-Frame-Options: DENY')
  })

  it('recognizes only protected SPA paths as private', () => {
    expect(isPrivatePath('/admin')).toBe(true)
    expect(isPrivatePath('/admin/settings')).toBe(true)
    expect(isPrivatePath('/login/')).toBe(true)
    expect(isPrivatePath('/auth/confirm')).toBe(true)
    expect(isPrivatePath('/administrator')).toBe(false)
    expect(isSpaPath('/')).toBe(true)
    expect(isSpaPath('/not-a-route')).toBe(false)
  })

  it('redirects www requests to the canonical apex without losing query parameters', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://www.bladeblendstudio.se/login?next=%2Fadmin'),
      env,
      noPublicContent,
    )

    expect(response.status).toBe(308)
    expect(response.headers.get('Location')).toBe('https://bladeblendstudio.se/login?next=%2Fadmin')
    expect(env.requestedPaths).toEqual([])
  })

  it('keeps hostname routing outside the cached public-content entrypoint', async () => {
    const env = createEnv()
    const cachedFetch = vi.fn(async () => new Response('cached public content'))
    const fetchGateway = worker.fetch as (
      request: Request,
      workerEnv: ReturnType<typeof createEnv>,
      context: {
        readonly exports: {
          readonly PublicContent: { fetch(request: Request): Promise<Response> }
        }
      },
    ) => Promise<Response>
    const context = { exports: { PublicContent: { fetch: cachedFetch } } }

    const wwwResponse = await fetchGateway(
      new Request('https://www.bladeblendstudio.se/?campaign=summer'),
      env,
      context,
    )
    expect(wwwResponse.status).toBe(308)
    expect(wwwResponse.headers.get('Location')).toBe('https://bladeblendstudio.se/?campaign=summer')
    expect(cachedFetch).not.toHaveBeenCalled()

    const apexRequest = new Request('https://bladeblendstudio.se/?campaign=summer')
    const apexResponse = await fetchGateway(apexRequest, env, context)
    expect(await apexResponse.text()).toBe('cached public content')
    expect(cachedFetch).toHaveBeenCalledOnce()
    expect(cachedFetch).toHaveBeenCalledWith(apexRequest)

    const config = readWranglerConfig()
    expect(config.cache).toEqual({ enabled: false })
    expect(config.exports?.default).toEqual({
      type: 'worker',
      cache: { enabled: false },
    })
    expect(config.exports?.PublicContent).toEqual({
      type: 'worker',
      cache: { enabled: true },
    })
  })

  it.each(['/', '/about', '/booking', '/my-bookings'])(
    'keeps %s available when metadata rendering fails',
    async (path) => {
      for (const failure of ['response', 'exception']) {
        const env = createEnv()
        const context = {
          exports: {
            PublicContent: {
              fetch: async () => {
                if (failure === 'exception') throw new Error('Worker exceeded CPU time limit')
                return new Response('Unavailable', { status: 503 })
              },
            },
          },
        }
        const response = await worker.fetch(
          new Request(`https://bladeblendstudio.se${path}`),
          env,
          context,
        )
        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        // The account page stays out of the index although its head was not rendered.
        expect(response.headers.get('X-Robots-Tag')).toBe(
          path === '/my-bookings' ? 'noindex' : null,
        )
        expect(await response.text()).toBe('<main>homepage</main>')
      }
    },
  )

  it('moves permanent customer credentials into a fragment before loading assets', async () => {
    const env = createEnv()
    const token = 'a'.repeat(64)
    expect(customerAccessTokenFromPath(`/${token}`)).toBe(token)
    expect(customerAccessTokenFromPath(`/${token}/extra`)).toBeNull()
    expect(customerAccessTokenFromPath(`/prefix/${token}`)).toBeNull()
    expect(customerAccessTokenFromPath(`/${token}?campaign=mail`)).toBeNull()
    expect(customerAccessTokenFromPath(`/${token.slice(1)}`)).toBeNull()

    const response = await worker.fetch(
      new Request(`https://bladeblendstudio.se/${token}`),
      env,
      noPublicContent,
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      `https://bladeblendstudio.se/#booking_token=${token}`,
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(env.requestedPaths).toEqual([])

    const headResponse = await worker.fetch(
      new Request(`https://bladeblendstudio.se/${token}`, { method: 'HEAD' }),
      env,
      noPublicContent,
    )
    expect(headResponse.status).toBe(302)
    expect(headResponse.headers.get('Cache-Control')).toBe('no-store')
    expect(await headResponse.text()).toBe('')
    expect(env.requestedPaths).toEqual([])
  })

  it('serves protected SPA routes with noindex headers', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/admin/settings'),
      env,
      noPublicContent,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(await response.text()).toBe('<main>homepage</main>')
    expect(env.requestedPaths).toEqual(['/admin/settings', '/index.html'])
  })

  it('returns a genuine noindex 404 for unknown paths', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/not-a-route'),
      env,
      noPublicContent,
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(env.requestedPaths).toEqual(['/not-a-route', '/404.html'])
    expect(await response.text()).toContain('<h1>Sidan finns inte</h1>')
  })

  it('returns a genuine noindex 404 for unsupported ACP discovery', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/.well-known/acp.json'),
      env,
      noPublicContent,
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(env.requestedPaths).toEqual(['/.well-known/acp.json', '/404.html'])
  })

  it('serves clean static URLs and redirects their HTML filenames', async () => {
    const env = createEnv()
    const cleanResponse = await worker.fetch(
      new Request('https://bladeblendstudio.se/privacy'),
      env,
      noPublicContent,
    )
    const filenameResponse = await worker.fetch(
      new Request('https://bladeblendstudio.se/privacy.html?lang=sv'),
      env,
      noPublicContent,
    )

    expect(cleanResponse.status).toBe(200)
    expect(await cleanResponse.text()).toBe('<main>privacy</main>')
    expect(filenameResponse.status).toBe(308)
    expect(filenameResponse.headers.get('Location')).toBe(
      'https://bladeblendstudio.se/privacy?lang=sv',
    )
  })

  it('keeps Google verification copy reachable but out of search indexes', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/google-calendar'),
      env,
      noPublicContent,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('does not share-cache fallback homepage metadata when discovery is unavailable', async () => {
    const env = createEnv()
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/', {
        headers: {
          'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
          'If-None-Match': '"static-asset"',
        },
      }),
      env,
      createWorkerContext(env),
    )

    expect(env.requestHeaders[0]?.has('If-Modified-Since')).toBe(false)
    expect(env.requestHeaders[0]?.has('If-None-Match')).toBe(false)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.has('ETag')).toBe(false)
    expect(response.headers.has('Last-Modified')).toBe(false)
  })

  it.each(['/', '/about', '/booking', '/my-bookings'])(
    'serves bounded native metadata for %s',
    async (path) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input)
        const body = url.includes('public_cms_page_metadata')
          ? {
              revision: 2,
              // Each page has a title of its own, as the database answers per path.
              title: `CMS title ${(JSON.parse(String(init?.body)) as { p_path: string }).p_path}`,
              description: 'CMS description',
            }
          : { settings: {}, barbers: [], services: [], schedules: [] }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      const env = {
        ...createEnv(),
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
      }
      env.ASSETS.fetch = async () =>
        new Response(
          '<!doctype html><html lang="sv"><head><title id="business-title">Old</title></head><body><div id="root"></div></body></html>',
        )

      try {
        const response = await worker.fetch(
          new Request(`https://bladeblendstudio.se${path}`),
          env,
          createWorkerContext(env),
        )
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.text()).toContain(`CMS title ${path}`)
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes('public_cms_presentation')),
        ).toBe(false)
        // Discovery and the page's metadata; the other routes also read the homepage's title.
        expect(fetchMock).toHaveBeenCalledTimes(path === '/' ? 2 : 3)
      } finally {
        fetchMock.mockRestore()
      }
    },
  )
  it('streams published CMS data without parsing it again at the edge', async () => {
    const json = JSON.stringify({ revision: 21, presentation: { content: 'x'.repeat(1000000) } })
    const upstream = new Response(json)
    const parse = vi.spyOn(upstream, 'json')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(upstream)
    try {
      const env = {
        ...createEnv(),
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'test',
      }
      const response = await worker.fetch(
        new Request('https://bladeblendstudio.se/api/cms/presentation'),
        env,
        noPublicContent,
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.text()).toBe(json)
      expect(parse).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      fetchMock.mockRestore()
    }
  })
})

describe('initial business metadata', () => {
  const business: BusinessSettings = {
    name: 'Current Studio',
    legalName: 'Current Company AB',
    organizationNumber: '556016-0680',
    email: 'booking@current.example',
    phoneDisplay: '031-12 34 56',
    phoneTel: '+4631123456',
    street: 'Current Street 7',
    postalCode: '411 11',
    city: 'Göteborg',
    mapsHref: 'https://maps.example/current',
    cancellationPolicyHours: 36,
    seo: {
      sv: { title: 'Current Studio – Boka', description: 'Current public purpose.' },
      en: { title: 'Current Studio – Book', description: 'Current public purpose.' },
    },
  }
  const facts = {
    barbers: [
      { id: 'a', name: 'Ada' },
      { id: 'b', name: 'Bo' },
    ],
    services: [
      { id: 's1', barberId: 'a', price: 250 },
      { id: 's2', barberId: 'b', price: 475 },
    ],
    schedules: [
      { barberId: 'a', weekday: 1, startMin: 540, endMin: 720 },
      { barberId: 'b', weekday: 1, startMin: 660, endMin: 1080 },
    ],
  }

  it('renders initial JSON-LD from the same complete builder hydration uses', () => {
    const html = [
      '<title id="business-title">old</title>',
      '<meta id="business-description" content="old">',
      '<meta id="business-og-site-name" content="old">',
      '<meta id="business-og-title" content="old">',
      '<meta id="business-og-description" content="old">',
      '<meta id="business-og-image-alt" content="old">',
      '<meta id="business-twitter-title" content="old">',
      '<meta id="business-twitter-description" content="old">',
      '<script id="business-json-ld" type="application/ld+json">{}</script>',
    ].join('')

    const rendered = renderHomepageMetadata(html, { business, facts })
    const json = rendered.match(/business-json-ld[^>]*>([^<]+)<\/script>/)?.[1]

    expect(json).toBeDefined()
    expect(JSON.parse(json ?? '')).toEqual(
      buildBusinessStructuredData(business, facts, 'https://bladeblendstudio.se'),
    )
    expect(rendered).toContain('Current Studio – Boka')
    expect(rendered).toContain('Current public purpose.')
  })

  it('keeps machine discovery on current CMS/domain facts', () => {
    const text = renderLlmsText({ business, facts })
    expect(text).toContain('Current Street 7, 411 11 Göteborg')
    expect(text.indexOf('- Phone: 031-12 34 56')).toBeGreaterThan(
      text.indexOf('- Address: Current Street 7, 411 11 Göteborg, Sweden'),
    )
    expect(text.indexOf('- Phone: 031-12 34 56')).toBeLessThan(text.indexOf('- Barbers: Ada, Bo'))
    expect(text).toContain('Ada, Bo')
    expect(text).toContain('250–475 kr')
    expect(text).not.toContain('Hassan')
  })

  it('escapes hostile CMS text without corrupting JSON-LD facts', () => {
    const hostile: BusinessSettings = {
      ...business,
      name: 'Studio </title><script>alert(1)</script>',
      seo: {
        sv: {
          title: 'Book </title><img src=x onerror=alert(1)>',
          description: 'Safe & current <description>',
        },
        en: business.seo.en,
      },
    }
    const html = [
      '<title id="business-title">old</title>',
      '<meta id="business-description" content="old">',
      '<meta id="business-og-site-name" content="old">',
      '<meta id="business-og-title" content="old">',
      '<meta id="business-og-description" content="old">',
      '<meta id="business-og-image-alt" content="old">',
      '<meta id="business-twitter-title" content="old">',
      '<meta id="business-twitter-description" content="old">',
      '<script id="business-json-ld" type="application/ld+json">{}</script>',
    ].join('')

    const rendered = renderHomepageMetadata(html, { business: hostile, facts })
    const json = rendered.match(/business-json-ld[^>]*>([\s\S]*?)<\/script>/)?.[1]

    expect(rendered).not.toContain('<img src=x onerror=alert(1)>')
    expect(rendered).toContain('Book &lt;/title&gt;&lt;img src=x onerror=alert(1)&gt;')
    expect(rendered).toContain('Safe &amp; current &lt;description&gt;')
    expect(json).toBeDefined()
    expect(JSON.parse(json ?? '')).toMatchObject({
      name: hostile.name,
      url: 'https://bladeblendstudio.se/',
    })
  })
})

describe('launch page documents', () => {
  it.each(['/terms', '/terms/'])('serves or canonicalizes booking terms %s', async (path) => {
    const response = await worker.fetch(
      new Request(`https://bladeblendstudio.se${path}`),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(path.endsWith('/') ? 308 : 200)
  })

  it('keeps a missing HEAD empty and returns a real 404', async () => {
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/missing', { method: 'HEAD' }),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })

  it('redirects the alternate homepage file to its canonical URL', async () => {
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/index.html'),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('https://bladeblendstudio.se/')
  })

  it('private HTML has a useful title, noindex and no homepage canonical', () => {
    const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    for (const [route, title] of [
      ['/login', 'Logga in'],
      ['/reset', 'Återställ lösenord'],
      ['/admin/settings', 'Adminpanel'],
    ]) {
      const rendered = renderPrivateMetadata(source, route ?? '')
      expect(rendered).toContain(
        `<title id="business-title">${title} — Blade &amp; Blend Studio</title>`,
      )
      expect(rendered).toContain('noindex, nofollow')
      expect(rendered).not.toContain('rel="canonical"')
    }
  })

  it.each(['privacy', 'terms'] as const)(
    '%s supplies metadata, one h1, internal links and no app bundle',
    (page) => {
      const source = readFileSync(new URL(`../../public/${page}.html`, import.meta.url), 'utf8')
      const html = renderLegalMetadata(source, `/${page}`, resolveBusinessSettings(new Map()))
      expect(html.match(/<h1[ >]/g)).toHaveLength(1)
      expect(html).toContain('name="description"')
      expect(html).toContain(`https://bladeblendstudio.se/${page}`)
      expect(html).toContain('og:image')
      expect(html).toContain('aria-current="page"')
      expect(html).toContain('href="/"')
      expect(html).not.toContain('<script')
    },
  )
})

// G05 (PR #104 final gate): a supported native route written with a trailing slash is canonicalized
// the way /contact/ already is: 308 to the slashless path, query kept, before any read.
describe('trailing-slash native routes', () => {
  // The committed revision-56 publication, which holds every native page.
  const revision56 = gunzipSync(
    readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
  )
  const request = async (method: string, path: string) => {
    const rpcs: string[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rpc = String(input).split('/').at(-1) ?? ''
      rpcs.push(rpc)
      if (rpc === 'public_cms_presentation') return new Response(revision56)
      if (rpc === 'public_cms_page_metadata')
        return Response.json({ revision: 56, title: 'CMS title', description: 'CMS description' })
      return new Response(null, { status: 503 })
    })
    const env = {
      ...createEnv(),
      SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_ANON_KEY: 'fixture-anon-key',
    }
    try {
      const response = await worker.fetch(
        new Request(`https://bladeblendstudio.se${path}?lang=en&mode=dark`, {
          method,
          headers: { Accept: 'text/html' },
        }),
        env,
        createWorkerContext(env),
      )
      return { response, body: await response.text(), rpcs, assets: env.requestedPaths }
    } finally {
      fetchMock.mockRestore()
    }
  }

  it.each(
    ['GET', 'HEAD'].flatMap((method) =>
      ['/booking', '/about', '/my-bookings'].flatMap((path) => [
        [method, `${path}/`, path],
        [method, `${path}//`, path],
      ]),
    ),
  )('answers %s %s with 308 to %s, query kept, without reading', async (method, path, target) => {
    const { response, body, rpcs, assets } = await request(method, path)
    expect(response.status).toBe(308)
    expect(response.headers.get('Location')).toBe(
      `https://bladeblendstudio.se${target}?lang=en&mode=dark`,
    )
    expect(body).toBe('')
    expect(rpcs).toEqual([])
    expect(assets).toEqual([])
  })

  it.each(
    ['GET', 'HEAD'].flatMap((method) =>
      ['/booking', '/about', '/my-bookings'].map((path) => [method, path]),
    ),
  )('keeps %s %s answered by the native route (control)', async (method, path) => {
    const { response, body } = await request(method, path)
    expect(response.status).toBe(200)
    expect(body === '').toBe(method === 'HEAD')
  })

  it.each(['GET', 'HEAD'])(
    'keeps %s /contact/ redirecting with its query (control)',
    async (method) => {
      const { response } = await request(method, '/contact/')
      expect(response.status).toBe(308)
      expect(response.headers.get('Location')).toBe(
        'https://bladeblendstudio.se/contact?lang=en&mode=dark',
      )
    },
  )

  it.each(
    ['GET', 'HEAD'].flatMap((method) =>
      ['/missing-example', '/missing-example/'].map((path) => [method, path]),
    ),
  )('keeps %s %s a noindex 404 (control)', async (method, path) => {
    const { response } = await request(method, path)
    expect(response.status).toBe(404)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})

describe('CMS legal page rendering', () => {
  const business = {
    ...resolveBusinessSettings(new Map()),
    name: 'Saved Salon',
    legalName: 'Saved Legal Company AB',
    organizationNumber: '556016-0680',
    email: 'saved@example.test',
    street: 'Saved Street 3',
    cancellationPolicyHours: 48,
  }

  it.each(['/privacy', '/terms'] as const)('renders current identity in %s HTML source', (path) => {
    const source = readFileSync(new URL(`../../public${path}.html`, import.meta.url), 'utf8')
    const html = renderLegalMetadata(source, path, business)
    expect(html).toContain('Saved Legal Company AB')
    expect(html).toContain('556016-0680')
    expect(html).toContain('Saved Street 3')
    expect(html).toContain('mailto:saved@example.test')
    expect(html).not.toContain('booking@mail.bladeblendstudio.se')
    expect(html).not.toContain('Blade &amp; Blend')
    expect(html.match(/<h1[ >]/g)).toHaveLength(1)
    expect(html).toContain(`rel="canonical" href="https://bladeblendstudio.se${path}"`)
    if (path === '/terms') {
      expect(html).toContain('48 timmar')
      expect(html).toContain('48 hours')
    }
  })

  it('escapes owner content and does not invent missing legal identity', () => {
    const source = readFileSync(new URL('../../public/privacy.html', import.meta.url), 'utf8')
    const html = renderLegalMetadata(source, '/privacy', {
      ...business,
      legalName: '<script>alert(1)</script>',
      organizationNumber: '',
    })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<dt>Organisationsnummer</dt>')
    const blank = renderLegalMetadata(source, '/privacy', {
      ...business,
      legalName: '',
      organizationNumber: '',
      phoneDisplay: '',
    })
    expect(blank).not.toContain('<dt>Juridiskt företagsnamn</dt>')
    expect(blank).not.toContain('<dt>Telefon</dt>')
    expect(renderLegalMetadata(source, '/privacy', null)).not.toContain('booking@mail')
  })

  it.each(['/privacy', '/terms'] as const)(
    'never caches %s or honours stale asset validators',
    async (path) => {
      const env = createEnv()
      const response = await worker.fetch(
        new Request(`https://bladeblendstudio.se${path}`, {
          headers: { 'If-None-Match': 'old-company', 'If-Modified-Since': 'yesterday' },
        }),
        env,
        createWorkerContext(env),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(env.requestHeaders[0]?.has('If-None-Match')).toBe(false)
      expect(env.requestHeaders[0]?.has('If-Modified-Since')).toBe(false)
      const head = await worker.fetch(
        new Request(`https://bladeblendstudio.se${path}`, { method: 'HEAD' }),
        env,
        createWorkerContext(env),
      )
      expect(head.status).toBe(200)
      expect(await head.text()).toBe('')
      expect(head.headers.get('Cache-Control')).toBe('no-store')
    },
  )
})

describe('bounded private metadata rewriting', () => {
  it('stops metadata searches at leading matches even with a large body', () => {
    const body = '<body>' + 'UPPERCASE BODY TEXT '.repeat(100_000) + '</body>'
    const head =
      '<meta property="og:url" content="old"><link rel="canonical" href="old"><meta name="robots" content="index">'
    const started = performance.now()
    const rendered = renderPrivateMetadata(head + body, '/login')
    const elapsed = performance.now() - started
    expect(rendered).toBe(
      '<meta property="og:url" content="https://bladeblendstudio.se/login"><meta name="robots" content="noindex, nofollow">' +
        body,
    )
    expect(elapsed).toBeLessThan(250)
  })

  it('leaves a long near-miss metadata tag unchanged without retrying each property', () => {
    const source = '<meta ' + 'property="og:url" '.repeat(10_000) + '>'
    const started = performance.now()
    expect(renderPrivateMetadata(source, '/login')).toBe(source)
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})

describe('metadata byte compatibility', () => {
  it.each([
    [
      '<meta property="og:url" content="old">',
      '<meta property="og:url" content="https://bladeblendstudio.se/login">',
    ],
    [
      'İ <META PROPERTY="OG:URL" CONTENT="old"> tail',
      'İ <META PROPERTY="OG:URL" CONTENT="https://bladeblendstudio.se/login"> tail',
    ],
    ['<meta content="old" property="og:url">', '<meta content="old" property="og:url">'],
    ["<meta property='og:url' content='old'>", "<meta property='og:url' content='old'>"],
    [
      '<meta property="og:url" content="first" content="last">',
      '<meta property="og:url" content="first" content="https://bladeblendstudio.se/login">',
    ],
    [
      '<meta property="og:url" content="first"><meta property="og:url" content="second">',
      '<meta property="og:url" content="https://bladeblendstudio.se/login"><meta property="og:url" content="second">',
    ],
    ['<meta property="og:url" content="old', '<meta property="og:url" content="old'],
    [
      '<meta property="og:url" content="old"',
      '<meta property="og:url" content="https://bladeblendstudio.se/login"',
    ],
    [
      '<meta property="og:url" content="old>tail" suffix',
      '<meta property="og:url" content="https://bladeblendstudio.se/login" suffix',
    ],
    ['<link rel="canonical" href="old"> tail', ' tail'],
    ['<link rel="canonical" href="old"', '<link rel="canonical" href="old"'],
    [
      '<meta name="robots" content="index, follow">',
      '<meta name="robots" content="noindex, nofollow">',
    ],
  ])('preserves the existing rewrite contract for %s', (source, expected) => {
    expect(renderPrivateMetadata(source, '/login')).toBe(expected)
    expect(renderPrivateMetadata(source, '/unknown')).toBe(source)
  })

  it('matches the former patterns on bounded, deterministic malformed combinations', () => {
    // Small inputs only: this oracle records byte compatibility, never runs the hostile sizes.
    const fragments = [
      '<meta ',
      '<link ',
      '>',
      'property="og:url"',
      'name="robots"',
      'rel="canonical"',
      'content="',
      'href="',
      '"',
      "'",
      'İ',
      ' x ',
      '<metadata ',
      'CONTENT="',
    ]
    let state = 37
    for (let sample = 0; sample < 2_000; sample++) {
      let source = ''
      for (let part = 0; part < 12; part++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        source += fragments[state % fragments.length]
      }
      const expected = source
        .replace(
          /(<meta\b[^>]*property="og:url"[^>]*content=")[^"]*(")/i,
          (_match, open: string, close: string) =>
            `${open}https://bladeblendstudio.se/login${close}`,
        )
        .replace(/<link\b[^>]*rel="canonical"[^>]*>/i, '')
        .replace(/(<meta\b[^>]*name="robots"[^>]*content=")[^"]*(")/i, '$1noindex, nofollow$2')
      expect(renderPrivateMetadata(source, '/login'), source).toBe(expected)
    }
  })

  it('handles repeated unterminated tag openers without rescanning their suffixes', () => {
    const source = '<meta <link '.repeat(30_000)
    const started = performance.now()
    expect(renderPrivateMetadata(source, '/login')).toBe(source)
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('keeps Worker route decisions linear for slash near misses', () => {
    const path = '/login' + '/'.repeat(200_000) + 'x'
    const started = performance.now()
    expect(isPrivatePath(path)).toBe(false)
    expect(isSpaPath(path)).toBe(false)
    expect(customerAccessTokenFromPath(path)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(isSpaPath('/')).toBe(true)
    expect(isSpaPath('//')).toBe(false)
    expect(isPrivatePath('/login///')).toBe(true)
    expect(customerAccessTokenFromPath(`/${'a'.repeat(64)}///`)).toBe('a'.repeat(64))
  })
})

// W2-5: every other spelling of a URL the site answers gets one 308 to the URL that is answered:
// the apex host, the route's own path, the query as sent. A fixed route (a native page, a static
// page, a staff route) folds letter case, trailing slashes and its file name. A created page does
// when the publication holds it. Below /admin/ the letters are the app's. A file, an /api/ path and
// an unknown path keep their letters, and a customer link keeps its credential as written.
describe('one redirect to the canonical URL (W2-5)', () => {
  const APEX = 'https://bladeblendstudio.se'
  const WWW = 'https://www.bladeblendstudio.se'

  const FIXED: readonly (readonly [string, string | null])[] = [
    ['/', '/'],
    ['/about', '/about'],
    ['/about/', '/about'],
    ['/About', '/about'],
    ['/ABOUT//', '/about'],
    ['/Booking', '/booking'],
    ['/my-bookings/', '/my-bookings'],
    ['/My-Bookings', '/my-bookings'],
    ['/contact', '/contact'],
    ['/Contact/', '/contact'],
    ['/contact.html', '/contact'],
    ['/CONTACT.HTML', '/contact'],
    ['/privacy.html/', '/privacy'],
    ['/Terms', '/terms'],
    ['/google-calendar.html', '/google-calendar'],
    ['/Google-Calendar', '/google-calendar'],
    ['/index.html', '/'],
    ['/INDEX.HTML', '/'],
    ['/index.html/', '/'],
    ['/login', '/login'],
    ['/Login/', '/login'],
    ['/RESET', '/reset'],
    ['/Invite', '/invite'],
    ['/auth/confirm/', '/auth/confirm'],
    ['/Auth/Confirm', '/auth/confirm'],
    ['/admin', '/admin'],
    ['/ADMIN', '/admin'],
    ['/admin/', '/admin'],
    ['/admin/cms/', '/admin/cms'],
    // Below /admin/ the app reads the rest of the path: its letters stay.
    ['/admin/Settings', '/admin/Settings'],
    ['/admin/Settings//', '/admin/Settings'],
    ['/Admin/settings', null],
    ['/ADMIN/cms', null],
    // Not a fixed route: a created page, a file, an /api/ path, a customer link, a near miss.
    ['/offers', null],
    ['/Offers', null],
    ['/assets/App.js', null],
    ['/sitemap.xml', null],
    ['/sitemap.xml/', null],
    ['/404.html', null],
    ['/500.html', null],
    ['/api/bookings', null],
    ['/API/bookings', null],
    [`/${'A'.repeat(64)}`, null],
    ['//', null],
    ['/about.html', null],
    ['/login.html', null],
    ['/administrator', null],
    ['/about/team', null],
  ]

  it.each(FIXED)('names the fixed route of %s as %s', (pathname, route) => {
    expect(fixedRoutePath(pathname)).toBe(route)
  })

  it('names a route that names itself, so no redirect leads to another', () => {
    for (const [, route] of FIXED)
      if (route !== null) expect(fixedRoutePath(route), route).toBe(route)
  })

  it('decides a path of 200 000 slashes or letters in linear time', () => {
    const started = performance.now()
    expect(fixedRoutePath('/login' + '/'.repeat(200_000) + 'x')).toBeNull()
    expect(fixedRoutePath('/About' + '/'.repeat(200_000))).toBe('/about')
    expect(fixedRoutePath('/admin/' + 'A'.repeat(200_000))).toBe('/admin/' + 'A'.repeat(200_000))
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  const offers: CmsPage = {
    id: '10000000-0000-4000-8000-000000000008',
    kind: 'page',
    path: '/offers',
    name: { sv: 'Erbjudanden', en: 'Offers' },
    title: { sv: 'Erbjudanden', en: 'Offers' },
    description: { sv: '', en: '' },
    inMenu: false,
    content: {
      sv: {
        html: '<main><h1>Erbjudanden</h1></main>',
        css: { light: 'body{color:#111}', dark: 'body{color:#eee}' },
      },
      en: {
        html: '<main><h1>Offers</h1></main>',
        css: { light: 'body{color:#111}', dark: 'body{color:#eee}' },
      },
    },
  }

  /** One request to the Worker in front of a publication that holds /offers (`readable` false: the
   * publication cannot be read). Returns the answer, the RPCs it read and the assets it fetched. */
  const visit = async (method: string, url: string, readable = true) => {
    const rpcs: string[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rpc = String(input).split('/').at(-1) ?? ''
      rpcs.push(rpc)
      return rpc === 'public_cms_presentation' && readable
        ? Response.json({
            revision: 7,
            presentation: { ...emptyDocument().presentation, pages: [offers] },
          })
        : new Response(null, { status: 503 })
    })
    const env = {
      ...createEnv(),
      SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_ANON_KEY: 'fixture-anon-key',
    }
    try {
      const response = await worker.fetch(
        new Request(url, { method, headers: { Accept: 'text/html' } }),
        env,
        createWorkerContext(env),
      )
      return { response, body: await response.text(), rpcs, assets: env.requestedPaths }
    } finally {
      fetchMock.mockRestore()
    }
  }

  const ONE_HOP: readonly (readonly [string, string])[] = [
    [`${WWW}/About/?lang=en&mode=dark`, `${APEX}/about?lang=en&mode=dark`],
    [`${WWW}/CONTACT.HTML?x=1`, `${APEX}/contact?x=1`],
    [`${WWW}/index.html`, `${APEX}/`],
    [`${WWW}/admin/Settings/`, `${APEX}/admin/Settings`],
    [`${APEX}/Booking`, `${APEX}/booking`],
    [`${APEX}/My-Bookings//`, `${APEX}/my-bookings`],
    [`${APEX}/Privacy`, `${APEX}/privacy`],
    [`${APEX}/TERMS.html`, `${APEX}/terms`],
    [`${APEX}/Login/?next=%2Fadmin`, `${APEX}/login?next=%2Fadmin`],
    [`${APEX}/Auth/Confirm?token_hash=AbC`, `${APEX}/auth/confirm?token_hash=AbC`],
    [`${APEX}/ADMIN`, `${APEX}/admin`],
    // Only the host: a file, an unknown path and an /api/ path keep their letters and slashes.
    [`${WWW}/assets/App.js?v=1`, `${APEX}/assets/App.js?v=1`],
    [`${WWW}/Not-A-Route/`, `${APEX}/Not-A-Route/`],
    [`${WWW}/api/cms/presentation?rev=21`, `${APEX}/api/cms/presentation?rev=21`],
  ]

  it.each(
    ['GET', 'HEAD'].flatMap((method) => ONE_HOP.map(([from, to]) => [method, from, to] as const)),
  )(
    'answers %s %s with one 308 to %s, which answers without another redirect',
    async (method, from, to) => {
      const first = await visit(method, from)
      expect(first.response.status).toBe(308)
      expect(first.response.headers.get('Location')).toBe(to)
      expect(first.body).toBe('')
      expect(first.assets).toEqual([])
      const second = await visit(method, to)
      expect([301, 302, 303, 307, 308]).not.toContain(second.response.status)
      expect(second.response.headers.has('Location')).toBe(false)
    },
  )

  it.each(
    ['GET', 'HEAD'].flatMap((method) =>
      (
        [
          [`${APEX}/Offers`, `${APEX}/offers`],
          [`${APEX}/offers/`, `${APEX}/offers`],
          [`${APEX}/OFFERS//?lang=en`, `${APEX}/offers?lang=en`],
          [`${WWW}/Offers/`, `${APEX}/offers`],
        ] as const
      ).map(([from, to]) => [method, from, to] as const),
    ),
  )(
    'answers %s %s with one 308 to the published page %s, after one read',
    async (method, from, to) => {
      const first = await visit(method, from)
      expect(first.response.status).toBe(308)
      expect(first.response.headers.get('Location')).toBe(to)
      expect(first.body).toBe('')
      expect(first.rpcs).toEqual(['public_cms_presentation'])
      expect(first.assets).toEqual([])
      // The page answers under its own path. HEAD: this file's assets hold no base stylesheet.
      const second = await visit('HEAD', to)
      expect(second.response.status).toBe(200)
      expect(second.rpcs).toEqual(['public_cms_presentation'])
    },
  )

  it.each([
    ['GET', '/Missing', true],
    ['GET', '/missing/', true],
    ['HEAD', '/Missing/', true],
    ['GET', '/Offers', false],
    ['GET', '/offers/', false],
    ['HEAD', '/offers/', false],
  ] as const)(
    'answers %s %s with 404, never a redirect or the page, when no published page is read there (publication readable: %s)',
    async (method, path, readable) => {
      const { response } = await visit(method, `${APEX}${path}`, readable)
      expect(response.status).toBe(404)
      expect(response.headers.has('Location')).toBe(false)
    },
  )

  it.each([
    ['POST', '/Offers'],
    ['POST', '/offers/'],
    ['GET', '/Logo.PNG'],
    ['GET', '/offers.html'],
    ['GET', '/sitemap.xml/'],
    ['GET', '/.well-known/Security.txt'],
    ['GET', '/Admin/settings'],
    ['GET', '/API/bookings'],
  ])('answers %s %s as written: no redirect and no read', async (method, path) => {
    const { response, rpcs } = await visit(method, `${APEX}${path}`)
    expect(response.status).toBe(404)
    expect(response.headers.has('Location')).toBe(false)
    expect(rpcs).toEqual([])
  })

  it.each(['GET', 'HEAD'])(
    'moves a customer link on the www host into the apex fragment in one %s answer, as written',
    async (method) => {
      // 64 hexadecimal characters in both letter cases, with trailing slashes.
      const token = 'aB3'.repeat(21) + 'c'
      const { response, rpcs, assets } = await visit(method, `${WWW}/${token}//`)
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe(`${APEX}/#booking_token=${token}`)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
      expect(rpcs).toEqual([])
      expect(assets).toEqual([])
    },
  )

  it('corrects the host of an /api/ path and nothing else', async () => {
    const www = await visit('POST', `${WWW}/api/customer-bookings?x=1`)
    expect(www.response.status).toBe(308)
    expect(www.response.headers.get('Location')).toBe(`${APEX}/api/customer-bookings?x=1`)
    for (const path of ['/api/customer-bookings/', '/api/cms/presentation/', '/api/Bookings']) {
      const { response, rpcs } = await visit('GET', `${APEX}${path}`)
      expect(response.status, path).toBe(404)
      expect(response.headers.has('Location'), path).toBe(false)
      expect(rpcs, path).toEqual([])
    }
  })
})
