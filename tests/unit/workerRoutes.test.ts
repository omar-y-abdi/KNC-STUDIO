import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import worker, {
  PublicContent,
  customerAccessTokenFromPath,
  isPrivatePath,
  isSpaPath,
  renderHomepageMetadata,
  renderLlmsText,
  renderPrivateMetadata,
  renderLegalMetadata,
} from '../../src/worker'
import {
  buildBusinessStructuredData,
  resolveBusinessSettings,
  type BusinessSettings,
} from '../../src/site/business'

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

  it('moves permanent customer credentials into a fragment before loading assets', async () => {
    const env = createEnv()
    const token = 'a'.repeat(64)
    expect(customerAccessTokenFromPath(`/${token}`)).toBe(token)
    expect(customerAccessTokenFromPath(`/${token}/extra`)).toBeNull()
    expect(customerAccessTokenFromPath(`/prefix/${token}`)).toBeNull()
    expect(customerAccessTokenFromPath(`/${token}?campaign=mail`)).toBeNull()
    expect(customerAccessTokenFromPath(`/${token.slice(1)}`)).toBeNull()

    const response = await worker.fetch(new Request(`https://bladeblendstudio.se/${token}`), env)

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
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(await response.text()).toBe('<main>homepage</main>')
    expect(env.requestedPaths).toEqual(['/admin/settings', '/index.html'])
  })

  it('returns a genuine noindex 404 for unknown paths', async () => {
    const env = createEnv()
    const response = await worker.fetch(new Request('https://bladeblendstudio.se/not-a-route'), env)

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
    )
    const filenameResponse = await worker.fetch(
      new Request('https://bladeblendstudio.se/privacy.html?lang=sv'),
      env,
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

  it('share-caches homepage metadata only after successful discovery', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ settings: {}, barbers: [], services: [], schedules: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const env = {
      ...createEnv(),
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
    }

    try {
      const response = await worker.fetch(
        new Request('https://bladeblendstudio.se/'),
        env,
        createWorkerContext(env),
      )
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300')
      expect(fetchMock).toHaveBeenCalledOnce()
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
    )
    expect(response.status).toBe(path.endsWith('/') ? 308 : 200)
  })

  it('keeps a missing HEAD empty and returns a real 404', async () => {
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/missing', { method: 'HEAD' }),
      createEnv(),
    )
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })

  it('redirects the alternate homepage file to its canonical URL', async () => {
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/index.html'),
      createEnv(),
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

  it.each(['privacy', 'terms'])(
    '%s supplies metadata, one h1, internal links and no app bundle',
    (page) => {
      const html = readFileSync(new URL(`../../public/${page}.html`, import.meta.url), 'utf8')
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
