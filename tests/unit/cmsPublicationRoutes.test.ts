import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../src/worker'
import { emptyPresentation, type CmsPresentation } from '../../shared/cms'

const context = { exports: { PublicContent: { fetch: async () => new Response('unused') } } }
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; font-src 'self'"
const shell =
  '<!doctype html><html><head><title id="business-title">Original</title><meta id="business-description" name="description" content="Old"><link rel="canonical" href="https://bladeblendstudio.se/"><meta property="og:url" content="https://bladeblendstudio.se/"><script type="module" src="/assets/site.js"></script></head><body><div id="root"></div></body></html>'
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
