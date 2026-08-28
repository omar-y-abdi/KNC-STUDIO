import { describe, expect, it, vi } from 'vitest'
import worker, {
  customerAccessTokenFromPath,
  isPrivatePath,
  isSpaPath,
  renderHomepageMetadata,
  renderLlmsText,
} from '../../src/worker'
import { buildBusinessStructuredData, type BusinessSettings } from '../../src/site/business'

const assetBodies: Readonly<Record<string, string>> = {
  '/index.html': '<main>homepage</main>',
  '/privacy.html': '<main>privacy</main>',
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

describe('Worker route policy', () => {
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

  it('moves permanent customer credentials into a fragment before loading assets', async () => {
    const env = createEnv()
    const token = 'a'.repeat(64)
    expect(customerAccessTokenFromPath(`/${token}`)).toBe(token)

    const response = await worker.fetch(new Request(`https://bladeblendstudio.se/${token}`), env)

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      `https://bladeblendstudio.se/#booking_token=${token}`,
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
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
    expect(env.requestedPaths).toEqual(['/not-a-route'])
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
      const response = await worker.fetch(new Request('https://bladeblendstudio.se/'), env)
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
