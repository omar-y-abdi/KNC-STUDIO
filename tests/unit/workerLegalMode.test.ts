import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { emptyDocument, type CmsPage } from '../../shared/cms'
import { validateMarkup } from '../../shared/cms-markup'
import { createSitePage, SITE_PAGE_CSS } from '../../shared/site-page'
import { DEFAULT_BUSINESS, SCHEMA_DAYS, type BusinessOpeningHours } from '../../src/site/business'
import worker, { renderContactMetadata } from '../../src/worker'

// TST-2: /terms rendered by the Worker itself, not the static fallback file. The built shell shape
// (entry script, preload, stylesheet in <head>) is derived from the real index.html.
const shell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  .replace('<script type="module" src="/src/main.tsx"></script>', '')
  .replace(
    '</head>',
    '<script type="module" crossorigin src="/assets/entry.js"></script><link rel="modulepreload" crossorigin href="/assets/chunk.js"><link rel="stylesheet" crossorigin href="/assets/entry.css"></head>',
  )
const legalCss =
  ':root{color:#1c1c1e;background:#f4f3f0}@media (prefers-color-scheme: dark){:root{color:#f5f5f7;background:#1c1c1e}}'
const terms: CmsPage = {
  id: '10000000-0000-4000-8000-000000000006',
  kind: 'terms',
  path: '/terms',
  name: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  title: { sv: 'Bokningsvillkor', en: 'Booking terms' },
  description: { sv: '', en: '' },
  inMenu: false,
  content: {
    sv: { html: '<main><h1>Bokningsvillkor</h1></main>', css: { light: legalCss, dark: legalCss } },
    en: { html: '<main><h1>Booking terms</h1></main>', css: { light: legalCss, dark: legalCss } },
  },
}
const presentation = { ...emptyDocument().presentation, pages: [terms] }

const publicFile = (path: string): string =>
  readFileSync(new URL(`../../public${path}`, import.meta.url), 'utf8')
const env = {
  SUPABASE_URL: 'https://fixture.invalid',
  SUPABASE_ANON_KEY: 'fixture-anon-key',
  ASSETS: {
    fetch: async (input: Request | URL | string): Promise<Response> => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === '/index.html')
        return new Response(shell, { headers: { 'Content-Type': 'text/html' } })
      if (path === '/info.css' || path === '/tokens.css')
        return new Response(publicFile(path), { headers: { 'Content-Type': 'text/css' } })
      return new Response('Not found', { status: 404 })
    },
  },
}
const noPublicContent = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}

async function renderTerms(query: string): Promise<string> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/rpc/public_cms_presentation')
      ? Response.json({ revision: 7, presentation })
      : new Response(null, { status: 503 }),
  )
  const response = await worker.fetch(
    new Request(`https://bladeblendstudio.se/terms${query}`),
    env,
    noPublicContent,
  )
  expect(response.status).toBe(200)
  return response.text()
}

function sheet(html: string, id: string): string {
  const start = html.indexOf(`<style id="${id}"`)
  if (start < 0) return ''
  const content = html.indexOf('>', start) + 1
  return html.slice(content, html.indexOf('</style>', content))
}

describe('Worker /terms colour scheme', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['', '?mode=sepia'])('follows the visitor OS scheme for /terms%s', async (query) => {
    const html = await renderTerms(query)
    expect(html).toContain('data-cms-public="1" data-cms-mode="auto"')
    expect(html).toContain('<style id="cms-page-light" media="(prefers-color-scheme: light)">')
    expect(html).toContain('<style id="cms-page-dark" media="(prefers-color-scheme: dark)">')
    expect(sheet(html, 'cms-page-light')).toBe(':root{color:#1c1c1e;background:#f4f3f0}')
    expect(sheet(html, 'cms-page-dark')).toMatch(/:root\{color:#f5f5f7;background:#1c1c1e\}$/)
    expect(html).toContain('<style id="cms-reset">html,body{background:none}</style>')
    expect(html).not.toMatch(/<script\b[^>]*type="module"/)
  })

  it.each(['', '?mode=dark'])(
    'inlines the token and layout base before the stored CSS (/terms%s)',
    async (query) => {
      const html = await renderTerms(query)
      expect(sheet(html, 'cms-base')).toBe(
        `${publicFile('/tokens.css')}\n${publicFile('/info.css')}`,
      )
      const base = html.indexOf('<style id="cms-base">')
      expect(base).toBeGreaterThan(html.indexOf('<style id="cms-reset">'))
      expect(base).toBeLessThan(html.indexOf('<style id="cms-page-'))
    },
  )

  it('pins /terms?mode=dark to the dark sheet and colour scheme', async () => {
    const html = await renderTerms('?mode=dark')
    expect(html).toContain('data-cms-mode="dark"')
    expect(html).not.toContain('cms-page-light')
    expect(sheet(html, 'cms-page-dark')).toMatch(/:root\{color:#f5f5f7;background:#1c1c1e\}$/)
    expect(html).toContain('<meta name="color-scheme" content="dark" />')
  })
})

describe('Worker current pages containing shell lookalikes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    '<main><!-- <div id="cms-site-shell"> --><p>Owner text</p></main>',
    '<main title=\' id="cms-site-shell"\'><p>Owner text</p></main>',
  ])('keeps the live header and site base for either language: %s', async (body) => {
    expect(() =>
      validateMarkup(body, '', {
        siteOrigin: 'https://bladeblendstudio.se',
        storageOrigin: 'https://fixture.invalid',
      }),
    ).not.toThrow()
    for (const lang of ['sv', 'en'] as const) {
      const page = createSitePage({
        id: '10000000-0000-4000-8000-000000000099',
        path: '/owner-page',
        name: { sv: 'Ägarens sida', en: 'Owner page' },
      })
      page.content[lang].html = body
      const presentation = { ...emptyDocument().presentation, pages: [page] }
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation })
          : new Response(null, { status: 503 }),
      )
      const response = await worker.fetch(
        new Request(`https://bladeblendstudio.se/owner-page?lang=${lang}&mode=dark`),
        env,
        noPublicContent,
      )
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('<header id="cms-site-header">')
      expect(html).toContain('<nav id="cms-site-menu"')
      expect(html).toContain('Owner text')
      expect(sheet(html, 'cms-base')).toBe(`${publicFile('/tokens.css')}\n${SITE_PAGE_CSS}`)
      expect(html).toContain('data-cms-mode="dark"')
    }
  })
})

const contactSource = publicFile('/contact.html')
const contactBody = contactSource
  .slice(contactSource.indexOf('<body>') + '<body>'.length, contactSource.indexOf('</body>'))
  .replace('data-business-name', 'id="owner-name" data-business-name="" class="owner"')
  .replace('<div id="contact-details">', '<div id="contact-details"><div>Stale nested detail</div>')
const contact: CmsPage = {
  ...terms,
  id: '10000000-0000-4000-8000-000000000007',
  kind: 'page',
  path: '/contact',
  layout: 'independent',
  title: { sv: 'Ägarens kontaktsida', en: 'Owner contact page' },
  content: Object.fromEntries(
    ['sv', 'en'].map((lang) => [
      lang,
      {
        html: contactBody + '<p>Ägarens redigerbara kontakttext</p>',
        css: { light: '.owner-copy{margin:1rem}', dark: '.owner-copy{margin:2rem}' },
      },
    ]),
  ) as CmsPage['content'],
}
const contactDiscovery = {
  settings: {
    business_name: 'Aktuell & Salong',
    business_street: 'Ny & Gata 12',
    business_postal_code: '123 45',
    business_city: 'Malmö',
    business_phone_display: '040-123 45 67',
    business_phone_tel: '+46401234567',
    business_email: 'current@example.test',
  },
  barbers: [{ id: '20000000-0000-4000-8000-000000000001', name: 'Aktuell barberare' }],
  services: [],
  schedules: [
    { barber_id: '20000000-0000-4000-8000-000000000001', weekday: 1, start_min: 600, end_min: 720 },
    {
      barber_id: '20000000-0000-4000-8000-000000000001',
      weekday: 1,
      start_min: 840,
      end_min: 1080,
    },
  ],
}

describe('Worker CMS contact and static fallback', () => {
  afterEach(() => vi.restoreAllMocks())

  const contactAssets = {
    ...env,
    ASSETS: {
      fetch: async (input: Request | URL | string): Promise<Response> =>
        new URL(input instanceof Request ? input.url : input).pathname === '/contact.html'
          ? new Response(contactSource, { headers: { 'Content-Type': 'text/html' } })
          : env.ASSETS.fetch(input),
    },
  }
  const requestContact = (method = 'GET') =>
    worker.fetch(
      new Request('https://bladeblendstudio.se/contact', { method }),
      contactAssets,
      noPublicContent,
    )
  const expectLiveFacts = (html: string) => {
    expect(html).toContain('Ny &amp; Gata 12, 123 45 Malmö')
    expect(html).toContain('tel:+46401234567')
    expect(html).toContain('040-123 45 67')
    expect(html).toContain('mailto:current@example.test')
    expect(html).toContain('Måndag')
    expect(html).toContain('10:00–12:00')
    expect(html).toContain('14:00–18:00')
    expect(html).not.toContain('Geijersgatan 10')
    expect(html).not.toContain('tel:0793043671')
    expect(html).not.toContain('Stale nested detail')
  }

  it('renders the editable CMS contact with current phone, address, hours and token base', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/rpc/public_cms_presentation')
        ? Response.json({ revision: 7, presentation: { ...presentation, pages: [contact] } })
        : Response.json(contactDiscovery),
    )
    const response = await requestContact()
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('Ägarens redigerbara kontakttext')
    expect(html).toContain('Ägarens kontaktsida')
    expect(html).toContain('data-cms-public="1"')
    expect(sheet(html, 'cms-base')).toBe(`${publicFile('/tokens.css')}\n${publicFile('/info.css')}`)
    expect(html).toContain('class="bb-page bb-doc"')
    expectLiveFacts(html)
    expect(html).toContain(
      'id="owner-name" data-business-name="" class="owner">Aktuell &amp; Salong</span>',
    )
    expect(html).not.toMatch(/<script\b[^>]*type="module"/)
  })

  it('fills the CMS fragment without reserialising any shell bytes compared with terms', async () => {
    const opaque = '<meta NAME = "opaque" content=\'a &amp; b\' >'
    const markedShell = shell
      .replace('</head>', `${opaque}\r\n</head>`)
      .replace('<div id="root"></div>', '<!--page-start--><div id="root"></div><!--page-end-->')
      .replace('</body>', "<p DATA-opaque='tail'>Outside the page</p>\r\n</body>")
    const reference = structuredClone(contact)
    reference.kind = 'terms'
    reference.path = '/terms'
    delete reference.layout
    let published = reference
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/rpc/public_cms_presentation')
        ? Response.json({ revision: 7, presentation: { ...presentation, pages: [published] } })
        : Response.json(contactDiscovery),
    )
    const markedEnv = {
      ...env,
      ASSETS: {
        fetch: async (input: Request | URL | string): Promise<Response> =>
          new URL(input instanceof Request ? input.url : input).pathname === '/index.html'
            ? new Response(markedShell)
            : env.ASSETS.fetch(input),
      },
    }
    const outsidePage = (html: string): string =>
      html
        .replace(/<!--page-start-->[\s\S]*?<!--page-end-->/, '<!--page-->')
        .replaceAll('https://bladeblendstudio.se/terms', 'https://bladeblendstudio.se/contact')
    const termsResponse = await worker.fetch(
      new Request('https://bladeblendstudio.se/terms'),
      markedEnv,
      noPublicContent,
    )
    published = contact
    const contactResponse = await worker.fetch(
      new Request('https://bladeblendstudio.se/contact'),
      markedEnv,
      noPublicContent,
    )
    expect(contactResponse.status).toBe(200)
    const html = await contactResponse.text()
    expectLiveFacts(html)
    expect(html).toContain(opaque)
    expect(outsidePage(html)).toBe(outsidePage(await termsResponse.text()))
    expect(published.content.sv.html).toContain('Stale nested detail')
  })

  it('keeps fallback head and outer bytes intact while filling only its body', () => {
    const prefix =
      "<!doctype html>\r\n<html><head><meta NAME = \"opaque\" content='a &amp; b' ></head><body class='contact'>"
    const suffix = '</body>\r\n</html><!--opaque-tail-->'
    const html = renderContactMetadata(prefix + contactBody + suffix, DEFAULT_BUSINESS)
    expect(html.startsWith(prefix)).toBe(true)
    expect(html.endsWith(suffix)).toBe(true)
    expect(html).not.toContain('Stale nested detail')
    expect(html).toContain('tel:0793043671')
  })

  it('types every opening day as the schema weekday union and renders every Swedish label', () => {
    expectTypeOf<BusinessOpeningHours['dayOfWeek'][number]>().toEqualTypeOf<
      'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'
    >()
    const html = renderContactMetadata(contactSource, DEFAULT_BUSINESS, {
      barbers: [{ id: 'active', name: 'Active' }],
      services: [],
      schedules: SCHEMA_DAYS.map((_day, weekday) => ({
        barberId: 'active',
        weekday,
        startMin: 600,
        endMin: 720,
      })),
    })
    for (const day of ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'])
      expect(html).toContain(day)
    expect(html).not.toContain('undefined')
  })

  it.each(['missing', 'stalled'] as const)(
    'serves the tokenised static contact with live facts when the CMS lookup is %s',
    async (failure) => {
      const realTimeout = AbortSignal.timeout.bind(AbortSignal)
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(1))
      const rpcs: string[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const rpc = String(input).split('/').at(-1) ?? ''
        rpcs.push(rpc)
        if (rpc === 'public_business_discovery') return Response.json(contactDiscovery)
        if (failure === 'missing') return Response.json({ revision: 7, presentation })
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (!signal) throw new Error('CMS lookup has no timeout')
          if (signal.aborted) reject(signal.reason)
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })
      const response = await requestContact()
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).not.toContain('data-cms-public="1"')
      expect(html).toContain('href="/tokens.css"')
      expect(html).toContain('href="/info.css"')
      expectLiveFacts(html)
      expect(rpcs.sort()).toEqual(['public_business_discovery', 'public_cms_presentation'])
      if (failure === 'stalled') expect(timeout).toHaveBeenCalledWith(1800)
    },
  )

  it('keeps contact HEAD bodyless without reading discovery or the base sheets', async () => {
    const assets = vi.spyOn(env.ASSETS, 'fetch')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ revision: 7, presentation: { ...presentation, pages: [contact] } }),
      )
    const response = await requestContact('HEAD')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/rpc/public_cms_presentation')
    expect(assets).toHaveBeenCalledOnce()
    const input = assets.mock.calls[0]?.[0]
    expect(input instanceof Request ? new URL(input.url).pathname : '').toBe('/index.html')
  })
})
