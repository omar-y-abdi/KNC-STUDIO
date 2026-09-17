import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../src/worker'
import { emptyPresentation, type CmsPresentation } from '../../shared/cms'
import { LEGAL_DEFAULTS } from '../../shared/cms-legal-defaults'

const context = { exports: { PublicContent: { fetch: async () => new Response('unused') } } }
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; font-src 'self'"
const shell =
  '<!doctype html><html><head><title id="business-title">Original</title><meta id="business-description" name="description" content="Old"><link rel="canonical" href="https://bladeblendstudio.se/"><meta property="og:url" content="https://bladeblendstudio.se/"><meta property="og:locale" content="sv_SE"><meta property="og:locale:alternate" content="en_US"><script type="module" src="/assets/site.js"></script></head><body><div id="root"></div></body></html>'
function env() {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'public-anon-key',
    ASSETS: {
      fetch: async (input: Request | URL | string) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        )
        const html =
          url.pathname === '/index.html'
            ? shell
            : url.pathname === '/terms.html'
              ? '<h1>Original terms</h1>'
              : '<h1>Missing</h1>'
        return new Response(html, {
          status: ['/index.html', '/terms.html', '/404.html'].includes(url.pathname) ? 200 : 404,
          headers: {
            'content-type': 'text/html',
            'content-security-policy': csp,
            'x-frame-options': 'DENY',
          },
        })
      },
    },
  }
}
function presentation(): CmsPresentation {
  const value = emptyPresentation()
  value.pages.push({
    id: 'e281a5f5-fb7e-4db2-ac3d-916f791ae967',
    kind: 'page',
    path: '/studio-guide',
    name: { sv: 'Guide', en: 'Guide' },
    title: { sv: 'Studions guide', en: 'Studio guide' },
    description: { sv: 'Information om studion.', en: 'Information about the studio.' },
    inMenu: true,
    content: {
      sv: {
        html: '<main><h1>Välkommen hit</h1><p>Publicerad text</p></main>',
        css: { light: 'h1{color:#123456}', dark: 'h1{color:#abcdef}' },
      },
      en: {
        html: '<main><h1>Welcome here</h1><p>Published text</p></main>',
        css: { light: 'h1{color:#123456}', dark: 'h1{color:#abcdef}' },
      },
    },
  })
  return value
}
function legalPresentation(): CmsPresentation {
  const value = emptyPresentation()
  const pages = [
    {
      id: '39c9de6b-fc88-42e0-970f-c544183752c1',
      path: '/privacy' as const,
      key: 'privacy' as const,
      sv: 'CMS privacy override SV',
      en: 'CMS privacy override EN',
    },
    {
      id: 'dc5c405c-5219-4741-a8f9-491f3dc4dba0',
      path: '/terms' as const,
      key: 'terms' as const,
      sv: 'CMS terms override SV',
      en: 'CMS terms override EN',
    },
  ]
  for (const item of pages) {
    const defaults = LEGAL_DEFAULTS[item.key]
    value.pages.push({
      id: item.id,
      kind: 'page',
      path: item.path,
      name: { sv: item.key, en: item.key },
      title: { sv: item.key, en: item.key },
      description: { sv: item.key, en: item.key },
      inMenu: false,
      content: {
        sv: {
          html: `${defaults.sv.html}<p>${item.sv}</p>`,
          css: { ...defaults.sv.css },
        },
        en: {
          html: `${defaults.en.html}<p>${item.en}</p>`,
          css: { ...defaults.en.css },
        },
      },
    })
  }
  return value
}

const currentBusinessDiscovery = {
  settings: {
    business_name: 'Current KNC Studio',
    business_legal_name: 'Current KNC Studio AB',
    business_org_number: '559999-1234',
    business_email: 'legal@current.example',
    business_phone_display: '031-123 45 67',
    business_phone_tel: '0311234567',
    business_street: 'Currentgatan 7',
    business_postal_code: '411 11',
    business_city: 'Göteborg',
    business_maps_href: 'https://maps.example/current',
    cancellation_policy_hours: '36',
  },
  barbers: [],
  services: [],
  schedules: [],
}

function rpcWithDiscovery(value: CmsPresentation = legalPresentation()) {
  const fetcher = vi.fn(async (input: Request | URL | string) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/rest/v1/rpc/public_cms_presentation'))
      return Response.json({ revision: 3, presentation: value })
    if (url.endsWith('/rest/v1/rpc/public_business_discovery'))
      return Response.json(currentBusinessDiscovery)
    return new Response('unexpected RPC', { status: 500 })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

function rpc(value: unknown = { revision: 2, presentation: presentation() }) {
  const fetcher = vi.fn(async () => Response.json(value))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const request = (path: string, init?: RequestInit) =>
  new Request(`https://bladeblendstudio.se${path}`, init)
afterEach(() => vi.unstubAllGlobals())

describe('CMS publication through the actual Worker', () => {
  it('reads only the anonymous published presentation and strips unknown response fields', async () => {
    const fetcher = rpc({
      revision: 2,
      presentation: presentation(),
      privateDocument: 'must-never-leak',
    })
    const response = await worker.fetch(
      request('/api/cms/presentation', {
        headers: { cookie: 'session=private', authorization: 'Bearer private-owner-token' },
      }),
      env(),
      context,
    )
    expect(response.status).toBe(200)
    const value = await response.json()
    expect(value).toEqual({ revision: 2, presentation: presentation() })
    expect(response.headers.get('cache-control')).toContain('no-store')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/public_cms_presentation')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer public-anon-key')
    expect(headers.has('cookie')).toBe(false)
  })
  it('does not expose a public write endpoint', async () => {
    const fetcher = rpc()
    const response = await worker.fetch(
      request('/api/cms/presentation', { method: 'POST', body: '{}' }),
      env(),
      context,
    )
    expect(response.status).toBe(405)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('serves a published new page with real HTML and its own metadata', async () => {
    rpc()
    const response = await worker.fetch(request('/studio-guide'), env(), context)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<h1>Välkommen hit</h1>')
    expect(html).toContain('Studions guide')
    expect(html).toContain('Information om studion.')
    expect(html).toContain('https://bladeblendstudio.se/studio-guide')
    expect(html).toContain('property="og:locale" content="sv_SE"')
    expect(html).toContain('property="og:locale:alternate" content="en_US"')
    expect(html).not.toContain('<h1>Missing</h1>')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('selects the actual saved English content and dark design', async () => {
    rpc()
    const response = await worker.fetch(request('/studio-guide?lang=en&mode=dark'), env(), context)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('Welcome here')
    expect(html).toContain('Studio guide')
    expect(html).toContain('#abcdef')
    expect(html).toContain('property="og:locale" content="en_US"')
    expect(html).toContain('property="og:locale:alternate" content="sv_SE"')
    expect(html).not.toContain('Välkommen hit')
  })
  it('canonicalizes trailing slashes without dropping the chosen language', async () => {
    rpc()
    const response = await worker.fetch(request('/studio-guide/?lang=en'), env(), context)
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      'https://bladeblendstudio.se/studio-guide?lang=en',
    )
  })
  it('has a correct HEAD response for a database-only page', async () => {
    rpc()
    const response = await worker.fetch(
      request('/studio-guide', { method: 'HEAD' }),
      env(),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('content-type')).toContain('text/html')
  })
  it('keeps an unpublished URL a real 404', async () => {
    rpc()
    const response = await worker.fetch(request('/never-published'), env(), context)
    expect(response.status).toBe(404)
  })
  it('does not turn a backend failure into a misleading successful empty presentation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private database message', { status: 500 })),
    )
    const response = await worker.fetch(request('/api/cms/presentation'), env(), context)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private database message')
  })
  it('refuses unsafe stored markup even when it came from a backend response', async () => {
    const value = presentation()
    const page = value.pages[0]
    if (!page) throw new Error('Missing page fixture')
    page.content.sv.html = '<h1>Bad</h1><script>alert(1)</script>'
    rpc({ revision: 2, presentation: value })
    const response = await worker.fetch(request('/studio-guide'), env(), context)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('alert(1)')
  })
  it.each([
    ['/privacy', 'CMS privacy override SV', 'Current KNC Studio AB'],
    ['/privacy?lang=en', 'CMS privacy override EN', 'Current KNC Studio AB'],
    ['/terms', 'CMS terms override SV', 'Avboka senast 36 timmar före den bokade tiden.'],
    ['/terms?lang=en', 'CMS terms override EN', 'Cancel at least 36 hours before your appointment.'],
  ])(
    'enriches CMS-authored legal route %s with current server-owned facts',
    async (path, override, expectedLegalText) => {
      rpcWithDiscovery()
      const response = await worker.fetch(request(path), env(), context)
      const html = await response.text()

      expect(response.status).toBe(200)
      expect(html).toContain(override)
      expect(html).toContain('data-business-name>Current KNC Studio</span>')
      expect(html).toContain('Current KNC Studio AB')
      expect(html).toContain('559999-1234')
      expect(html).toContain('Currentgatan 7, 411 11 Göteborg')
      expect(html).toContain('legal@current.example')
      expect(html).toContain(expectedLegalText)
      expect(html).not.toContain('data-business-name="">salongen</span>')
      expect(response.headers.get('cache-control')).toContain('no-store')
    },
  )

  it('rejects a published CMS legal page that removes a required server-owned slot', async () => {
    const value = legalPresentation()
    const terms = value.pages.find((page) => page.path === '/terms')
    if (!terms) throw new Error('Missing terms fixture')
    terms.content.en.html = terms.content.en.html.replace(
      'id="cancellation-policy-en"',
      'id="removed-cancellation-policy-en"',
    )
    rpc({ revision: 3, presentation: value })

    const response = await worker.fetch(request('/terms?lang=en'), env(), context)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('CMS terms override EN')
  })

  it('retains original legal pages when no CMS override is published', async () => {
    rpc({ revision: 0, presentation: emptyPresentation() })
    const response = await worker.fetch(request('/terms'), env(), context)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Original terms')
  })
})

describe('preview-specific framing policy', () => {
  it('permits only same-origin embedding of the owner-gated preview route', async () => {
    const response = await worker.fetch(
      request('/admin/cms/preview?channel=example'),
      env(),
      context,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'")
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
  })
  it('keeps other admin routes unframeable while allowing their own child canvas', async () => {
    const response = await worker.fetch(request('/admin/cms'), env(), context)
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('content-security-policy')).toMatch(/frame-src [^;]*'self'/)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })
})
