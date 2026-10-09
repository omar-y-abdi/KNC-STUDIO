import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import worker, { PublicContent, renderContactMetadata, renderLlmsText } from '../../src/worker'
import {
  buildBusinessStructuredData,
  DEFAULT_BUSINESS,
  EMPTY_BUSINESS_FACTS,
} from '../../src/site/business'

type HtmlNode = DefaultTreeAdapterMap['node']

const SITE = 'https://bladeblendstudio.se'
const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

function visibleText(html: string): { text: string; headings: string[] } {
  const document = parse(html)
  const headings: string[] = []
  const text: string[] = []
  const walk = (node: HtmlNode, excluded = false): void => {
    const tag = 'tagName' in node ? node.tagName : ''
    const hidden = excluded || ['head', 'script', 'style', 'noscript', 'template'].includes(tag)
    if (!hidden && /^h[1-6]$/.test(tag)) headings.push(tag)
    if (!hidden && node.nodeName === '#text' && 'value' in node) text.push(node.value)
    if ('childNodes' in node) node.childNodes.forEach((child) => walk(child, hidden))
  }
  walk(document)
  return { text: text.join(' ').replace(/\s+/g, ' ').trim(), headings }
}

function createEnv() {
  return {
    ASSETS: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const req = input instanceof Request ? input : new Request(input)
        const path = new URL(req.url).pathname
        const source = path === '/index.html' ? 'index.html' : `public${path}`
        try {
          return new Response(read(source), {
            status: 200,
            headers: {
              'Content-Type': path.endsWith('.xml')
                ? 'application/xml'
                : path.endsWith('.txt')
                  ? 'text/plain'
                  : 'text/html',
            },
          })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      },
    },
  }
}

async function get(path: string, accept = 'text/html', method: 'GET' | 'HEAD' = 'GET') {
  const env = createEnv()
  const publicContent = new PublicContent({} as never, env)
  return worker.fetch(new Request(`${SITE}${path}`, { method, headers: { Accept: accept } }), env, {
    exports: { PublicContent: { fetch: (req: Request) => publicContent.fetch(req) } },
  })
}

describe('agent-ready public representations', () => {
  it.each(['/', '/about'])(
    '%s has substantive visible raw HTML without executing JavaScript',
    async (path) => {
      const result = await get(path)
      expect(result.status).toBe(200)
      const html = await result.text()
      const { text, headings } = visibleText(html)
      expect(text.length).toBeGreaterThanOrEqual(500)
      expect(text).toContain('Blade & Blend Studio')
      expect(headings[0]).toBe('h1')
      expect(headings.filter((heading) => heading === 'h1')).toHaveLength(1)
      expect(headings.slice(1).every((heading) => heading === 'h2')).toBe(true)
      expect(html).toContain('href="/contact"')
      expect(html).toContain('href="/privacy"')
      expect(html).toContain('id="root"')
    },
  )

  it.each([
    ['text/markdown', 200, 'text/markdown'],
    ['text/markdown, text/html;q=0.7', 200, 'text/markdown'],
    ['text/html', 200, 'text/html'],
    ['text/html;q=0.9, text/markdown;q=0.6', 200, 'text/html'],
    ['text/html;q=0, text/markdown', 200, 'text/markdown'],
    ['text/markdown;q=0, text/html', 200, 'text/html'],
    ['*/*', 200, 'text/html'],
    ['application/json', 406, 'text/plain'],
    ['text/markdown;q=0, text/html;q=0', 406, 'text/plain'],
  ])('negotiates homepage Accept: %s', async (accept, expectedStatus, expectedType) => {
    const response = await get('/', String(accept))
    expect(response.status).toBe(expectedStatus)
    expect(response.headers.get('Content-Type')).toContain(expectedType)
    expect(
      response.headers
        .get('Vary')
        ?.toLowerCase()
        .split(',')
        .map((x) => x.trim()),
    ).toContain('accept')
    const body = await response.text()
    if (expectedType === 'text/markdown') {
      expect(body).toMatch(/^# Blade & Blend Studio/)
      expect(body.length).toBeGreaterThan(500)
      expect(body).toContain('https://bladeblendstudio.se/contact')
      expect(body).not.toContain('<html')
    }
    if (expectedType === 'text/html') expect(body).toContain('<html')
  })

  it('isolates Markdown from the URL-only cached public-content entrypoint', async () => {
    const env = createEnv()
    const publicContent = new PublicContent({} as never, env)
    const forwarded = vi.fn((request: Request) => publicContent.fetch(request))
    const context = { exports: { PublicContent: { fetch: forwarded } } }

    const markdown = await worker.fetch(
      new Request(SITE + '/', { headers: { Accept: 'text/markdown' } }),
      env,
      context,
    )
    expect(markdown.headers.get('Content-Type')).toContain('text/markdown')
    expect(forwarded).not.toHaveBeenCalled()

    const html = await worker.fetch(
      new Request(SITE + '/', { headers: { Accept: 'text/html' } }),
      env,
      context,
    )
    expect(html.headers.get('Content-Type')).toContain('text/html')
    expect(forwarded).toHaveBeenCalledOnce()
  })

  it('escapes the latest CMS contact identity and replaces placeholder details', () => {
    const hostileName = '<img src=x onerror=alert(1)> Studio'
    const rendered = renderContactMetadata(read('public/contact.html'), {
      ...DEFAULT_BUSINESS,
      name: hostileName,
      street: 'New & Safer 12',
      city: 'Malmö',
      email: 'current@example.test',
      phoneDisplay: '',
      phoneTel: '',
    })
    expect(rendered).not.toContain('<img src=x onerror=alert(1)>')
    expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt; Studio')
    expect(rendered).toContain('New &amp; Safer 12')
    expect(rendered).toContain('mailto:current@example.test')
    expect(rendered).not.toContain('mailto:booking@mail.bladeblendstudio.se')
    expect(rendered).not.toContain('tel:0793043671')
    expect(rendered).toContain('rel="canonical" href="' + SITE + '/contact"')
  })

  it('supports HEAD without a response body, retaining negotiation headers', async () => {
    const response = await get('/', 'text/markdown', 'HEAD')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/markdown')
    expect(response.headers.get('Vary')).toContain('Accept')
    expect(await response.text()).toBe('')
  })

  it('returns a genuine Markdown 404 with navigation and noindex', async () => {
    const response = await get('/__ora-404-probe-5z2g7gib', 'text/markdown')
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toContain('text/markdown')
    expect(response.headers.get('Vary')).toContain('Accept')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    const body = await response.text()
    expect(body.length).toBeGreaterThan(20)
    expect(body).toMatch(/^# 404/)
    expect(body).toContain('/llms.txt')
    expect(body).toContain('/sitemap.xml')
  })

  it('provides genuine About, Contact and Privacy trust pages', async () => {
    for (const path of ['/about', '/contact', '/privacy']) {
      const response = await get(path)
      expect(response.status).toBe(200)
      const body = await response.text()
      const visible = visibleText(body)
      expect(visible.text.length, path).toBeGreaterThanOrEqual(500)
      expect(visible.headings[0], path).toBe('h1')
      expect(body, path).toContain(`https://bladeblendstudio.se${path}`)
    }
    const redirect = await get('/contact.html')
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('Location')).toBe(`${SITE}/contact`)
  })

  it('publishes a compliant llms.txt file with specific when-to-use guidance', () => {
    const fallback = read('public/llms.txt')
    const generated = renderLlmsText({ business: DEFAULT_BUSINESS, facts: EMPTY_BUSINESS_FACTS })
    for (const value of [fallback, generated]) {
      expect(value).toMatch(/^# Blade & Blend Studio\n\n> /)
      expect(value.toLowerCase()).toContain('when to use')
      expect(value).toContain(`[Kontakt](${SITE}/contact)`)
      expect(value).toContain(`[Om salongen](${SITE}/about)`)
      expect(value).toContain(`[Integritetspolicy](${SITE}/privacy)`)
    }
  })

  it('identifies each listed barber as a structured Person working for the HairSalon', () => {
    const schema = buildBusinessStructuredData(
      DEFAULT_BUSINESS,
      {
        ...EMPTY_BUSINESS_FACTS,
        barbers: [{ id: 'barber-1', name: 'Sample barber' }],
      },
      SITE,
    )
    expect(schema['@type']).toBe('HairSalon')
    expect(schema['employee']).toMatchObject([
      {
        '@type': 'Person',
        name: 'Sample barber',
        jobTitle: 'Barberare',
        url: `${SITE}/about`,
        worksFor: { '@id': `${SITE}/#business` },
      },
    ])
    expect(
      (schema['employee'] as { description: string }[])[0]?.description.length,
    ).toBeGreaterThan(30)
  })

  it('lists all trust anchors in the canonical sitemap', () => {
    const sitemap = read('public/sitemap.xml')
    for (const path of ['/', '/about', '/contact', '/privacy'])
      expect(sitemap).toContain(`<loc>${SITE}${path}</loc>`)
  })
})
