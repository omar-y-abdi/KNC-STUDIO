import { readFileSync } from 'node:fs'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  emptyDocument,
  validateDocument,
  type CmsPage,
  type CmsPresentation,
} from '../../packages/content-contracts/src/cms'
import {
  validateDocumentMarkupPlacements,
  validateMarkup,
} from '../../packages/content-contracts/src/cms-markup'
import { CMS_BUILT_ASSETS } from '../../packages/content-contracts/src/cms-built-assets'
import { createSitePage, SITE_PAGE_CSS } from '../../packages/content-contracts/src/site-page'
import {
  DEFAULT_BUSINESS,
  SCHEMA_DAYS,
  type BusinessOpeningHours,
} from '../../modules/public-web/src/site/business'
import worker, {
  renderContactMetadata,
  renderCmsPage,
  withFallbackSkipLink,
  type SkipTarget,
} from '../../supabase/worker/index'
import { withPageReads } from './helpers/cmsPageReads'

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

// As nativePages adopts Contact: no owner title or description, and the English template in `en`.
const englishContact = readFileSync(
  new URL('../../modules/studio/src/contact.en.html', import.meta.url),
  'utf8',
).trim()
const adoptedContact: CmsPage = {
  ...contact,
  title: { sv: '', en: '' },
  description: { sv: '', en: '' },
  content: { sv: contact.content.sv, en: { ...contact.content.en, html: englishContact } },
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation: { ...presentation, pages: [contact] } })
          : Response.json(contactDiscovery),
      ),
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

  it('answers the live Contact title and description when the owner set neither', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({
              revision: 7,
              presentation: { ...presentation, pages: [adoptedContact] },
            })
          : Response.json(contactDiscovery),
      ),
    )
    const html = await (await requestContact()).text()
    const title = 'Kontakta Aktuell &amp; Salong – barbershop i Malmö'
    expect(html).toContain(`<title id="business-title">${title}</title>`)
    // The shell writes these two tags over several lines.
    const flat = html.replace(/\s+/g, ' ')
    expect(flat).toContain(`id="business-og-title" property="og:title" content="${title}"`)
    expect(flat).toContain(`id="business-twitter-title" name="twitter:title" content="${title}"`)
    expect(html).toMatch(
      /id="business-description"\s+name="description"\s+content="Officiell kontakt, adress och bokningsinformation för Aktuell &amp; Salong i Malmö\."/,
    )
  })

  it('keeps an owner description on the CMS Contact', async () => {
    const described = { ...contact, description: { sv: 'Ägarens beskrivning', en: '' } }
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation: { ...presentation, pages: [described] } })
          : Response.json(contactDiscovery),
      ),
    )
    const html = await (await requestContact()).text()
    expect(html).toMatch(
      /id="business-description"\s+name="description"\s+content="Ägarens beskrivning"/,
    )
  })

  it.each(['GET', 'HEAD'])(
    'answers the CMS Contact with its agent headers on %s',
    async (method) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        withPageReads(async (input) =>
          String(input).endsWith('/rpc/public_cms_presentation')
            ? Response.json({ revision: 7, presentation: { ...presentation, pages: [contact] } })
            : Response.json(contactDiscovery),
        ),
      )
      const response = await requestContact(method)
      expect(response.status).toBe(200)
      expect(response.headers.get('Link')).toBe('</llms.txt>; rel="describedby"')
      expect(response.headers.get('Vary')).toContain('Accept')
    },
  )

  it('answers ?lang=en with the English Contact, its live facts and the English default title', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({
              revision: 7,
              presentation: { ...presentation, pages: [adoptedContact] },
            })
          : Response.json(contactDiscovery),
      ),
    )
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/contact?lang=en'),
      contactAssets,
      noPublicContent,
    )
    const html = await response.text()
    expect(html).toContain('<html lang="en"')
    expect(html).toContain('<h1 id="contact-title">Contact Aktuell &amp; Salong</h1>')
    expect(html).toContain('<dt>Visiting address</dt><dd>Ny &amp; Gata 12, 123 45 Malmö</dd>')
    expect(html).toContain('<dt>Monday</dt><dd>10:00–12:00</dd>')
    expect(html).toContain(
      '<title id="business-title">Contact Aktuell &amp; Salong – barbershop in Malmö</title>',
    )
    expect(html).not.toContain('Besöksadress')
  })

  it('answers the Swedish Contact without ?lang', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({
              revision: 7,
              presentation: { ...presentation, pages: [adoptedContact] },
            })
          : Response.json(contactDiscovery),
      ),
    )
    const html = await (await requestContact()).text()
    expect(html).toContain('<html lang="sv"')
    expect(html).toContain('<dt>Besöksadress</dt><dd>Ny &amp; Gata 12, 123 45 Malmö</dd>')
  })

  it('serves contact slot ids on a non-Contact CMS page exactly as authored', async () => {
    const body =
      '<main class="bb-page bb-doc"><h2 id="contact-title">Ägarens rubrik</h2><p id="contact-details">Telefon <span>031-555 12 34</span></p><h3 id="contact-hours">Ägarens öppettider</h3></main>'
    // A created page: its stored body goes under the live header, as Studio creates it.
    const visit = createSitePage({
      id: '10000000-0000-4000-8000-000000000012',
      path: '/visit',
      name: { sv: 'Besök', en: 'Visit' },
    })
    visit.content.sv.html = body
    visit.content.en.html = body
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/rpc/public_cms_presentation')
        ? Response.json({ revision: 7, presentation: { ...presentation, pages: [visit] } })
        : Response.json(contactDiscovery),
    )
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/visit'),
      env,
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(body)
  })

  // Studio locks the name and city spans exactly where the Worker fills them. Each page below is
  // what Edge stores after validation, so its body is already in the serialised form.
  const businessSpans =
    '<p>Hitta <span data-business-name="">Ägarens visningsnamn</span> i <span data-business-city="">Ägarens ort</span></p>'
  const publishedPage = (page: CmsPage): CmsPage => {
    const document = emptyDocument()
    document.presentation.pages = [page]
    validateDocument(document)
    validateDocumentMarkupPlacements(document, {
      siteOrigin: 'https://bladeblendstudio.se',
      storageOrigin: 'https://fixture.invalid',
    })
    const [stored] = document.presentation.pages
    if (!stored) throw new Error('Validation dropped the page')
    return stored
  }

  it('fills the name and city spans of an unmarked historical CMS Contact', async () => {
    const body =
      '<main><h1 id="contact-title">Kontakt till salongen</h1>' +
      businessSpans +
      '<div id="contact-details"><p>Telefon 031-555 12 34</p></div><h2 id="contact-hours">Öppettider</h2></main>'
    const historical = publishedPage({
      ...contact,
      content: {
        sv: { ...contact.content.sv, html: body },
        en: { ...contact.content.en, html: body },
      },
    })
    expect(historical.content.sv.html).toBe(body)
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation: { ...presentation, pages: [historical] } })
          : Response.json(contactDiscovery),
      ),
    )
    const response = await requestContact()
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(
      '<p>Hitta <span data-business-name="">Aktuell &amp; Salong</span> i <span data-business-city="">Malmö</span></p>',
    )
    expect(html).not.toContain('Ägarens visningsnamn')
    expect(html).not.toContain('Ägarens ort')
  })

  it.each([
    [
      'its body',
      `<main data-business-contact-page="1"><h1 id="contact-title">Besök</h1>${businessSpans}</main>`,
    ],
    [
      'a nested section',
      `<main><section data-business-contact-page="1"><h2>Hitta hit</h2>${businessSpans}</section></main>`,
    ],
  ])(
    'serves marked Contact markup in %s on another CMS page exactly as authored',
    async (_where, body) => {
      const visit = createSitePage({
        id: '10000000-0000-4000-8000-000000000013',
        path: '/visit',
        name: { sv: 'Besök', en: 'Visit' },
      })
      visit.content.sv.html = body
      visit.content.en.html = body
      const stored = publishedPage(visit)
      expect(stored.content.sv.html).toBe(body)
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation: { ...presentation, pages: [stored] } })
          : Response.json(contactDiscovery),
      )
      const response = await worker.fetch(
        new Request('https://bladeblendstudio.se/visit'),
        env,
        noPublicContent,
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toContain(body)
    },
  )

  // Företag & SEO fills every legal business slot on every page that needs it, so the owner never
  // enters it page by page (owner decision, 2026-11-03). Studio locks the same slots on the same
  // pages. Each page below is what Edge stores after validation, in the serialised form.
  const legalBody = (path: '/privacy' | '/terms'): string => {
    const source = publicFile(`${path}.html`)
    return source.slice(source.indexOf('<body>') + '<body>'.length, source.indexOf('</body>'))
  }
  const legalPage = (path: '/privacy' | '/terms', html: string): CmsPage => {
    const content = { sv: { ...terms.content.sv, html }, en: { ...terms.content.en, html } }
    return publishedPage(
      path === '/privacy'
        ? {
            ...terms,
            id: '10000000-0000-4000-8000-000000000005',
            kind: 'privacy',
            path,
            name: { sv: 'Integritetspolicy', en: 'Privacy policy' },
            title: { sv: 'Integritetspolicy', en: 'Privacy policy' },
            content,
          }
        : { ...terms, content },
    )
  }
  const legalDiscovery = {
    ...contactDiscovery,
    settings: {
      ...contactDiscovery.settings,
      business_legal_name: 'Aktuell <Juridik> AB',
      business_org_number: '556016-0680',
      cancellation_policy_hours: '48',
    },
  }
  // `discovery` null: Företag & SEO cannot be read.
  const requestLegal = async (page: CmsPage, discovery: unknown = legalDiscovery) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/rpc/public_cms_presentation')
        ? Response.json({ revision: 7, presentation: { ...presentation, pages: [page] } })
        : discovery === null
          ? new Response(null, { status: 503 })
          : Response.json(discovery),
    )
    const response = await worker.fetch(
      new Request(`https://bladeblendstudio.se${page.path}`),
      env,
      noPublicContent,
    )
    expect(response.status).toBe(200)
    return response.text()
  }

  it('fills the name spans of a published CMS legal page from Företag & SEO', async () => {
    const body = legalBody('/privacy').replace(
      '<span data-business-name>salongen</span> · Senast',
      '<span data-business-name>Ägarens namn</span> · Senast',
    )
    const privacy = legalPage('/privacy', body)
    expect(privacy.content.sv.html).toContain(
      '<span data-business-name="">Ägarens namn</span> · Senast',
    )
    const html = await requestLegal(privacy, contactDiscovery)
    expect(html).toContain('data-cms-public="1"')
    expect(html).toContain('<span data-business-name="">Aktuell &amp; Salong</span> · Senast')
    expect(html).not.toContain('Ägarens namn')
  })

  it.each([
    ['/privacy', 4, 2],
    ['/terms', 1, 1],
  ] as const)(
    'fills every business slot of the published CMS %s page, escaped',
    async (path, names, contacts) => {
      const page = legalPage(path, legalBody(path))
      const html = await requestLegal(page)
      const filled = (pattern: RegExp): number => html.match(pattern)?.length ?? 0
      expect(filled(/<span data-business-name="">Aktuell &amp; Salong<\/span>/g)).toBe(names)
      expect(html).not.toMatch(/<span data-business-name="">(?!Aktuell &amp; Salong<)/)
      expect(
        filled(
          /<span data-business-contact=""><a href="mailto:current@example\.test">current@example\.test<\/a><\/span>/g,
        ),
      ).toBe(contacts)
      expect(html).not.toContain('kontaktuppgifterna på startsidan / home page contact details')
      expect(html).toContain(
        '<div id="legal-business-details-sv"><dl><dt>Salong</dt><dd>Aktuell &amp; Salong</dd><dt>Juridiskt företagsnamn</dt><dd>Aktuell &lt;Juridik&gt; AB</dd><dt>Organisationsnummer</dt><dd>556016-0680</dd><dt>Adress</dt><dd>Ny &amp; Gata 12, 123 45 Malmö</dd><dt>E-post</dt><dd>current@example.test</dd><dt>Telefon</dt><dd>040-123 45 67</dd></dl></div>',
      )
      expect(html).toContain(
        '<div id="legal-business-details-en"><dl><dt>Salon</dt><dd>Aktuell &amp; Salong</dd><dt>Legal business name</dt><dd>Aktuell &lt;Juridik&gt; AB</dd><dt>Registration number</dt><dd>556016-0680</dd><dt>Address</dt><dd>Ny &amp; Gata 12, 123 45 Malmö</dd><dt>Email</dt><dd>current@example.test</dd><dt>Phone</dt><dd>040-123 45 67</dd></dl></div>',
      )
      if (path === '/privacy') {
        expect(html).toContain(
          '<span data-business-controller="sv">Aktuell &lt;Juridik&gt; AB</span>',
        )
        expect(html).toContain(
          '<span data-business-controller="en">Aktuell &lt;Juridik&gt; AB</span>',
        )
      } else {
        expect(html).toContain(
          '<p id="cancellation-policy-sv">Avboka senast 48 timmar före den bokade tiden.</p>',
        )
        expect(html).toContain(
          '<p id="cancellation-policy-en">Cancel at least 48 hours before your appointment.</p>',
        )
      }
    },
  )

  it('serves a CMS legal page as authored when Företag & SEO cannot be read', async () => {
    const page = legalPage('/terms', legalBody('/terms'))
    const html = await requestLegal(page, null)
    expect(html).toContain(page.content.sv.html)
  })

  it('serves legal slot markup on another CMS page exactly as authored', async () => {
    const body =
      '<main><p><span data-business-name="">Ägarens namn</span> och <span data-business-controller="sv">Ägarens bolag</span></p><div id="legal-business-details-sv"><p>Ägarens uppgifter</p></div><p id="cancellation-policy-sv">Ägarens avbokning</p><span data-business-contact=""><a href="/">Ägarens kontakt</a></span></main>'
    const visit = createSitePage({
      id: '10000000-0000-4000-8000-000000000014',
      path: '/visit',
      name: { sv: 'Besök', en: 'Visit' },
    })
    visit.content.sv.html = body
    visit.content.en.html = body
    const stored = publishedPage(visit)
    expect(stored.content.sv.html).toBe(body)
    expect(await requestLegal(stored)).toContain(body)
  })

  it('fills the CMS fragment without reserialising any shell bytes compared with terms', async () => {
    const opaque = '<meta NAME = "opaque" content=\'a &amp; b\' >'
    const markedShell = shell
      .replace('</head>', `${opaque}\r\n</head>`)
      .replace('<div id="root"></div>', '<!--page-start--><div id="root"></div><!--page-end-->')
      .replace('</body>', "<p DATA-opaque='tail'>Outside the page</p>\r\n</body>")
    const described = { ...contact, description: { sv: 'Ägarens beskrivning', en: '' } }
    const reference = structuredClone(described)
    reference.kind = 'terms'
    reference.path = '/terms'
    delete reference.layout
    let published = reference
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation: { ...presentation, pages: [published] } })
          : Response.json(contactDiscovery),
      ),
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
    published = described
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
        // The publication holds no Contact page, so its metadata read answers null.
        if (failure === 'missing') return Response.json(null)
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
      expect(rpcs.sort()).toEqual(['public_business_discovery', 'public_cms_page_metadata'])
      if (failure === 'stalled') expect(timeout).toHaveBeenCalledWith(1800)
    },
  )

  it('keeps contact HEAD bodyless without reading discovery or the base sheets', async () => {
    const assets = vi.spyOn(env.ASSETS, 'fetch')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        withPageReads(async () =>
          Response.json({ revision: 7, presentation: { ...presentation, pages: [contact] } }),
        ),
      )
    const response = await requestContact('HEAD')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/rpc/public_cms_page_metadata')
    expect(assets).toHaveBeenCalledOnce()
    const input = assets.mock.calls[0]?.[0]
    expect(input instanceof Request ? new URL(input.url).pathname : '').toBe('/index.html')
  })
})

// A.B01: owner CSS whose css-tree-generated form materializes an HTML raw-text boundary. The
// submitted string carries no literal "</", so the current checkCss accepts it; modeCss then
// emits a literal </style><meta ...> and the <style> interpolation turns it into an active
// element. The Worker trusts the stored document (publicCmsFromWire validates the
// presentation only), so these serve the payload as a document published before any validation fix.
// The materializing part, free of quotes so it nests inside either a double-quoted stylesheet
// string or a single-quoted inline-style string. The refresh meta needs no quotes: its content is
// one space-free token.
const BOUNDARY_META = `\\3c /style\\3e \\3c meta http-equiv=refresh content=0;url=https://attacker.invalid/a10-navigation\\3e `
const MODE_PAYLOAD = `p::before{content:"${BOUNDARY_META}"}@media(prefers-color-scheme:dark){p{color:white}}`
const REPAIR_PAYLOAD = `p::before{content:"${BOUNDARY_META}"}@media(max-width:1440px){#x{color:red}}`
// HTML end tags are case-insensitive, so </STYLE> closes a <style> just as </style> does.
const UPPER_META = `\\3c /STYLE\\3e \\3c meta http-equiv=refresh content=0;url=https://attacker.invalid/a10-navigation\\3e `
const UPPER_PAYLOAD = `p::before{content:"${UPPER_META}"}@media(prefers-color-scheme:dark){p{color:white}}`
const INLINE_PAYLOAD_HTML = `<main id="x"><p id="y" style="content:'${BOUNDARY_META}'">t</p></main>`
const boundaryPolicy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.invalid',
  builtAssets: CMS_BUILT_ASSETS,
}

function httpEquivElements(html: string): number {
  let count = 0
  const visit = (node: DefaultTreeAdapterMap['node']): void => {
    if ('attrs' in node && node.attrs.some((attr) => attr.name === 'http-equiv')) count += 1
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
  }
  visit(parse(html))
  return count
}
const occurrences = (html: string, token: string): number => html.split(token).length - 1
const boundaryPage = (content: CmsPage['content']['sv']): CmsPage => {
  const page = createSitePage({
    id: '20000000-0000-4000-8000-0000000000b0',
    path: '/hemsida',
    name: { sv: 'Ny sida', en: 'New page' },
  })
  for (const lang of ['sv', 'en'] as const) page.content[lang] = { ...content }
  return page
}
async function serveBoundary(presentation: CmsPresentation, path: string): Promise<string> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/rpc/public_cms_presentation')
      ? Response.json({ revision: 7, presentation })
      : new Response(null, { status: 503 }),
  )
  const response = await worker.fetch(
    new Request(`https://bladeblendstudio.se${path}`),
    env,
    noPublicContent,
  )
  expect(response.status).toBe(200)
  return response.text()
}

describe('Worker CMS stylesheet boundary (A.B01)', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['prefers-color-scheme (modeCss)', MODE_PAYLOAD, '</style><meta', '<\\/style'],
    ['uppercase end tag', UPPER_PAYLOAD, '</STYLE><meta', '<\\/STYLE'],
  ])(
    'keeps a stored boundary payload inert in the served sheet: %s',
    async (_label, css, boundary, inert) => {
      const presentation = {
        ...emptyDocument().presentation,
        pages: [
          boundaryPage({ html: '<main id="b"><p>t</p></main>', css: { light: css, dark: css } }),
        ],
      }
      const html = await serveBoundary(presentation, '/hemsida')
      // The injected </style> closes the sheet early and the <meta http-equiv=refresh> becomes a
      // real element; a correct embedding neutralizes "</" so no stray closer or active element.
      expect(httpEquivElements(html)).toBe(0)
      expect(html).not.toContain(boundary)
      // Pin the neutralization form: the served sheet carries the escaped boundary "<\/style", so
      // an HTML-entity 'fix' (&lt;/style) would fail here.
      expect(html).toContain(inert)
      // The owner's CSS still reaches the page as inert text; the fix must not drop it.
      expect(html).toContain('a10-navigation')
    },
  )

  it('keeps an inline-style boundary payload inert after it is hoisted into a sheet', async () => {
    const pcss = '@media(prefers-color-scheme:dark){p{color:red}}'
    const page = boundaryPage({ html: INLINE_PAYLOAD_HTML, css: { light: pcss, dark: pcss } })
    const html = await serveBoundary({ ...emptyDocument().presentation, pages: [page] }, '/hemsida')
    expect(httpEquivElements(html)).toBe(0)
    expect(html).not.toContain('</style><meta')
    expect(html).toContain('<\\/style')
    expect(html).toContain('a10-navigation')
  })

  it('preserves ordinary CSS escapes that are not raw-text boundaries', async () => {
    // "<b>" has no slash and "a>b" no "<": neither can close a <style>, so both stay as served.
    // The space after "\3e" is the CSS escape terminator, so the decoded content is "<b>a>b".
    const css = `p::before{content:"\\3c b\\3e a>b"}@media(prefers-color-scheme:dark){p{color:red}}`
    const presentation = {
      ...emptyDocument().presentation,
      pages: [
        boundaryPage({ html: '<main id="b"><p>t</p></main>', css: { light: css, dark: css } }),
      ],
    }
    const html = await serveBoundary(presentation, '/hemsida')
    expect(sheet(html, 'cms-page-light')).toBe('p::before{content:"<b>a>b"}')
    // These oracles must be achievable on a correct render: a benign page has no active http-equiv
    // element and balanced <style>/</style> tokens, and never the raw-text boundary.
    expect(httpEquivElements(html)).toBe(0)
    expect(occurrences(html, '</style>')).toBe(occurrences(html, '<style'))
    expect(html).not.toContain('</style><meta')
  })

  it.each([
    ['a plain sheet', `p::before{content:"\\3c b\\3e"}`],
    // The Studio repairs this breakpoint when it takes a document in; the Worker serves a sheet
    // that still holds it as stored.
    ['a legacy Desktop breakpoint', REPAIR_PAYLOAD],
  ])('serves escapes verbatim when modeCss does not run: %s', async (_label, css) => {
    // No prefers-color-scheme: the transform returns the string untouched, so the escapes are
    // served as stored. A fix that always re-parses and regenerates would break this.
    const presentation = {
      ...emptyDocument().presentation,
      pages: [
        boundaryPage({ html: '<main id="b"><p>t</p></main>', css: { light: css, dark: css } }),
      ],
    }
    const html = await serveBoundary(presentation, '/hemsida')
    expect(sheet(html, 'cms-page-light')).toBe(css)
    expect(httpEquivElements(html)).toBe(0)
  })

  it.each([
    [
      'a stylesheet',
      (page: CmsPage): void => {
        for (const lang of ['sv', 'en'] as const)
          page.content[lang].css = { light: MODE_PAYLOAD, dark: MODE_PAYLOAD }
      },
    ],
    [
      'a repair-path stylesheet',
      (page: CmsPage): void => {
        for (const lang of ['sv', 'en'] as const)
          page.content[lang].css = { light: REPAIR_PAYLOAD, dark: REPAIR_PAYLOAD }
      },
    ],
    [
      'an inline style',
      (page: CmsPage): void => {
        for (const lang of ['sv', 'en'] as const) page.content[lang].html = INLINE_PAYLOAD_HTML
      },
    ],
  ])('rejects a boundary payload in %s at publication', (_label, mutate) => {
    const page = createSitePage({
      id: '20000000-0000-4000-8000-0000000000b1',
      path: '/hemsida',
      name: { sv: 'Ny', en: 'New' },
    })
    mutate(page)
    const document = {
      ...emptyDocument(),
      presentation: { ...emptyDocument().presentation, pages: [page] },
    }
    expect(() => {
      validateDocument(document)
      validateDocumentMarkupPlacements(document, boundaryPolicy)
    }).toThrow('Unsafe stylesheet boundary')
  })
})

// A.R05: the CMS render branch rewrites <link rel="canonical"> but not <meta property="og:url">, so
// a published Contact keeps the index shell's homepage og:url while its canonical is /contact.
describe('Worker CMS Contact Open Graph identity (A.R05)', () => {
  afterEach(() => vi.restoreAllMocks())

  const ogContactAssets = {
    ...env,
    ASSETS: {
      fetch: async (input: Request | URL | string): Promise<Response> =>
        new URL(input instanceof Request ? input.url : input).pathname === '/contact.html'
          ? new Response(contactSource, { headers: { 'Content-Type': 'text/html' } })
          : env.ASSETS.fetch(input),
    },
  }
  const serveContact = async (published: CmsPresentation | null, path: string): Promise<string> => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation') && published
          ? Response.json({ revision: 7, presentation: published })
          : new Response(null, { status: 503 }),
      ),
    )
    const response = await worker.fetch(
      new Request(`https://bladeblendstudio.se${path}`),
      ogContactAssets,
      noPublicContent,
    )
    expect(response.status).toBe(200)
    return response.text()
  }
  const ogUrl = (html: string): string | undefined =>
    /<meta\b[^>]*property="og:url"[^>]*content="([^"]*)"/i.exec(html)?.[1]
  const canonical = (html: string): string | undefined =>
    /<link\b[^>]*rel="canonical"[^>]*href="([^"]*)"/i.exec(html)?.[1]

  // The English page is its own canonical; the colour scheme never enters a URL.
  it.each([
    ['/contact', 'https://bladeblendstudio.se/contact'],
    ['/contact?lang=en', 'https://bladeblendstudio.se/contact?lang=en'],
    ['/contact?mode=dark', 'https://bladeblendstudio.se/contact'],
  ])('gives the CMS-rendered Contact its own og:url matching canonical (%s)', async (path, url) => {
    const html = await serveContact({ ...presentation, pages: [adoptedContact] }, path)
    expect(html).toContain('data-cms-public="1"')
    expect(canonical(html)).toBe(url)
    expect(ogUrl(html)).toBe(url)
  })

  it('keeps the static Contact fallback og:url when the CMS lookup fails', async () => {
    const html = await serveContact(null, '/contact')
    expect(html).not.toContain('data-cms-public="1"')
    expect(ogUrl(html)).toBe('https://bladeblendstudio.se/contact')
  })
})

describe('CMS shell metadata byte compatibility', () => {
  it.each(['sv', 'en'] as const)(
    'rewrites only the existing metadata value bytes for %s',
    (lang) => {
      const metadata =
        '<meta property="og:locale" content="old" content="last">' +
        '<meta property="og:locale:alternate" content="old">' +
        '<link rel="canonical" href="first" href="last">' +
        '<meta property="og:url" content="old">' +
        '<meta content="reordered" property="og:url">' +
        "<meta property='og:url' content='single-quoted'>"
      const source =
        '<html lang="sv"><head>İ' + metadata + '</head><body><div id="root"></div></body></html>'
      const canonical = 'https://bladeblendstudio.se/terms?a=1&b=$1'
      const expected =
        '<meta property="og:locale" content="old" content="' +
        (lang === 'en' ? 'en_US' : 'sv_SE') +
        '">' +
        '<meta property="og:locale:alternate" content="' +
        (lang === 'en' ? 'sv_SE' : 'en_US') +
        '">' +
        '<link rel="canonical" href="first" href="https://bladeblendstudio.se/terms?a=1&amp;b=$1">' +
        '<meta property="og:url" content="https://bladeblendstudio.se/terms?a=1&amp;b=$1">' +
        '<meta content="reordered" property="og:url">' +
        "<meta property='og:url' content='single-quoted'>"
      expect(renderCmsPage(source, terms, lang, 'light', canonical)).toContain('İ' + expected)
    },
  )
})

// W2-8: a keyboard visitor of an information page reaches a skip link first, whichever way the
// Worker serves the page. The deployed file gets the link and its target, <main id="main"
// tabindex="-1">, as public/404.html carries them in its own markup. The CMS render gets the
// Worker's own link in front of the shell's #root, which holds the page and takes the focus: no
// owner markup is searched or edited.
type TreeNode = DefaultTreeAdapterMap['node']
type TreeElement = DefaultTreeAdapterMap['element']
const treeElements = (node: TreeNode): TreeElement[] => [
  ...('tagName' in node ? [node] : []),
  ...('childNodes' in node ? node.childNodes.flatMap(treeElements) : []),
]
const attribute = (element: TreeElement | undefined, name: string): string | undefined =>
  element?.attrs.find((item) => item.name === name)?.value
const treeText = (node: TreeNode | undefined): string =>
  node === undefined
    ? ''
    : 'value' in node && node.nodeName === '#text'
      ? node.value
      : 'childNodes' in node
        ? node.childNodes.map((child) => treeText(child)).join('')
        : ''

/** A served document as a parser and a keyboard meet it. */
function keyboardView(html: string) {
  const all = treeElements(parse(html))
  const body = all.find((element) => element.tagName === 'body')
  if (!body) throw new Error('The served document has no body')
  return {
    /** The elements inside the body, in the order Tab walks them. */
    inBody: treeElements(body).slice(1),
    skipLinks: all.filter((element) =>
      (attribute(element, 'class') ?? '').split(/\s+/).includes('bb-skip'),
    ),
    /** Every element with this id, in document order: a fragment link leads to the first. */
    withId: (id: string): TreeElement[] => all.filter((item) => attribute(item, 'id') === id),
    bodyStyles: treeElements(body).filter((element) => element.tagName === 'style').length,
  }
}

const SKIP_SV = 'Hoppa till innehållet'
const SKIP_EN = 'Skip to content'
const BILINGUAL_SKIP = `${SKIP_SV} / <span lang="en">${SKIP_EN}</span>`
const FILE_TARGET = ' id="main" tabindex="-1"'
const fileLink = (label: string): string => `<a class="bb-skip bb-btn" href="#main">${label}</a>`

const DEPLOYED_PAGES = ['/contact.html', '/privacy.html', '/terms.html']
const deployed = {
  ...env,
  ASSETS: {
    fetch: async (input: Request | URL | string): Promise<Response> => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      return DEPLOYED_PAGES.includes(path)
        ? new Response(publicFile(path), { headers: { 'Content-Type': 'text/html' } })
        : env.ASSETS.fetch(input)
    },
  },
}
/** `path` while the publication cannot be read: the deployed file answers. Företag & SEO answers
 * `discovery`, or cannot be read either. */
async function serveDeployed(path: string, discovery: unknown = null): Promise<string> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/rpc/public_business_discovery') && discovery !== null
      ? Response.json(discovery)
      : new Response(null, { status: 503 }),
  )
  const response = await worker.fetch(
    new Request(`https://bladeblendstudio.se${path}`),
    deployed,
    noPublicContent,
  )
  expect(response.status).toBe(200)
  return response.text()
}

describe('the skip link of a deployed information page (W2-8)', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['/privacy', '/terms'] as const)(
    'gives the deployed %s file the bilingual link and its target, and changes nothing else',
    async (path) => {
      const html = await serveDeployed(path)
      const view = keyboardView(html)
      const [link] = view.inBody
      expect(link?.tagName).toBe('a')
      expect(attribute(link, 'class')).toBe('bb-skip bb-btn')
      expect(attribute(link, 'href')).toBe('#main')
      expect(treeText(link)).toBe(`${SKIP_SV} / ${SKIP_EN}`)
      expect(view.skipLinks).toHaveLength(1)
      expect(view.skipLinks[0]).toBe(link)
      const english = link === undefined ? [] : treeElements(link).slice(1)
      expect(english.map((element) => [attribute(element, 'lang'), treeText(element)])).toEqual([
        ['en', SKIP_EN],
      ])
      const targets = view.withId('main')
      expect(targets).toHaveLength(1)
      expect(targets[0]?.tagName).toBe('main')
      expect(attribute(targets[0], 'tabindex')).toBe('-1')
      expect(attribute(targets[0], 'class')).toBe('bb-doc')
      // Without the link and the two attributes it is the deployed file, byte for byte.
      expect(html.replace(fileLink(BILINGUAL_SKIP), '').replace(FILE_TARGET, '')).toBe(
        publicFile(`${path}.html`),
      )
    },
  )

  it('gives the deployed /contact file the Swedish link and its target, and changes nothing else', async () => {
    const html = await serveDeployed('/contact')
    const view = keyboardView(html)
    const [link] = view.inBody
    expect(link?.tagName).toBe('a')
    expect(attribute(link, 'class')).toBe('bb-skip bb-btn')
    expect(attribute(link, 'href')).toBe('#main')
    expect(treeText(link)).toBe(SKIP_SV)
    expect(view.skipLinks).toHaveLength(1)
    const targets = view.withId('main')
    expect(targets).toHaveLength(1)
    expect(targets[0]?.tagName).toBe('main')
    expect(attribute(targets[0], 'tabindex')).toBe('-1')
    expect(attribute(targets[0], 'data-business-contact-page')).toBe('1')
    // Without the link and the two attributes it is the page as it was rendered before.
    expect(html.replace(fileLink(SKIP_SV), '').replace(FILE_TARGET, '')).toBe(
      renderContactMetadata(contactSource, DEFAULT_BUSINESS),
    )
  })

  it.each(['/contact', '/privacy', '/terms'])(
    'keeps one link and one target on %s when the business name spells both',
    async (path) => {
      const name = 'Salong <main id="main"> <body> <a class="bb-skip" href="#x">'
      const html = await serveDeployed(path, {
        ...contactDiscovery,
        settings: { ...contactDiscovery.settings, business_name: name },
      })
      expect(treeText(parse(html))).toContain(name)
      const view = keyboardView(html)
      expect(view.skipLinks).toHaveLength(1)
      expect(view.skipLinks[0]).toBe(view.inBody[0])
      expect(attribute(view.inBody[0], 'href')).toBe('#main')
      expect(view.withId('main').map((element) => element.tagName)).toEqual(['main'])
    },
  )

  it.each([
    ['a document without a body', '<main>Text</main>'],
    ['a body without a main', '<body><div>Text</div></body>'],
    ['a main that has an id', '<body><main id="content">Text</main></body>'],
    ['a main whose id is written in capitals', '<body><main ID = "content">Text</main></body>'],
    ['a main that has a tabindex', '<body><main tabindex="0">Text</main></body>'],
  ])('serves %s as it is', (_label, html) => {
    expect(withFallbackSkipLink(html, 'Skip')).toBe(html)
  })

  const LINK = fileLink('Skip')
  it.each([
    [
      'the main of a body',
      '<body><main>Text</main></body>',
      `<body>${LINK}<main${FILE_TARGET}>Text</main></body>`,
    ],
    [
      'tags written in capitals, keeping their attributes',
      '<BODY CLASS="x"><MAIN CLASS="y">Text</MAIN></BODY>',
      `<BODY CLASS="x">${LINK}<MAIN CLASS="y"${FILE_TARGET}>Text</MAIN></BODY>`,
    ],
    [
      'the main, not an element whose name starts with main',
      '<body><main-menu></main-menu><mainframe></mainframe><main>Text</main></body>',
      `<body>${LINK}<main-menu></main-menu><mainframe></mainframe><main${FILE_TARGET}>Text</main></body>`,
    ],
    [
      'tags whose quoted attribute values hold a greater-than sign',
      `<body title="a > b"><main title="a > b" data-x='c > d'>Text</main></body>`,
      `<body title="a > b">${LINK}<main title="a > b" data-x='c > d'${FILE_TARGET}>Text</main></body>`,
    ],
    [
      'the first main only',
      '<body><main>One</main><main>Two</main></body>',
      `<body>${LINK}<main${FILE_TARGET}>One</main><main>Two</main></body>`,
    ],
    [
      'a main inside the body, not one before it',
      '<main>Before</main><body><main>Text</main></body>',
      `<main>Before</main><body>${LINK}<main${FILE_TARGET}>Text</main></body>`,
    ],
  ])('marks %s', (_label, html, expected) => {
    expect(withFallbackSkipLink(html, 'Skip')).toBe(expected)
  })
})

describe('the skip link of a CMS information page (W2-8)', () => {
  afterEach(() => vi.restoreAllMocks())

  const privacy: CmsPage = {
    ...terms,
    id: '10000000-0000-4000-8000-000000000005',
    kind: 'privacy',
    path: '/privacy',
  }
  /** `page` served from the publication; Företag & SEO cannot be read. */
  const servePage = async (page: CmsPage, query = ''): Promise<string> => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation: { ...presentation, pages: [page] } })
          : new Response(null, { status: 503 }),
      ),
    )
    const response = await worker.fetch(
      new Request(`https://bladeblendstudio.se${page.path}${query}`),
      env,
      noPublicContent,
    )
    expect(response.status).toBe(200)
    return response.text()
  }

  it.each(
    [terms, privacy, contact].flatMap((page) =>
      (['sv', 'en'] as const).map((lang) => [page.path, lang, page] as const),
    ),
  )(
    'puts the link in front of the #root of %s (%s), which takes the focus',
    async (_path, lang, page) => {
      const html = await servePage(page, `?lang=${lang}`)
      const view = keyboardView(html)
      const [link, root] = view.inBody
      expect(link?.tagName).toBe('a')
      expect(attribute(link, 'class')).toBe('bb-skip bb-btn')
      expect(attribute(link, 'href')).toBe('#root')
      expect(treeText(link)).toBe(lang === 'sv' ? SKIP_SV : SKIP_EN)
      expect(view.skipLinks).toHaveLength(1)
      expect(view.withId('root')).toHaveLength(1)
      expect(view.withId('root')[0]).toBe(root)
      expect(attribute(root, 'tabindex')).toBe('-1')
      expect(attribute(root, 'data-cms-public')).toBe('1')
      expect(root && treeElements(root).some((element) => element.tagName === 'main')).toBe(true)
      expect(view.bodyStyles).toBe(0)
    },
  )

  it('ships the rules that hide the link until it has focus, after the sheets of the page', async () => {
    const html = await servePage(terms)
    const skip = html.indexOf('<style id="cms-skip">')
    expect(skip).toBeGreaterThan(html.lastIndexOf('<style id="cms-page-'))
    expect(skip).toBeGreaterThan(html.lastIndexOf('<style id="cms-theme'))
    expect(skip).toBeLessThan(html.indexOf('</head>'))
    // Without white space and leading zeros, so 0.75rem and .75rem compare as the same length.
    const compact = (css: string): string =>
      css.replace(/\s+/g, '').replace(/(^|[^0-9.])0\./g, '$1.')
    const rule = (css: string, selector: string): string[] => {
      const start = css.indexOf(`${selector}{`)
      if (start < 0) throw new Error(`No ${selector} rule`)
      const open = start + selector.length + 1
      return css.slice(open, css.indexOf('}', open)).split(';').filter(Boolean)
    }
    const served = compact(sheet(html, 'cms-skip'))
    const file = rule(compact(publicFile('/info.css')), '.bb-skip')
    // Everything /info.css declares for the link at rest, the Worker's sheet declares too.
    expect(file).toContain('transform:translateY(-200%)')
    for (const declaration of file) expect(rule(served, '.bb-skip')).toContain(declaration)
    expect(rule(served, '.bb-skip:focus')).toContain('transform:none')
    expect(rule(served, '#root:focus')).toEqual(['outline:none'])
  })

  it.each([
    [
      'its own main with the id main and its own skip link',
      '<main id="main"><a class="bb-skip bb-btn" href="#main">Ägarens länk</a><h1>Villkor</h1></main>',
    ],
    ['no main', '<div><h1>Villkor</h1><p>Text</p></div>'],
    ['an element with the id root', '<main><div id="root">Ägarens rot</div></main>'],
    ['an element with a tabindex', '<main><h1 tabindex="-1">Villkor</h1></main>'],
  ])('leads to #root and edits nothing in an owner body with %s', async (_label, body) => {
    const page: CmsPage = {
      ...terms,
      content: {
        sv: { ...terms.content.sv, html: body },
        en: { ...terms.content.en, html: body },
      },
    }
    const html = await servePage(page)
    const view = keyboardView(html)
    const [link] = view.inBody
    expect(attribute(link, 'class')).toBe('bb-skip bb-btn')
    expect(attribute(link, 'href')).toBe('#root')
    expect(treeText(link)).toBe(SKIP_SV)
    const [root] = view.withId('root')
    expect(root).toBe(view.inBody[1])
    expect(attribute(root, 'data-cms-public')).toBe('1')
    expect(attribute(root, 'tabindex')).toBe('-1')
    // The stored body is the whole content of the #root, as stored.
    expect(html).toContain(`tabindex="-1">${body}</div>`)
  })

  const TERMS_URL = 'https://bladeblendstudio.se/terms'
  /** renderCmsPage as the handler calls it for `page`, in `html`, with a skip target. */
  const renderWithTarget = (html: string, page: CmsPage, target: SkipTarget): string =>
    renderCmsPage(
      html,
      page,
      'sv',
      'light',
      TERMS_URL,
      '',
      undefined,
      '',
      DEFAULT_BUSINESS,
      null,
      null,
      target,
    )

  it.each(['root', 'site-content'] as const)(
    'adds no link to markup the app owns, when the target asked for is %s',
    (target) => {
      const native: CmsPage = {
        ...terms,
        content: {
          ...terms.content,
          sv: {
            ...terms.content.sv,
            html: '<div data-knc-native="1"><main><h1>Villkor</h1></main></div>',
          },
        },
      }
      const html = renderWithTarget(shell, native, target)
      expect(html).toContain('data-cms-public="1" data-cms-mode="light"')
      expect(html).not.toContain('bb-skip')
      expect(html).not.toContain('cms-skip')
      expect(html).not.toContain('tabindex')
    },
  )

  it('adds no link to a page that does not hold the content wrapper it would lead to', () => {
    const html = renderWithTarget(shell, terms, 'site-content')
    expect(html).toContain('data-cms-public="1"')
    expect(html).not.toContain('bb-skip')
    expect(html).not.toContain('cms-skip')
  })

  it('never adds the link where the shell has no head to hold its sheet', () => {
    const headless = '<div id="root"></div>'
    const html = renderWithTarget(headless, terms, 'root')
    expect(html).toContain('data-cms-public="1"')
    expect(html).not.toContain('bb-skip')
    expect(html).not.toContain('tabindex')
    // With a head, the same call adds both (control).
    const whole = renderWithTarget(shell, terms, 'root')
    expect(whole).toContain('<a class="bb-skip bb-btn" href="#root">Hoppa till innehållet</a>')
    expect(whole).toContain('<style id="cms-skip">')
    expect(whole).toContain('tabindex="-1">')
  })

  it('adds nothing to a page rendered without a skip target (control)', () => {
    const html = renderCmsPage(shell, terms, 'sv', 'light', TERMS_URL)
    expect(html).toContain('data-cms-public="1"')
    expect(html).not.toContain('bb-skip')
    expect(html).not.toContain('cms-skip')
    expect(html).not.toContain('tabindex')
  })
})

describe('the image description of the deployed Contact (W2-10)', () => {
  afterEach(() => vi.restoreAllMocks())

  const withProperty = (html: string, property: string): TreeElement[] =>
    treeElements(parse(html)).filter((element) => attribute(element, 'property') === property)

  it.each(['Aktuell & Salong', 'Salong "Nord" <b>', 'x" id="contact-meta-title'])(
    'names the business %j, escaped, in its one og:image:alt tag',
    (name) => {
      const html = renderContactMetadata(contactSource, { ...DEFAULT_BUSINESS, name })
      const tags = withProperty(html, 'og:image:alt')
      expect(tags.map((tag) => [attribute(tag, 'id'), attribute(tag, 'content')])).toEqual([
        ['contact-image-alt', name],
      ])
      // The title is still the one element with its id, and names the business too.
      const titles = treeElements(parse(html)).filter(
        (element) => attribute(element, 'id') === 'contact-meta-title',
      )
      expect(titles.map((element) => element.tagName)).toEqual(['title'])
      expect(treeText(titles[0])).toContain(name)
    },
  )

  it('fills it from Företag & SEO on the static Contact, and from the default business without it', async () => {
    const alt = async (discovery: unknown): Promise<(string | undefined)[]> =>
      withProperty(await serveDeployed('/contact', discovery), 'og:image:alt').map((tag) =>
        attribute(tag, 'content'),
      )
    expect(await alt(contactDiscovery)).toEqual(['Aktuell & Salong'])
    expect(await alt(null)).toEqual([DEFAULT_BUSINESS.name])
  })

  it('leaves the CMS Contact with the shell head, whose own tag names the business (control)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      withPageReads(async (input) =>
        String(input).endsWith('/rpc/public_cms_presentation')
          ? Response.json({ revision: 7, presentation: { ...presentation, pages: [contact] } })
          : Response.json(contactDiscovery),
      ),
    )
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/contact'),
      env,
      noPublicContent,
    )
    expect(response.status).toBe(200)
    const tags = withProperty(await response.text(), 'og:image:alt')
    expect(tags.map((tag) => [attribute(tag, 'id'), attribute(tag, 'content')])).toEqual([
      ['business-og-image-alt', 'Aktuell & Salong'],
    ])
  })
})
