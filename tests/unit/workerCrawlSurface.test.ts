import { readFileSync } from 'node:fs'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyDocument, type CmsPage } from '../../packages/content-contracts/src/cms'
import { NEW_SITE_PAGE_TEXT, createSitePage } from '../../packages/content-contracts/src/site-page'
import {
  DEFAULT_BUSINESS,
  resolveBusinessSettings,
} from '../../modules/public-web/src/site/business'
import {
  bookingDescription,
  type NativePublicPath,
} from '../../modules/public-web/src/site/routeMetadata'
import worker, {
  PublicContent,
  legalDescription,
  nativePageTitle,
  renderCmsPage,
  renderSecurityTxt,
  renderSitemap,
  securityContact,
} from '../../supabase/worker/index'
import { withPageReads } from './helpers/cmsPageReads'

// What crawlers and link previews read from the Worker: titles and descriptions per route, the
// canonical URL with its language alternates, the account page kept out of the index, the generated
// sitemap, security.txt, and the intro a native route carries until the app has booted.

const SITE = 'https://bladeblendstudio.se'
const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const SHELL = read('index.html')
const STATIC_SITEMAP = read('public/sitemap.xml')
const FILES: Readonly<Record<string, string>> = {
  '/index.html': SHELL,
  '/sitemap.xml': STATIC_SITEMAP,
  '/tokens.css': read('public/tokens.css'),
  '/info.css': read('public/info.css'),
  '/404.html': '<main><h1>Sidan finns inte</h1></main>',
}
const NATIVE_PATHS = ['/', '/about', '/booking', '/my-bookings'] as const

function createEnv(files: Readonly<Record<string, string>> = FILES) {
  const requested: string[] = []
  return {
    requested,
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_ANON_KEY: 'fixture-anon-key',
    ASSETS: {
      async fetch(input: Request | URL | string): Promise<Response> {
        const path = new URL(input instanceof Request ? input.url : input).pathname
        requested.push(path)
        const body = files[path]
        return body === undefined
          ? new Response('Not found', { status: 404 })
          : new Response(body, { headers: { 'Content-Type': 'text/html' } })
      },
    },
  }
}
type TestEnv = ReturnType<typeof createEnv>
type WorkerContext = Parameters<typeof worker.fetch>[2]

// For routes that never use the cached public-content export: calling it rejects.
const noPublicContent: WorkerContext = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}

/** The cached public-content entrypoint, as production routes native pages and the sitemap. */
function cached(env: TestEnv): WorkerContext {
  const publicContent = new PublicContent({} as never, env)
  return {
    exports: { PublicContent: { fetch: (request: Request) => publicContent.fetch(request) } },
  }
}

function serve(url: string, method = 'GET', env: TestEnv = createEnv()): Promise<Response> {
  return worker.fetch(
    new Request(`${SITE}${url}`, { method, headers: { Accept: 'text/html' } }),
    env,
    cached(env),
  )
}

const BARBER = '20000000-0000-4000-8000-000000000001'
/** Företag & SEO and the schedule, as public_business_discovery answers. */
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
const LIVE_BUSINESS = resolveBusinessSettings(new Map(Object.entries(DISCOVERY.settings)))

interface PageMetadata {
  readonly title: string
  readonly description: string
}

/** Supabase as a native route reads it. `metadata` answers public_cms_page_metadata per path and
 * language and `discovery` answers public_business_discovery; null is a failed read. Returns the
 * RPC names in call order. */
function stubNative(
  metadata: (path: string, lang: 'sv' | 'en') => PageMetadata | null,
  discovery: unknown = DISCOVERY,
): string[] {
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const rpc = String(input).split('/').at(-1) ?? ''
    calls.push(rpc)
    if (rpc === 'public_business_discovery' && discovery !== null) return Response.json(discovery)
    if (rpc === 'public_cms_page_metadata') {
      const { p_path: path, p_lang: lang } = JSON.parse(String(init?.body)) as {
        p_path: string
        p_lang: 'sv' | 'en'
      }
      const answer = metadata(path, lang)
      if (answer !== null) return Response.json({ revision: 7, ...answer })
    }
    return new Response(null, { status: 503 })
  })
  return calls
}

/** Supabase as a CMS page reads it: the publication holding `pages` (null cannot be read), its
 * bounded page reads, and Företag & SEO (null cannot be read). */
function stubPublication(pages: readonly CmsPage[] | null, discovery: unknown = null): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    withPageReads(async (input) => {
      const rpc = String(input).split('/').at(-1) ?? ''
      if (rpc === 'public_cms_presentation' && pages !== null)
        return Response.json({
          revision: 7,
          presentation: { ...emptyDocument().presentation, pages },
        })
      if (rpc === 'public_business_discovery' && discovery !== null) return Response.json(discovery)
      return new Response(null, { status: 503 })
    }),
  )
}

const variant = (heading: string) => ({
  html: `<main><h1>${heading}</h1></main>`,
  css: { light: 'body{color:#111}', dark: 'body{color:#eee}' },
})
/** A published page without an owner description. */
const cmsPage = (serial: string, kind: CmsPage['kind'], path: string): CmsPage => ({
  id: `10000000-0000-4000-8000-0000000000${serial}`,
  kind,
  path,
  name: { sv: `Sida ${path}`, en: `Page ${path}` },
  title: { sv: `Titel ${path}`, en: `Title ${path}` },
  description: { sv: '', en: '' },
  inMenu: false,
  content: { sv: variant(`Sida ${path}`), en: variant(`Page ${path}`) },
})
const privacy = cmsPage('05', 'privacy', '/privacy')
const terms = cmsPage('06', 'terms', '/terms')
const contact = cmsPage('07', 'page', '/contact')
const offers = cmsPage('08', 'page', '/offers')

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const elements = (node: Node): Element[] => [
  ...('tagName' in node ? [node] : []),
  ...('childNodes' in node ? node.childNodes.flatMap(elements) : []),
]
const attr = (element: Element, name: string): string | undefined =>
  element.attrs.find((item) => item.name === name)?.value
const text = (node: Node): string =>
  'value' in node && node.nodeName === '#text'
    ? node.value
    : 'childNodes' in node
      ? node.childNodes.map(text).join('')
      : ''

/** The served document as a crawler parses it; attribute values and text are entity-decoded. */
function crawled(html: string) {
  const all = elements(parse(html))
  const links = (rel: string): Element[] =>
    all.filter((element) => element.tagName === 'link' && attr(element, 'rel') === rel)
  const root = all.find((element) => attr(element, 'id') === 'root')
  const rootChildren =
    root?.childNodes.filter((child): child is Element => 'tagName' in child) ?? []
  return {
    lang: all.filter((element) => element.tagName === 'html').map((item) => attr(item, 'lang')),
    /** The view the document element pre-paints, per html element; undefined for none. */
    view: all
      .filter((element) => element.tagName === 'html')
      .map((item) => attr(item, 'data-knc-view')),
    title: all
      .filter((element) => element.tagName === 'title' && attr(element, 'id') === 'business-title')
      .map((element) => text(element).trim()),
    canonical: links('canonical').map((link) => attr(link, 'href')),
    alternates: links('alternate').map((link) => [attr(link, 'hreflang'), attr(link, 'href')]),
    meta: (key: 'name' | 'property', value: string): (string | undefined)[] =>
      all
        .filter((element) => element.tagName === 'meta' && attr(element, key) === value)
        .map((element) => attr(element, 'content')),
    /** The element children of #root. */
    rootChildren,
  }
}
type Crawled = ReturnType<typeof crawled>

const descriptions = (page: Crawled): (string | undefined)[] => [
  ...page.meta('name', 'description'),
  ...page.meta('property', 'og:description'),
  ...page.meta('name', 'twitter:description'),
]
const languageUrl = (path: string, lang: 'sv' | 'en'): string =>
  lang === 'sv' ? `${SITE}${path}` : `${SITE}${path}?lang=en`
const alternatesOf = (path: string): string[][] => [
  ['sv', `${SITE}${path}`],
  ['en', `${SITE}${path}?lang=en`],
  ['x-default', `${SITE}${path}`],
]

/** The one intro of a served native route: the main in #root that index.html reveals after 8 s. */
function introOf(html: string): Element {
  const { rootChildren } = crawled(html)
  expect(rootChildren.map((child) => child.tagName)).toEqual(['main'])
  const [main] = rootChildren
  if (main === undefined) throw new Error('The served document has no intro')
  expect(attr(main, 'aria-labelledby')).toBe('public-intro-heading')
  expect(
    elements(main)
      .filter((element) => element.tagName === 'h1')
      .map((heading) => attr(heading, 'id')),
  ).toEqual(['public-intro-heading'])
  return main
}
const hrefsIn = (main: Element): (string | undefined)[] =>
  elements(main)
    .filter((element) => element.tagName === 'a')
    .map((link) => attr(link, 'href'))
/** The intro's section under this heading; undefined when it has none. */
const sectionOf = (main: Element, heading: string): Element | undefined =>
  elements(main).find(
    (element) =>
      element.tagName === 'section' &&
      elements(element).some((item) => item.tagName === 'h2' && text(item) === heading),
  )

/** A cached entrypoint that fails as a CPU-limited or erroring renderer does. */
function failing(failure: 'response' | 'exception'): WorkerContext {
  return {
    exports: {
      PublicContent: {
        fetch: async () => {
          if (failure === 'exception') throw new Error('Worker exceeded CPU time limit')
          return new Response('Unavailable', { status: 503 })
        },
      },
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('native route titles (A)', () => {
  const name = DEFAULT_BUSINESS.name
  const seo = DEFAULT_BUSINESS.seo
  const cases: readonly (readonly [
    NativePublicPath,
    'sv' | 'en',
    string | null,
    string | null,
    string,
  ])[] = [
    // No CMS title, or a blank one.
    ['/about', 'sv', null, null, `Om oss – ${name}`],
    ['/about', 'en', null, 'Home title', `About – ${name}`],
    ['/booking', 'sv', '', 'Hemtitel', `Boka tid – ${name}`],
    ['/booking', 'en', '   ', 'Home title', `Book – ${name}`],
    // The homepage's title: as the CMS holds it, as the homepage renders it, and as Företag & SEO
    // holds it when the homepage's own could not be read.
    ['/my-bookings', 'sv', 'Hemtitel', 'Hemtitel', `Mina bokningar – ${name}`],
    ['/my-bookings', 'en', ' Home title ', 'Home title', `My bookings – ${name}`],
    [
      '/booking',
      'sv',
      `${name} – Barbershop i Göteborg | Klippning`,
      'Klippning',
      `Boka tid – ${name}`,
    ],
    ['/about', 'sv', seo.sv.title, null, `Om oss – ${name}`],
    ['/about', 'en', seo.en.title, 'Other home title', `About – ${name}`],
    // A title of its own stays as the owner wrote it.
    ['/booking', 'sv', 'Boka klippning i Göteborg', 'Hemtitel', 'Boka klippning i Göteborg'],
    ['/about', 'en', 'Our story', null, 'Our story'],
    // The homepage keeps its own rules, in the page language.
    ['/', 'sv', 'Klippning', null, `${name} – Barbershop i Göteborg | Klippning`],
    ['/', 'en', 'Haircuts', null, `${name} – Barbershop in Göteborg | Haircuts`],
    ['/', 'sv', 'Bästa Barbershop i stan', null, 'Bästa Barbershop i stan'],
    ['/', 'sv', null, null, seo.sv.title],
    ['/', 'en', '  ', null, seo.en.title],
  ]

  it.each(cases)(
    'titles %s (%s) with CMS title %j beside homepage title %j as %j',
    (path, lang, own, home, expected) => {
      expect(nativePageTitle(path, lang, DEFAULT_BUSINESS, own, home)).toBe(expected)
    },
  )

  it.each([
    ['/about', 'Om oss – Aktuell Salong'],
    ['/booking', 'Boka tid – Aktuell Salong'],
    ['/my-bookings', 'Mina bokningar – Aktuell Salong'],
    ['/about?lang=en', 'About – Aktuell Salong'],
    ['/booking?lang=en', 'Book – Aktuell Salong'],
    ['/my-bookings?lang=en', 'My bookings – Aktuell Salong'],
  ])(
    'serves %s titled by its name when its CMS title is the homepage title',
    async (url, title) => {
      stubNative(() => ({ title: 'Samma titel', description: 'Beskrivning' }))
      const page = crawled(await (await serve(url)).text())
      expect(page.title).toEqual([title])
      expect(page.meta('property', 'og:title')).toEqual([title])
      expect(page.meta('name', 'twitter:title')).toEqual([title])
    },
  )

  it('serves a native route with a title of its own under that title', async () => {
    stubNative((path) => ({
      title: path === '/' ? 'Hemtitel' : 'Boka klippning',
      description: '',
    }))
    const page = crawled(await (await serve('/booking')).text())
    expect(page.title).toEqual(['Boka klippning'])
    expect(page.meta('property', 'og:title')).toEqual(['Boka klippning'])
    expect(page.meta('name', 'twitter:title')).toEqual(['Boka klippning'])
  })

  it('tells a native route from the homepage by the homepage title in the request language', async () => {
    // As Studio seeds the native pages: each holds the homepage's title, in each language.
    stubNative((_path, lang) => ({
      title: lang === 'sv' ? 'Hemtitel' : 'Home title',
      description: '',
    }))
    expect(crawled(await (await serve('/booking?lang=en')).text()).title).toEqual([
      'Book – Aktuell Salong',
    ])
    expect(crawled(await (await serve('/booking')).text()).title).toEqual([
      'Boka tid – Aktuell Salong',
    ])
    expect(crawled(await (await serve('/my-bookings?lang=en')).text()).title).toEqual([
      'My bookings – Aktuell Salong',
    ])
  })

  it('serves a native route titled by its name when no read succeeds', async () => {
    stubNative(() => null, null)
    const response = await serve('/my-bookings')
    expect(response.status).toBe(200)
    expect(crawled(await response.text()).title).toEqual([`Mina bokningar – ${name}`])
  })

  it('serves the homepage under its own title rules in the page language', async () => {
    stubNative((_path, lang) => ({
      title: lang === 'sv' ? 'Klippning' : 'Haircuts',
      description: '',
    }))
    expect(crawled(await (await serve('/')).text()).title).toEqual([
      'Aktuell Salong – Barbershop i Malmö | Klippning',
    ])
    expect(crawled(await (await serve('/?lang=en')).text()).title).toEqual([
      'Aktuell Salong – Barbershop in Malmö | Haircuts',
    ])
  })

  it('writes the homepage metadata in the page language when its CMS page cannot be read', async () => {
    stubNative(() => null)
    for (const lang of ['sv', 'en'] as const) {
      const page = crawled(await (await serve(lang === 'sv' ? '/' : '/?lang=en')).text())
      expect(page.lang).toEqual([lang])
      expect(page.title).toEqual([LIVE_BUSINESS.seo[lang].title])
      expect(descriptions(page)).toEqual(Array(3).fill(LIVE_BUSINESS.seo[lang].description))
      expect(page.meta('property', 'og:locale')).toEqual([lang === 'sv' ? 'sv_SE' : 'en_US'])
    }
  })
})

describe('descriptions (B)', () => {
  it.each([
    ['/booking', 'sv'],
    ['/booking?lang=en', 'en'],
  ] as const)(
    'describes %s by its own default when its CMS page has no description',
    async (url, lang) => {
      stubNative(() => ({ title: 'Titel', description: '' }))
      const expected = bookingDescription(lang, LIVE_BUSINESS)
      expect(expected).toContain('Aktuell Salong')
      expect(expected).toContain('Malmö')
      expect(expected).not.toBe(LIVE_BUSINESS.seo[lang].description)
      const page = crawled(await (await serve(url)).text())
      expect(descriptions(page)).toEqual([expected, expected, expected])
    },
  )

  it.each([
    ['/about', 'sv', ''],
    ['/about?lang=en', 'en', '   '],
    ['/my-bookings', 'sv', '   '],
    ['/my-bookings?lang=en', 'en', ''],
  ] as const)(
    'describes %s (%s) by the homepage description, not the booking one, when its own is %j',
    async (url, lang, description) => {
      stubNative(() => ({ title: 'Titel', description }))
      const expected = LIVE_BUSINESS.seo[lang].description
      expect(expected.trim()).not.toBe('')
      expect(expected).not.toBe(bookingDescription(lang, LIVE_BUSINESS))
      const page = crawled(await (await serve(url)).text())
      expect(descriptions(page)).toEqual([expected, expected, expected])
    },
  )

  it.each(['/about', '/my-bookings'])(
    'describes %s by the homepage description when its CMS page cannot be read',
    async (url) => {
      stubNative(() => null)
      const expected = LIVE_BUSINESS.seo.sv.description
      const page = crawled(await (await serve(url)).text())
      expect(descriptions(page)).toEqual([expected, expected, expected])
    },
  )

  it.each([
    ['/terms', 'Bokning, priser, avbokning och kontakt hos Aktuell Salong.'],
    ['/terms?lang=en', 'Booking, prices, cancellation and contact at Aktuell Salong.'],
    [
      '/privacy',
      'Så hanterar Aktuell Salong bokningsuppgifter, cookies, e-post och kalenderkoppling.',
    ],
    [
      '/privacy?lang=en',
      'How Aktuell Salong handles booking details, cookies, email and calendar connection.',
    ],
  ])('gives the CMS-rendered %s its legal default description', async (url, expected) => {
    stubPublication([privacy, terms], DISCOVERY)
    const response = await serve(url)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('data-cms-public="1"')
    expect(descriptions(crawled(html))).toEqual([expected, expected, expected])
  })

  it('keeps the legal default when Företag & SEO cannot be read', async () => {
    stubPublication([terms])
    const expected = legalDescription('/terms', DEFAULT_BUSINESS, 'en')
    expect(expected).toBe(`Booking, prices, cancellation and contact at ${DEFAULT_BUSINESS.name}.`)
    const response = await serve('/terms?lang=en')
    expect(response.status).toBe(200)
    expect(descriptions(crawled(await response.text()))).toEqual([expected, expected, expected])
  })

  it('keeps an owner description on a CMS legal page, per language', async () => {
    const described: CmsPage = { ...terms, description: { sv: 'Ägarens villkor', en: '' } }
    stubPublication([described], DISCOVERY)
    expect(descriptions(crawled(await (await serve('/terms')).text()))).toEqual(
      Array(3).fill('Ägarens villkor'),
    )
    expect(descriptions(crawled(await (await serve('/terms?lang=en')).text()))).toEqual(
      Array(3).fill('Booking, prices, cancellation and contact at Aktuell Salong.'),
    )
  })

  it.each(['', '   '])(
    'serves a created page whose description is %j without any description tag',
    async (description) => {
      stubPublication([{ ...offers, description: { sv: description, en: description } }], DISCOVERY)
      const response = await serve('/offers')
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('data-cms-public="1"')
      expect(descriptions(crawled(html))).toEqual([])
    },
  )

  it('keeps an owner description on a created page', async () => {
    stubPublication([{ ...offers, description: { sv: 'Erbjudanden hos oss', en: '' } }], DISCOVERY)
    expect(descriptions(crawled(await (await serve('/offers')).text()))).toEqual(
      Array(3).fill('Erbjudanden hos oss'),
    )
  })

  it('gives the CMS Contact its default description when the stored one is only spaces', async () => {
    stubPublication([{ ...contact, description: { sv: '   ', en: '' } }], DISCOVERY)
    const response = await serve('/contact')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('data-cms-public="1"')
    expect(descriptions(crawled(html))).toEqual(
      Array(3).fill(
        'Officiell kontakt, adress och bokningsinformation för Aktuell Salong i Malmö.',
      ),
    )
  })
})

describe('canonical, og:url and language alternates (C, D, E)', () => {
  it.each([
    ['/', '/', 'sv'],
    ['/?lang=en', '/', 'en'],
    ['/booking', '/booking', 'sv'],
    ['/booking?lang=en', '/booking', 'en'],
    // Only the language enters the URL.
    ['/booking?lang=en&mode=dark&utm_source=x', '/booking', 'en'],
    ['/?lang=de', '/', 'sv'],
  ] as const)(
    'makes the native %s its own canonical, with its language alternates',
    async (url, path, lang) => {
      stubNative(() => ({ title: 'Titel', description: 'Beskrivning' }))
      const response = await serve(url)
      expect(response.status).toBe(200)
      expect(response.headers.has('X-Robots-Tag')).toBe(false)
      const page = crawled(await response.text())
      expect(page.lang).toEqual([lang])
      // The page's own locale, and the other one as its alternate.
      expect(page.meta('property', 'og:locale')).toEqual([lang === 'sv' ? 'sv_SE' : 'en_US'])
      expect(page.meta('property', 'og:locale:alternate')).toEqual([
        lang === 'sv' ? 'en_US' : 'sv_SE',
      ])
      expect(page.canonical).toEqual([languageUrl(path, lang)])
      expect(page.meta('property', 'og:url')).toEqual([languageUrl(path, lang)])
      expect(page.alternates).toEqual(alternatesOf(path))
      // The shell's own indexing directive is untouched.
      expect(page.meta('name', 'robots')).toEqual(crawled(SHELL).meta('name', 'robots'))
      expect(page.meta('name', 'robots').join()).not.toContain('noindex')
    },
  )

  it.each([
    ['/about', `${SITE}/`, 'Om oss – Aktuell Salong'],
    ['/about?lang=en', `${SITE}/?lang=en`, 'About – Aktuell Salong'],
  ])(
    'points %s at the homepage as its canonical, without alternates, under its own title',
    async (url, homepage, title) => {
      stubNative(() => ({ title: 'Titel', description: 'Beskrivning' }))
      const response = await serve(url)
      expect(response.status).toBe(200)
      expect(response.headers.has('X-Robots-Tag')).toBe(false)
      const page = crawled(await response.text())
      expect(page.canonical).toEqual([homepage])
      expect(page.meta('property', 'og:url')).toEqual([homepage])
      expect(page.alternates).toEqual([])
      expect(page.title).toEqual([title])
      expect(page.meta('name', 'robots').join()).not.toContain('noindex')
    },
  )

  it.each([
    ['/contact', '/contact', 'sv'],
    ['/contact?lang=en', '/contact', 'en'],
    ['/privacy', '/privacy', 'sv'],
    ['/privacy?lang=en', '/privacy', 'en'],
    ['/terms?mode=dark', '/terms', 'sv'],
    ['/terms?lang=en&mode=dark', '/terms', 'en'],
    ['/offers', '/offers', 'sv'],
    ['/offers?lang=en', '/offers', 'en'],
  ] as const)(
    'makes the translated CMS-rendered %s its own canonical, with its language alternates',
    async (url, path, lang) => {
      // Each fixture has an English body that differs from its Swedish one.
      stubPublication([privacy, terms, contact, offers], DISCOVERY)
      const response = await serve(url)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('data-cms-public="1"')
      const page = crawled(html)
      expect(page.lang).toEqual([lang])
      expect(page.canonical).toEqual([languageUrl(path, lang)])
      expect(page.meta('property', 'og:url')).toEqual([languageUrl(path, lang)])
      expect(page.alternates).toEqual(alternatesOf(path))
    },
  )

  describe('a CMS page without an English version of its own', () => {
    const NEWS = '10000000-0000-4000-8000-000000000009'
    // As Studio creates a page: both names are the one the owner typed.
    const born = createSitePage({
      id: NEWS,
      path: '/nyheter',
      name: { sv: 'Nyheter', en: 'Nyheter' },
    })
    // As Studio seeds /privacy and /terms: one bilingual body stored for both languages.
    const bilingual = variant('Integritet / Privacy')
    // The frozen format an earlier Studio stored (LEGACY_HTML in workerCreatedPages.test.ts), cut
    // down to the smallest body with the same shape: the page's own header and footer around the
    // created heading and paragraph, under that format's ids. The sentences are written out, as
    // stored bytes are.
    const frozenBody = (lang: 'sv' | 'en', sentence: string): string =>
      '<div id="cms-site-shell"><header id="cms-site-header"></header><div id="cms-site-content">' +
      `<main id="cms-page-${NEWS}-${lang}-0"><h1 id="cms-page-${NEWS}-${lang}-1">Ny sida</h1>` +
      `<p id="cms-page-${NEWS}-${lang}-2">${sentence}</p></main>` +
      '</div><footer id="cms-site-footer"></footer></div>'
    const frozen: CmsPage = {
      ...born,
      layout: 'independent',
      content: {
        sv: { ...born.content.sv, html: frozenBody('sv', 'Skriv din text här.') },
        en: { ...born.content.en, html: frozenBody('en', 'Write your page here.') },
      },
    }
    // The document Studio seeds /privacy and /terms with (public/privacy.html, public/terms.html):
    // Swedish text, then its English part in a section marked as English. Both variants hold it.
    const seeded = (swedish: string) => ({
      ...variant(''),
      html:
        `<main><h1>Villkor</h1><p>${swedish}</p>` +
        '<section lang="en"><h2>Terms</h2><p>English text.</p></section></main>',
    })
    // A save of the Swedish variant alone: the English variant keeps the document as seeded.
    const savedInSwedish = { sv: seeded('Rättad svensk text.'), en: seeded('Svensk text.') }
    const englishBody = (html: string) => ({ ...born.content.en, html })
    const pages: readonly (readonly [string, CmsPage])[] = [
      ['one body in both languages', { ...privacy, content: { sv: bilingual, en: bilingual } }],
      [
        'written Swedish beside the English body it was created with',
        { ...born, content: { ...born.content, sv: variant('Nyheter hos oss') } },
      ],
      ['both bodies as it was created', born],
      [
        'the bodies it was created with under a later name and title',
        { ...born, name: { sv: 'Aktuellt', en: 'News' }, title: { sv: 'Aktuellt', en: 'News' } },
      ],
      ['the created English sentence in the frozen format', frozen],
      [
        'the seeded document of /privacy after a save of its Swedish variant alone',
        { ...privacy, content: savedInSwedish },
      ],
      [
        'the seeded document of /terms after a save of its Swedish variant alone',
        { ...terms, content: savedInSwedish },
      ],
      [
        'an empty English body',
        { ...born, content: { sv: variant('Nyheter hos oss'), en: englishBody('') } },
      ],
      [
        'an English body of whitespace alone',
        { ...born, content: { sv: variant('Nyheter hos oss'), en: englishBody(' \n\t ') } },
      ],
    ]
    const requests = pages.flatMap(([label, page]) =>
      (['sv', 'en'] as const).map((lang) => [label, lang, page] as const),
    )

    it.each(requests)(
      'declares only the Swedish URL for a page with %s (%s request)',
      async (_label, lang, page) => {
        stubPublication([page], DISCOVERY)
        const response = await serve(lang === 'sv' ? page.path : `${page.path}?lang=en`)
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('data-cms-public="1"')
        const served = crawled(html)
        // The document still answers in the requested language.
        expect(served.lang).toEqual([lang])
        expect(served.canonical).toEqual([`${SITE}${page.path}`])
        expect(served.meta('property', 'og:url')).toEqual([`${SITE}${page.path}`])
        expect(served.alternates).toEqual([])
      },
    )

    const translated: readonly (readonly [string, CmsPage])[] = [
      [
        'a created page with written English',
        { ...born, content: { sv: variant('Nyheter hos oss'), en: variant('News from us') } },
      ],
      [
        // The owner wrote an English version of its own: no part of it is marked as English.
        '/privacy with English that marks no part of itself as English',
        { ...privacy, content: { sv: savedInSwedish.sv, en: variant('Privacy') } },
      ],
      [
        // The section arm is for the two legal kinds alone.
        'a created page whose written English holds a section marked as English',
        {
          ...born,
          content: {
            sv: variant('Nyheter hos oss'),
            en: englishBody(
              '<main><h1>News</h1><section lang="en"><p>English text.</p></section></main>',
            ),
          },
        },
      ],
    ]

    it.each(
      translated.flatMap(([label, page]) =>
        (['sv', 'en'] as const).map((lang) => [label, lang, page] as const),
      ),
    )('keeps %s its own canonical in each language (%s request)', async (_label, lang, page) => {
      stubPublication([page], DISCOVERY)
      const response = await serve(lang === 'sv' ? page.path : `${page.path}?lang=en`)
      expect(response.status).toBe(200)
      const served = crawled(await response.text())
      expect(served.canonical).toEqual([languageUrl(page.path, lang)])
      expect(served.meta('property', 'og:url')).toEqual([languageUrl(page.path, lang)])
      expect(served.alternates).toEqual(alternatesOf(page.path))
    })

    // Only a paragraph whose whole text is the created sentence is a placeholder: a `<p>` start
    // tag, the sentence, `</p>`. The last two rows hold the sentence behind a `>` that does not end
    // a `<p>` start tag.
    it.each([
      ['English after the created sentence', '</p>', ' Welcome.</p>'],
      [
        'English before the created sentence',
        '>Write your page here.',
        '>Hello. Write your page here.',
      ],
      [
        'an element with text before the created sentence',
        '>Write your page here.',
        '><span>Note.</span>Write your page here.',
      ],
      [
        'text that ends in a raw > before the created sentence',
        '>Write your page here.',
        '>Note>Write your page here.',
      ],
      [
        'a <param> start tag before the created sentence',
        '>Write your page here.',
        '><param name="note">Write your page here.',
      ],
    ])('counts a paragraph with %s as a translation', async (_label, from, to) => {
      const english = born.content.en.html.replace(from, to)
      expect(english).not.toBe(born.content.en.html)
      expect(english).toContain('Write your page here.')
      const edited: CmsPage = {
        ...born,
        content: { ...born.content, en: { ...born.content.en, html: english } },
      }
      stubPublication([edited], DISCOVERY)
      const served = crawled(await (await serve('/nyheter?lang=en')).text())
      expect(served.canonical).toEqual([`${SITE}/nyheter?lang=en`])
      expect(served.alternates).toEqual(alternatesOf('/nyheter'))
    })

    it('creates a page with the exported text as the whole paragraph of each body', () => {
      for (const lang of ['sv', 'en'] as const)
        expect(born.content[lang].html).toContain(
          `<p id="cms-body-${NEWS}-${lang}-text">${NEW_SITE_PAGE_TEXT[lang]}</p>`,
        )
      // Stored pages hold these sentences: a reworded constant would no longer recognise them.
      expect(NEW_SITE_PAGE_TEXT).toEqual({
        sv: 'Skriv din text här.',
        en: 'Write your page here.',
      })
    })
  })

  it('writes the alternates it is given, escaped, and none when it is given none', () => {
    const urls = {
      sv: 'https://example.test/a?b=1&c="2"',
      en: 'https://example.test/a?b=1&c="2"&lang=en',
    }
    const html = renderCmsPage(
      SHELL,
      offers,
      'sv',
      'light',
      urls.sv,
      '',
      undefined,
      '',
      DEFAULT_BUSINESS,
      null,
      urls,
    )
    expect(html).toContain(
      '<link rel="alternate" hreflang="sv" href="https://example.test/a?b=1&amp;c=&quot;2&quot;" />',
    )
    expect(crawled(html).alternates).toEqual([
      ['sv', urls.sv],
      ['en', urls.en],
      ['x-default', urls.sv],
    ])
    expect(crawled(renderCmsPage(SHELL, offers, 'sv', 'light', urls.sv)).alternates).toEqual([])
  })

  it('adds no alternates to a static information fallback', async () => {
    // The publication cannot be read, so the deployed files answer.
    stubPublication(null, DISCOVERY)
    const fallback =
      '<!doctype html><html lang="sv"><head><title>Fallback</title>' +
      '<link rel="canonical" href="https://bladeblendstudio.se/fallback"></head>' +
      '<body><main><h1>Fallback</h1></main></body></html>'
    const env = createEnv({ ...FILES, '/contact.html': fallback, '/terms.html': fallback })
    for (const url of ['/contact', '/contact?lang=en', '/terms', '/terms?lang=en']) {
      const response = await serve(url, 'GET', env)
      expect(response.status, url).toBe(200)
      const html = await response.text()
      expect(html, url).not.toContain('data-cms-public="1"')
      expect(crawled(html).alternates, url).toEqual([])
    }
  })
})

describe('the account page and the presentation data (F)', () => {
  it.each([
    ['/my-bookings', `${SITE}/my-bookings`],
    ['/my-bookings?lang=en', `${SITE}/my-bookings?lang=en`],
  ])('keeps %s out of the index, without a canonical or alternates', async (url, own) => {
    stubNative(() => ({ title: 'Titel', description: 'Beskrivning' }))
    const response = await serve(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
    const page = crawled(await response.text())
    expect(page.meta('name', 'robots')).toEqual(['noindex, follow'])
    expect(page.canonical).toEqual([])
    expect(page.alternates).toEqual([])
    expect(page.meta('property', 'og:url')).toEqual([own])
  })

  it('answers HEAD /my-bookings with the noindex header and no body', async () => {
    stubNative(() => ({ title: 'Titel', description: 'Beskrivning' }))
    const response = await serve('/my-bookings', 'HEAD')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(await response.text()).toBe('')
  })

  it('keeps /my-bookings out of the index when no read succeeds', async () => {
    stubNative(() => null, null)
    const response = await serve('/my-bookings')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
    const page = crawled(await response.text())
    expect(page.meta('name', 'robots')).toEqual(['noindex, follow'])
    expect(page.canonical).toEqual([])
  })

  // What each native route names when its renderer failed and the deployed shell answers: the path
  // of its canonical (null for none), whether it has language alternates, whether it is indexed.
  const UNRENDERED = [
    ['/', '/', true, true],
    ['/booking', '/booking', true, true],
    ['/about', '/', false, true],
    ['/my-bookings', null, false, false],
  ] as const
  const unrendered = UNRENDERED.flatMap(([path, canonical, alternates, indexed]) =>
    (['sv', 'en'] as const).flatMap((lang) =>
      (['response', 'exception'] as const).map(
        (failure) => [path, lang, failure, canonical, alternates, indexed] as const,
      ),
    ),
  )

  it('starts from a shell that is Swedish, indexed and names one canonical', () => {
    const shell = crawled(SHELL)
    expect(shell.lang).toEqual(['sv'])
    expect(shell.meta('name', 'robots').join()).not.toContain('noindex')
    expect(shell.canonical).toHaveLength(1)
    expect(shell.alternates).toEqual([])
  })

  it.each(unrendered)(
    'gives the unrendered %s (%s) its own identity without a read, when the renderer fails by %s',
    async (path, lang, failure, canonical, alternates, indexed) => {
      const calls = stubNative(() => ({ title: 'Titel', description: 'Beskrivning' }))
      const env = createEnv()
      const response = await worker.fetch(
        new Request(`${SITE}${lang === 'sv' ? path : `${path}?lang=en`}`, {
          headers: { Accept: 'text/html' },
        }),
        env,
        failing(failure),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('X-Robots-Tag')).toBe(indexed ? null : 'noindex')
      const page = crawled(await response.text())
      expect(page.lang).toEqual([lang])
      expect(page.view).toEqual([path === '/booking' ? 'booking' : undefined])
      expect(page.meta('property', 'og:locale')).toEqual([lang === 'sv' ? 'sv_SE' : 'en_US'])
      expect(page.meta('property', 'og:locale:alternate')).toEqual([
        lang === 'sv' ? 'en_US' : 'sv_SE',
      ])
      expect(page.canonical).toEqual(canonical === null ? [] : [languageUrl(canonical, lang)])
      // og:url is the canonical; the account page has none and names its own URL.
      expect(page.meta('property', 'og:url')).toEqual([languageUrl(canonical ?? path, lang)])
      expect(page.alternates).toEqual(alternates ? alternatesOf(path) : [])
      expect(page.meta('name', 'robots')).toEqual(
        indexed ? crawled(SHELL).meta('name', 'robots') : ['noindex, follow'],
      )
      // Only the deployed shell was read: no database call, and the default business stays.
      expect(calls).toEqual([])
      expect(env.requested).toEqual(['/index.html'])
      expect(page.title).toEqual(crawled(SHELL).title)
    },
  )

  // The unrendered shell is edited, so the length and validators of the deployed bytes no longer
  // describe it. Every other header of the deployed shell stays.
  it.each(NATIVE_PATHS)(
    'answers the unrendered %s without the length and validators of the deployed shell',
    async (path) => {
      const env = {
        ...createEnv(),
        ASSETS: {
          fetch: async (): Promise<Response> =>
            new Response(SHELL, {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': String(new TextEncoder().encode(SHELL).length),
                ETag: '"deployed-shell"',
                'Last-Modified': 'Tue, 10 Nov 2026 00:00:00 GMT',
                'X-Content-Type-Options': 'nosniff',
              },
            }),
        },
      }
      const response = await worker.fetch(
        new Request(`${SITE}${path}`, { headers: { Accept: 'text/html' } }),
        env,
        failing('exception'),
      )
      expect(response.status).toBe(200)
      expect(response.headers.has('Content-Length')).toBe(false)
      expect(response.headers.has('ETag')).toBe(false)
      expect(response.headers.has('Last-Modified')).toBe(false)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(crawled(await response.text()).meta('property', 'og:url')).toEqual([
        `${SITE}${path === '/about' ? '/' : path}`,
      ])
    },
  )

  it.each([
    ['GET', ''],
    ['HEAD', ''],
    ['GET', '?rev=7'],
    ['GET', '?rev=8'],
  ])('marks the presentation JSON noindex (%s %s)', async (method, search) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{"revision": 7, "presentation": {"pages": []}}'),
    )
    const response = await serve(`/api/cms/presentation${search}`, method)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each(['', '?rev=7'])('marks an unavailable presentation%s noindex too', async (search) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('boom', { status: 503 }),
    )
    const response = await serve(`/api/cms/presentation${search}`)
    expect(response.status).toBe(503)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('adds no robots header to the Google verification file', async () => {
    const calls = stubNative(() => null, null)
    const verification = 'google-site-verification: googlefbf0c3168fbf0af5.html'
    const env = createEnv({ ...FILES, '/googlefbf0c3168fbf0af5.html': verification })
    const response = await serve('/googlefbf0c3168fbf0af5.html', 'GET', env)
    expect(response.status).toBe(200)
    expect(response.headers.has('X-Robots-Tag')).toBe(false)
    expect(await response.text()).toBe(verification)
    expect(calls).toEqual([])
  })
})

describe('the sitemap (G)', () => {
  const locations = (xml: string): (string | undefined)[] =>
    [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1])
  const core = ['/', '/booking', '/contact', '/privacy', '/terms'].map((path) => `${SITE}${path}`)

  it('lists exactly the indexable core pages when nothing was created, as the static file does', () => {
    expect(renderSitemap([])).toBe(STATIC_SITEMAP)
    expect(locations(STATIC_SITEMAP)).toEqual(core)
  })

  /** A published page as the sitemap reads one; its Swedish body is written unless given. */
  const written = (path: string, html = '<main><h1>Text</h1></main>') => ({
    kind: 'page' as const,
    path,
    content: { sv: { html } },
  })

  it('adds each created page after the core pages and nothing else from the publication', () => {
    const sitemap = renderSitemap([
      privacy,
      terms,
      contact,
      offers,
      written('/offers/summer'),
      // Native pages are never created pages, whatever the publication holds for them.
      written('/'),
      written('/about'),
      written('/booking'),
      written('/my-bookings'),
    ])
    expect(locations(sitemap)).toEqual([...core, `${SITE}/offers`, `${SITE}/offers/summer`])
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true)
    expect(sitemap).not.toMatch(/<lastmod(?:\s|>)/i)
  })

  // A <loc> is written unescaped. That is sound only while no listed path holds a character XML
  // escapes: the first five rows are what keeps it so.
  it.each(['/a&b', '/<script>', '/x>y', '/x"y', "/x'y", '/Offers', '/admin', '/login', 'offers'])(
    'never lists %j, which is not a created-page path',
    (path) => {
      expect(renderSitemap([written(path)])).toBe(STATIC_SITEMAP)
    },
  )

  describe('a created page nothing is written on', () => {
    const NEWS = '10000000-0000-4000-8000-000000000009'
    const born = createSitePage({
      id: NEWS,
      path: '/nyheter',
      name: { sv: 'Nyheter', en: 'Nyheter' },
    })

    it('leaves out a page whose Swedish body is the one it was created with', () => {
      expect(born.content.sv.html).toContain('>Skriv din text här.</p>')
      expect(locations(renderSitemap([born, offers]))).toEqual([...core, `${SITE}/offers`])
      expect(renderSitemap([born])).toBe(STATIC_SITEMAP)
    })

    it('leaves it out under a later name and in the frozen format too', () => {
      const renamed: CmsPage = { ...born, name: { sv: 'Aktuellt', en: 'News' } }
      // The frozen format's paragraph (LEGACY_HTML in workerCreatedPages.test.ts), cut down to it.
      const frozen = written(
        '/nyheter',
        '<div id="cms-site-shell"><header id="cms-site-header"></header>' +
          `<div id="cms-site-content"><main id="cms-page-${NEWS}-sv-0">` +
          `<h1 id="cms-page-${NEWS}-sv-1">Ny sida</h1>` +
          `<p id="cms-page-${NEWS}-sv-2">Skriv din text här.</p></main></div></div>`,
      )
      expect(locations(renderSitemap([renamed]))).toEqual(core)
      expect(locations(renderSitemap([frozen]))).toEqual(core)
      // The same two pages are listed once something is written.
      expect(locations(renderSitemap([written('/nyheter')]))).toEqual([...core, `${SITE}/nyheter`])
    })

    it.each([
      ['a written Swedish body', variant('Nyheter hos oss').html],
      [
        'Swedish written after the created sentence',
        born.content.sv.html.replace('</p>', ' Välkommen.</p>'),
      ],
      [
        'Swedish written before the created sentence',
        born.content.sv.html.replace('>Skriv din text här.', '>Hej. Skriv din text här.'),
      ],
    ])('lists the same page with %s', (_label, html) => {
      expect(html).not.toBe(born.content.sv.html)
      const page: CmsPage = {
        ...born,
        content: { ...born.content, sv: { ...born.content.sv, html } },
      }
      expect(locations(renderSitemap([page]))).toEqual([...core, `${SITE}/nyheter`])
    })

    it('lists a page with written Swedish whatever its English body holds', () => {
      // The sitemap holds Swedish URLs: the untouched English sentence is not its concern.
      const page: CmsPage = {
        ...born,
        content: { ...born.content, sv: variant('Nyheter hos oss') },
      }
      expect(page.content.en.html).toContain('>Write your page here.</p>')
      expect(locations(renderSitemap([page]))).toEqual([...core, `${SITE}/nyheter`])
    })

    it('keeps every core page, whatever the publication holds for its path', () => {
      // A core page is listed by its path alone; the created sentence in its body changes nothing.
      const pages = [privacy, terms, contact].map((page) => ({
        ...page,
        content: { ...page.content, sv: born.content.sv },
      }))
      expect(renderSitemap(pages)).toBe(STATIC_SITEMAP)
      expect(locations(renderSitemap(pages))).toEqual(core)
    })

    it('leaves the page out of the served sitemap', async () => {
      stubPublication([born, offers])
      const response = await serve('/sitemap.xml')
      expect(response.status).toBe(200)
      expect(locations(await response.text())).toEqual([...core, `${SITE}/offers`])
    })
  })

  it('answers GET /sitemap.xml from the publication, through the cached entrypoint', async () => {
    stubPublication([privacy, terms, contact, offers])
    const env = createEnv()
    const publicContent = new PublicContent({} as never, env)
    const forwarded = vi.fn((request: Request) => publicContent.fetch(request))
    const response = await worker.fetch(new Request(`${SITE}/sitemap.xml`), env, {
      exports: { PublicContent: { fetch: forwarded } },
    })
    expect(forwarded).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(await response.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '  <url>\n' +
        '    <loc>https://bladeblendstudio.se/</loc>\n' +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>1.0</priority>\n' +
        '  </url>\n' +
        '  <url>\n' +
        '    <loc>https://bladeblendstudio.se/booking</loc>\n' +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.8</priority>\n' +
        '  </url>\n' +
        '  <url>\n' +
        '    <loc>https://bladeblendstudio.se/contact</loc>\n' +
        '    <changefreq>yearly</changefreq>\n' +
        '    <priority>0.5</priority>\n' +
        '  </url>\n' +
        '  <url>\n' +
        '    <loc>https://bladeblendstudio.se/privacy</loc>\n' +
        '    <changefreq>yearly</changefreq>\n' +
        '    <priority>0.4</priority>\n' +
        '  </url>\n' +
        '  <url>\n' +
        '    <loc>https://bladeblendstudio.se/terms</loc>\n' +
        '    <changefreq>yearly</changefreq>\n' +
        '    <priority>0.4</priority>\n' +
        '  </url>\n' +
        '  <url>\n' +
        '    <loc>https://bladeblendstudio.se/offers</loc>\n' +
        '  </url>\n' +
        '</urlset>\n',
    )
    expect(env.requested).toEqual([])
  })

  it.each([
    ['can', [offers]],
    ['cannot', null],
  ] as const)(
    'answers HEAD /sitemap.xml with the generated headers and no read, when the publication %s be read',
    async (_readable, pages) => {
      stubPublication(pages)
      const env = createEnv()
      const response = await serve('/sitemap.xml', 'HEAD', env)
      expect(response.status).toBe(200)
      // The headers GET gives the generated sitemap.
      expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
      expect(await response.text()).toBe('')
      // Neither the publication nor the static file was read.
      expect(globalThis.fetch).not.toHaveBeenCalled()
      expect(env.requested).toEqual([])
    },
  )

  it('serves the static sitemap when the publication cannot be read', async () => {
    stubPublication(null)
    const response = await serve('/sitemap.xml')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(STATIC_SITEMAP)
  })

  it('serves the static sitemap when the publication read is not a valid publication', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ revision: 7, presentation: { pages: 'not a list' } }),
    )
    const response = await serve('/sitemap.xml')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(STATIC_SITEMAP)
  })

  it.each(['response', 'exception'])(
    'serves the static sitemap, unstored, when the cached entrypoint fails (%s)',
    async (failure) => {
      const env = createEnv()
      const response = await worker.fetch(new Request(`${SITE}/sitemap.xml`), env, {
        exports: {
          PublicContent: {
            fetch: async () => {
              if (failure === 'exception') throw new Error('Worker exceeded CPU time limit')
              return new Response('Unavailable', { status: 503 })
            },
          },
        },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.has('X-Robots-Tag')).toBe(false)
      expect(await response.text()).toBe(STATIC_SITEMAP)
      expect(env.requested).toEqual(['/sitemap.xml'])
    },
  )

  it('leaves a failed /llms.txt answer as it was (control)', async () => {
    const response = await worker.fetch(new Request(`${SITE}/llms.txt`), createEnv(), {
      exports: {
        PublicContent: { fetch: async () => new Response('Unavailable', { status: 503 }) },
      },
    })
    expect(response.status).toBe(503)
  })
})

describe('the intro every native route carries (H)', () => {
  it.each(NATIVE_PATHS)(
    'gives %s the deadline-revealed intro with address, phone, e-mail and opening hours',
    async (path) => {
      stubNative(() => ({ title: 'Titel', description: 'Beskrivning' }))
      const response = await serve(path)
      expect(response.status).toBe(200)
      const main = introOf(await response.text())
      // Swedish text on a Swedish page needs no language of its own.
      expect(attr(main, 'lang')).toBeUndefined()
      expect(hrefsIn(main)).toContain('tel:0401234567')
      expect(hrefsIn(main)).toContain('mailto:owner@example.test')
      const copy = text(main)
      expect(copy).toContain('Nygatan 12, 211 22 Malmö')
      expect(copy).toContain('040-123 45 67')
      expect(copy).toContain('owner@example.test')
      expect(copy).toContain('Måndag')
      expect(copy).toContain('10:00–12:00')
      // Neither services nor prices.
      expect(copy).not.toContain('987')
    },
  )

  it.each(NATIVE_PATHS)('marks the Swedish intro of the English %s as Swedish', async (path) => {
    stubNative(() => ({ title: 'Title', description: 'Description' }))
    const html = await (await serve(`${path}?lang=en`)).text()
    expect(crawled(html).lang).toEqual(['en'])
    expect(attr(introOf(html), 'lang')).toBe('sv')
  })

  it.each(NATIVE_PATHS)(
    'keeps %s a 200 with the default business in its intro when no read succeeds',
    async (path) => {
      stubNative(() => null, null)
      const response = await serve(path)
      expect(response.status).toBe(200)
      const main = introOf(await response.text())
      expect(hrefsIn(main)).toContain(`tel:${DEFAULT_BUSINESS.phoneTel}`)
      expect(hrefsIn(main)).toContain(`mailto:${DEFAULT_BUSINESS.email}`)
    },
  )

  it.each(['/', '/about', '/my-bookings'] as const)(
    'points %s at the booking instead of inventing hours when there is no schedule',
    async (path) => {
      stubNative(() => null, { ...DISCOVERY, schedules: [] })
      const hours = sectionOf(introOf(await (await serve(path)).text()), 'Öppettider')
      if (hours === undefined) throw new Error('The intro has no opening-hours section')
      expect(text(hours)).toContain('Se aktuella tider i bokningen eller kontakta salongen.')
      expect(hrefsIn(hours)).toEqual(['/booking'])
      expect(elements(hours).filter((element) => element.tagName === 'dd')).toEqual([])
    },
  )

  it('leaves the opening-hours section out of /booking when there is no schedule', async () => {
    stubNative(() => null, { ...DISCOVERY, schedules: [] })
    const main = introOf(await (await serve('/booking')).text())
    expect(sectionOf(main, 'Öppettider')).toBeUndefined()
    expect(text(main)).not.toContain('Se aktuella tider')
    // The contact details stay, and the only link to the page itself is the site navigation's.
    expect(sectionOf(main, 'Besöksadress och kontaktuppgifter')).toBeDefined()
    expect(hrefsIn(main)).toContain('mailto:owner@example.test')
    expect(hrefsIn(main).filter((href) => href === '/booking')).toHaveLength(1)
  })

  it('keeps the opening hours on /booking when there is a schedule', async () => {
    stubNative(() => null)
    const hours = sectionOf(introOf(await (await serve('/booking')).text()), 'Öppettider')
    if (hours === undefined) throw new Error('The intro has no opening-hours section')
    expect(text(hours)).toContain('Måndag')
    expect(text(hours)).toContain('10:00–12:00')
  })

  it.each(['/booking', '/my-bookings'] as const)(
    'leaves out the phone the owner removed and never tells the visitor of %s to call',
    async (path) => {
      stubNative(() => null, {
        ...DISCOVERY,
        settings: { ...DISCOVERY.settings, business_phone_display: '', business_phone_tel: '' },
      })
      const main = introOf(await (await serve(path)).text())
      expect(hrefsIn(main).filter((href) => href?.startsWith('tel:'))).toEqual([])
      expect(hrefsIn(main)).toContain('mailto:owner@example.test')
      expect(text(main)).not.toMatch(/\bringa\b/i)
      expect(text(main)).toContain('kontakta salongen via kontaktuppgifterna nedan.')
    },
  )

  it('links Mina bokningar inside the sentence of the booking intro that names it', async () => {
    stubNative(() => null)
    const help = sectionOf(
      introOf(await (await serve('/booking')).text()),
      'Om bokningen inte laddas',
    )
    if (help === undefined) throw new Error('The booking intro has no help section')
    expect(text(help)).toContain('För en befintlig bokning använder du Mina bokningar.')
    const links = elements(help).filter((element) => element.tagName === 'a')
    expect(links.map((link) => [text(link), attr(link, 'href')])).toEqual([
      ['Mina bokningar', '/my-bookings'],
    ])
  })

  it('says that verifying through the confirmation e-mail may be needed, not that it is', async () => {
    stubNative(() => null)
    const copy = text(introOf(await (await serve('/my-bookings')).text()))
    expect(copy).toContain('du kan behöva verifiera dig via länken i bekräftelsemejlet.')
    expect(copy).not.toContain('kräver att du verifierar dig')
  })

  it('escapes owner text in the intro', async () => {
    const hostile = '<img src=x onerror=alert(1)>'
    stubNative(() => null, {
      ...DISCOVERY,
      settings: {
        ...DISCOVERY.settings,
        business_name: hostile,
        business_street: '"><script>alert(1)</script>',
      },
    })
    const response = await serve('/booking')
    expect(response.status).toBe(200)
    const main = introOf(await response.text())
    const injected = elements(main).filter((element) => ['img', 'script'].includes(element.tagName))
    expect(injected).toEqual([])
    expect(text(main)).toContain(hostile)
    expect(text(main)).toContain('"><script>alert(1)</script>, 211 22 Malmö')
  })
})

describe('owner text and the edits of the shell', () => {
  // Every tag and attribute the route's edits look for, a closing title, and the patterns a
  // string replacement reads.
  const HOSTILE =
    '</title><link rel="canonical" href="https://evil.example/">' +
    '<meta name="robots" content="index"><meta property="og:url" content="https://evil.example/">' +
    ' rel="canonical" name="robots" content="index" property="og:url" $& $1'
  const stubHostile = (): void => {
    stubNative((path) => ({ title: path === '/' ? 'Hemtitel' : HOSTILE, description: HOSTILE }), {
      ...DISCOVERY,
      settings: { ...DISCOVERY.settings, business_name: HOSTILE },
    })
  }

  it('keeps the identity of /booking under a hostile CMS title and business name', async () => {
    stubHostile()
    const response = await serve('/booking')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<html lang="sv" data-knc-view="booking" data-cms-revision="7"')
    const page = crawled(html)
    // The owner's text arrives whole, as text.
    expect(page.title).toEqual([HOSTILE])
    expect(descriptions(page)).toEqual([HOSTILE, HOSTILE, HOSTILE])
    expect(page.meta('property', 'og:site_name')).toEqual([HOSTILE])
    // One canonical, one og:url, one robots tag: the route's own.
    expect(page.canonical).toEqual([`${SITE}/booking`])
    expect(page.meta('property', 'og:url')).toEqual([`${SITE}/booking`])
    expect(page.alternates).toEqual(alternatesOf('/booking'))
    expect(page.meta('name', 'robots')).toEqual(crawled(SHELL).meta('name', 'robots'))
  })

  it('keeps /my-bookings out of the index under a hostile CMS title and business name', async () => {
    stubHostile()
    const response = await serve('/my-bookings')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
    const page = crawled(await response.text())
    expect(page.title).toEqual([HOSTILE])
    expect(descriptions(page)).toEqual([HOSTILE, HOSTILE, HOSTILE])
    expect(page.canonical).toEqual([])
    expect(page.alternates).toEqual([])
    expect(page.meta('name', 'robots')).toEqual(['noindex, follow'])
    expect(page.meta('property', 'og:url')).toEqual([`${SITE}/my-bookings`])
  })

  // The escapes keep owner text from being taken for a tag, so the two tests above hold whichever
  // comes first: the route's edits or the owner's text. The order shows only in a shell where one
  // tag is both a tag the route edits and the first slot owner text is written to. The later write
  // is the one that stays, and it must be the owner's.
  const slotShell = (marker: string): string =>
    '<!doctype html><html lang="sv"><head><title id="business-title">old</title>' +
    `<meta id="business-description" ${marker} content="old">` +
    '</head><body><div id="root"></div></body></html>'

  it.each([
    ['/my-bookings', 'name="robots"', 'name', 'robots'],
    ['/booking', 'property="og:url"', 'property', 'og:url'],
  ] as const)(
    'edits the shell tags of %s before any owner text is written (%s)',
    async (path, marker, key, value) => {
      stubNative(() => ({ title: 'Titel', description: 'Ägarens beskrivning' }))
      const env = createEnv({ ...FILES, '/index.html': slotShell(marker) })
      const response = await serve(path, 'GET', env)
      expect(response.status).toBe(200)
      expect(crawled(await response.text()).meta(key, value)).toEqual(['Ägarens beskrivning'])
    },
  )
})

describe('security.txt (J)', () => {
  const SECURITY_TXT = `${SITE}/.well-known/security.txt`

  it.each([
    ['2026-11-10T15:45:12.345Z', '2027-05-09T00:00:00Z'],
    ['2026-11-10T00:00:00.000Z', '2027-05-09T00:00:00Z'],
    ['2026-11-10T23:59:59.999Z', '2027-05-09T00:00:00Z'],
    // Across a year end, and across a leap day.
    ['2026-12-31T23:59:59.999Z', '2027-06-29T00:00:00Z'],
    ['2027-09-05T12:00:00.000Z', '2028-03-03T00:00:00Z'],
  ])('issued at %s, expires 180 days after that UTC day began: %s', (now, expires) => {
    expect(renderSecurityTxt(securityContact('owner@example.test'), new Date(now))).toBe(
      'Contact: mailto:owner@example.test\n' +
        `Expires: ${expires}\n` +
        'Preferred-Languages: sv, en\n' +
        'Canonical: https://bladeblendstudio.se/.well-known/security.txt\n',
    )
  })

  it('is a function of the contact and the UTC day alone', () => {
    const issued = (email: string, now: string): string =>
      renderSecurityTxt(securityContact(email), new Date(now))
    const morning = issued('a@example.test', '2026-11-10T01:00:00Z')
    expect(issued('a@example.test', '2026-11-10T22:00:00Z')).toBe(morning)
    expect(issued('b@example.test', '2026-11-10T01:00:00Z')).not.toBe(morning)
    expect(issued('a@example.test', '2026-11-11T01:00:00Z')).not.toBe(morning)
  })

  // A local part of letters, digits and `._+-`, and a domain of letters, digits, `.` and `-` with a
  // dot in it.
  it.each([
    'owner@example.test',
    'owner+security@example.test',
    'First.Last+tag_1-x@mail.example-2.test',
    DEFAULT_BUSINESS.email,
  ])('names the stored address %j as it is written', (email) => {
    expect(securityContact(email)).toEqual({ kind: 'business', email })
    expect(renderSecurityTxt(securityContact(email), new Date(0)).split('\n')[0]).toBe(
      `Contact: mailto:${email}`,
    )
  })

  /** Stored addresses the business settings accept and security.txt cannot name as written. */
  const UNWRITABLE: readonly (readonly [string, string])[] = [
    ['a next-line control (U+0085)', 'owner\u0085x@example.test'],
    ['a NUL (U+0000)', 'owner\u0000x@example.test'],
    ['an escape control (U+001B)', 'owner\u001bx@example.test'],
    ['a delete control (U+007F)', 'owner\u007fx@example.test'],
    ['a non-ASCII letter in the local part', 'ägare@example.test'],
    ['a non-ASCII letter in the domain', 'owner@exämple.test'],
    ['a less-than sign', 'owner<x@example.test'],
    ['a greater-than sign', 'owner>x@example.test'],
    ['a double quote', 'owner"x@example.test'],
    ['a question mark', 'owner@example.test?subject=x'],
    ['a number sign', 'owner@example.test#x'],
    ['a percent sign', 'owner%0ax@example.test'],
    // Behind `mailto:` a comma starts a second recipient, and `?`, `&` and `=` write header fields.
    ['a comma', 'a,b@x.se'],
    ['an ampersand', 'owner&x@example.test'],
    ['an equals sign', 'owner=x@example.test'],
    ['a question mark in the local part', 'owner?x@example.test'],
    // Every other character outside the ones named as written.
    ['a slash', 'owner/x@example.test'],
    ['an apostrophe', "o'brien@example.test"],
    ['braces', 'owner{x}@example.test'],
    ['a vertical bar', 'owner|x@example.test'],
    ['a caret', 'owner^x@example.test'],
    ['a backslash', 'owner\\x@example.test'],
    ['brackets', 'owner[x]@example.test'],
    ['a backtick', 'owner`x@example.test'],
    ['an underscore in the domain', 'owner@exam_ple.test'],
    ['a plus sign in the domain', 'owner@exam+ple.test'],
  ]

  const REJECTED: readonly (readonly [string, string])[] = [
    ...UNWRITABLE,
    ['a space', 'owner x@example.test'],
    ['a line break', 'owner@example.test\nExpires: 2099-01-01T00:00:00Z'],
    ['two @', 'owner@x@example.test'],
    ['no @', 'owner.example.test'],
    ['no local part', '@example.test'],
    ['no domain', 'owner@'],
    ['a domain without a dot', 'owner@localhost'],
    ['a dot in the local part alone', 'first.last@localhost'],
    ['nothing', ''],
  ]

  it.each(REJECTED)('names the default address for a stored one with %s', (_label, email) => {
    expect(securityContact(email)).toEqual({ kind: 'default' })
    expect(renderSecurityTxt(securityContact(email), new Date(0)).split('\n')[0]).toBe(
      `Contact: mailto:${DEFAULT_BUSINESS.email}`,
    )
  })

  it('names the default address when no stored one could be read', () => {
    expect(securityContact(null)).toEqual({ kind: 'default' })
  })

  /** The handler reads the clock once; the UTC day may turn between that read and these two. */
  const expectIssued = (body: string, email: string, before: Date): void => {
    const contact = securityContact(email)
    expect([renderSecurityTxt(contact, before), renderSecurityTxt(contact, new Date())]).toContain(
      body,
    )
  }

  it('answers GET with the live business e-mail, through the cached entrypoint', async () => {
    const calls = stubNative(() => null)
    const env = createEnv()
    const publicContent = new PublicContent({} as never, env)
    const forwarded = vi.fn((request: Request) => publicContent.fetch(request))
    const before = new Date()
    const response = await worker.fetch(new Request(SECURITY_TXT), env, {
      exports: { PublicContent: { fetch: forwarded } },
    })
    expect(forwarded).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    // What lets the edge keep the answer, as it keeps the sitemap.
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expectIssued(await response.text(), 'owner@example.test', before)
    expect(calls).toEqual(['public_business_discovery'])
    expect(env.requested).toEqual([])
  })

  it.each(['response', 'exception'] as const)(
    'names the default e-mail, unstored and without a read, when the cached entrypoint fails (%s)',
    async (failure) => {
      const calls = stubNative(() => null)
      const env = createEnv()
      const before = new Date()
      const response = await worker.fetch(new Request(SECURITY_TXT), env, failing(failure))
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expectIssued(await response.text(), DEFAULT_BUSINESS.email, before)
      // No deployed file holds security.txt and the business was not read.
      expect(calls).toEqual([])
      expect(env.requested).toEqual([])
    },
  )

  it('names the default e-mail when Företag & SEO cannot be read', async () => {
    stubNative(() => null, null)
    const before = new Date()
    const response = await serve('/.well-known/security.txt')
    expect(response.status).toBe(200)
    expectIssued(await response.text(), DEFAULT_BUSINESS.email, before)
  })

  // A stored address with a line break never reaches the Worker's own check over HTTP: the business
  // settings answer it with their default. REJECTED above gives it to securityContact directly.
  it.each(UNWRITABLE)(
    'serves the default address for a stored one with %s',
    async (_label, email) => {
      stubNative(() => null, {
        ...DISCOVERY,
        settings: { ...DISCOVERY.settings, business_email: email },
      })
      const response = await serve('/.well-known/security.txt')
      expect(response.status).toBe(200)
      const lines = (await response.text()).split('\n')
      expect(lines).toHaveLength(5)
      expect(lines[0]).toBe(`Contact: mailto:${DEFAULT_BUSINESS.email}`)
      expect(lines.filter((line) => line.startsWith('Expires:'))).toHaveLength(1)
      expect(lines[4]).toBe('')
    },
  )

  it('gets each of those addresses from the business settings as stored', () => {
    // Otherwise the rows above would be answered by the settings' own default, not by the Worker.
    for (const [, email] of UNWRITABLE)
      expect(
        resolveBusinessSettings(new Map([['business_email', email]])).email,
        JSON.stringify(email),
      ).toBe(email)
  })

  it('answers HEAD with the same type, no body and no database read', async () => {
    const calls = stubNative(() => null)
    const response = await worker.fetch(
      new Request(SECURITY_TXT, { method: 'HEAD' }),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    // The headers GET gives the answer.
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(await response.text()).toBe('')
    expect(calls).toEqual([])
  })

  it.each([
    ['GET', '/.well-known/acp.json'],
    ['GET', '/.well-known/security.txt/'],
    ['GET', '/.well-known/security.txt.sig'],
    ['GET', '/.well-known/'],
    ['GET', '/.well-known/change-password'],
    ['GET', '/.well-known/Security.txt'],
    ['GET', '/security.txt'],
    ['HEAD', '/.well-known/openid-configuration'],
  ])('does not answer %s %s with security.txt', async (method, path) => {
    stubNative(() => null)
    const response = await worker.fetch(
      new Request(`${SITE}${path}`, { method }),
      createEnv(),
      noPublicContent,
    )
    expect(response.status).toBe(404)
    const body = await response.text()
    expect(body).not.toContain('Contact:')
    expect(body).not.toContain('Expires:')
  })

  it('does not answer POST /.well-known/security.txt with security.txt', async () => {
    const calls = stubNative(() => null)
    const response = await worker.fetch(
      new Request(SECURITY_TXT, { method: 'POST' }),
      createEnv(),
      noPublicContent,
    )
    // No status is asserted: the Worker passes on the asset layer's own answer to a POST, and the
    // ASSETS stand-in of this file answers by path alone.
    const body = await response.text()
    expect(body).not.toContain('Contact:')
    expect(body).not.toContain('Expires:')
    expect(calls).toEqual([])
  })

  it('lets a deployed file answer another /.well-known/ path', async () => {
    stubNative(() => null)
    const env = createEnv({ ...FILES, '/.well-known/assetlinks.json': '[]' })
    const response = await worker.fetch(
      new Request(`${SITE}/.well-known/assetlinks.json`),
      env,
      noPublicContent,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('[]')
    expect(env.requested).toEqual(['/.well-known/assetlinks.json'])
  })
})

describe('static routing (G, J, K)', () => {
  const config = JSON.parse(
    read('wrangler.jsonc')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1'),
  ) as { readonly assets: { readonly run_worker_first: readonly string[] } }
  const runFirst = config.assets.run_worker_first

  it('sends the sitemap and every /.well-known/ path to the Worker', () => {
    expect(runFirst[0]).toBe('/*')
    expect(runFirst).not.toContain('!/sitemap.xml')
    expect(runFirst.filter((rule) => rule.includes('well-known'))).toEqual([])
  })

  it.each(['/favicon.ico', '/apple-touch-icon.png', '/site.webmanifest'])(
    'serves %s from the deployed assets without the Worker',
    (path) => {
      expect(runFirst).toContain(`!${path}`)
    },
  )

  it('keeps the earlier asset-only files asset-only', () => {
    for (const path of ['/favicon.svg', '/robots.txt', '/og-image.png', '/tokens.css', '/info.css'])
      expect(runFirst).toContain(`!${path}`)
    // The Google verification file is never the Worker's, so it gets no robots header from it.
    expect(runFirst).toContain('!/googlefbf0c3168fbf0af5.html')
  })
})
