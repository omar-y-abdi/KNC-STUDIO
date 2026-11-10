import { describe, expect, it } from 'vitest'
import {
  headDocument,
  headWrite,
  identityWrite,
  openGraphLocales,
  routeIdentity,
  routeTexts,
  siteOriginOf,
  type RoutePage,
} from '../../modules/public-web/src/app/routeHead'
import {
  DEFAULT_BUSINESS,
  buildBusinessStructuredData,
} from '../../modules/public-web/src/site/business'
import {
  CMS_REVISION_ATTRIBUTE,
  bookingDescription,
  type NativePublicPath,
} from '../../modules/public-web/src/site/routeMetadata'

const ORIGIN = 'https://salong.example'
const NO_FACTS = { barbers: [], services: [], schedules: [] }
const NATIVE_PATHS = ['/', '/about', '/booking', '/my-bookings'] as const
const business = DEFAULT_BUSINESS
const name = business.name
const seo = business.seo
const indexable = 'index, follow, max-image-preview:large'

/** A page of the published presentation, saying the same in both languages. */
const page = (path: string, title: string, description = ''): RoutePage => ({
  path,
  title: { sv: title, en: title },
  description: { sv: description, en: description },
})

/** The `<html>` element of a document the Worker rendered, and of the bare shell (the Vite server,
 * a static fallback). */
const renderedRoot = { hasAttribute: (attribute: string) => attribute === CMS_REVISION_ATTRIBUTE }
const bareRoot = { hasAttribute: (attribute: string) => attribute === 'lang' }

describe('siteOriginOf', () => {
  it.each([
    'https://salong.example/',
    'https://salong.example/booking',
    'https://salong.example/?lang=en',
    'https://salong.example/booking?lang=en',
  ])('reads the origin of the canonical %s', (canonical) => {
    expect(siteOriginOf(canonical, 'https://fallback.example')).toBe(ORIGIN)
  })

  it('keeps a port and the scheme', () => {
    expect(siteOriginOf('http://127.0.0.1:5173/booking?lang=en', ORIGIN)).toBe(
      'http://127.0.0.1:5173',
    )
  })

  it.each([null, '', '/', '/booking?lang=en', 'https://', 'mailto:owner@salong.example'])(
    'answers at the fallback without an absolute canonical (%j)',
    (canonical) => {
      expect(siteOriginOf(canonical, ORIGIN)).toBe(ORIGIN)
    },
  )
})

describe('structured data rebuilt in the browser', () => {
  // The canonical of /booking has a path and the English one a query: the business is identified
  // by the site's origin under both.
  it.each(['https://salong.example/booking', 'https://salong.example/?lang=en'])(
    'identifies the business by the site origin under the canonical %s',
    (canonical) => {
      const data = buildBusinessStructuredData(
        DEFAULT_BUSINESS,
        NO_FACTS,
        siteOriginOf(canonical, 'https://fallback.example'),
      )
      expect(data['@id']).toBe('https://salong.example/#business')
      expect(data['url']).toBe('https://salong.example/')
      expect(data['image']).toBe('https://salong.example/og-image.png')
    },
  )
})

describe('openGraphLocales', () => {
  it('names the locale of the language and the other one as its alternate', () => {
    expect(openGraphLocales('sv')).toEqual({ locale: 'sv_SE', alternate: 'en_US' })
    expect(openGraphLocales('en')).toEqual({ locale: 'en_US', alternate: 'sv_SE' })
  })
})

describe('routeIdentity', () => {
  it.each([
    ['sv', 'https://salong.example/'],
    ['en', 'https://salong.example/?lang=en'],
  ] as const)('makes the homepage its own canonical in %s', (lang, canonical) => {
    expect(routeIdentity('/', lang, ORIGIN)).toEqual({
      canonical,
      url: canonical,
      robots: indexable,
      alternates: [
        { hreflang: 'sv', href: 'https://salong.example/' },
        { hreflang: 'en', href: 'https://salong.example/?lang=en' },
        { hreflang: 'x-default', href: 'https://salong.example/' },
      ],
      locales: openGraphLocales(lang),
    })
  })

  it.each([
    ['sv', 'https://salong.example/booking'],
    ['en', 'https://salong.example/booking?lang=en'],
  ] as const)('makes /booking its own canonical in %s', (lang, canonical) => {
    expect(routeIdentity('/booking', lang, ORIGIN)).toEqual({
      canonical,
      url: canonical,
      robots: indexable,
      alternates: [
        { hreflang: 'sv', href: 'https://salong.example/booking' },
        { hreflang: 'en', href: 'https://salong.example/booking?lang=en' },
        { hreflang: 'x-default', href: 'https://salong.example/booking' },
      ],
      locales: openGraphLocales(lang),
    })
  })

  it.each([
    ['sv', 'https://salong.example/'],
    ['en', 'https://salong.example/?lang=en'],
  ] as const)('points /about at the homepage in %s, without alternates', (lang, homepage) => {
    expect(routeIdentity('/about', lang, ORIGIN)).toEqual({
      canonical: homepage,
      url: homepage,
      robots: indexable,
      alternates: [],
      locales: openGraphLocales(lang),
    })
  })

  it.each([
    ['sv', 'https://salong.example/my-bookings'],
    ['en', 'https://salong.example/my-bookings?lang=en'],
  ] as const)('keeps /my-bookings out of the index in %s, without a canonical', (lang, own) => {
    expect(routeIdentity('/my-bookings', lang, ORIGIN)).toEqual({
      canonical: null,
      url: own,
      robots: 'noindex, follow',
      alternates: [],
      locales: openGraphLocales(lang),
    })
  })
})

describe('routeTexts', () => {
  it.each(['sv', 'en'] as const)(
    'gives a site without CMS pages the Företag & SEO texts and the route names (%s)',
    (lang) => {
      expect(routeTexts('/', lang, business, [])).toEqual({
        title: seo[lang].title,
        description: seo[lang].description,
      })
      expect(routeTexts('/about', lang, business, [])).toEqual({
        title: `${lang === 'sv' ? 'Om oss' : 'About'} – ${name}`,
        description: seo[lang].description,
      })
      expect(routeTexts('/booking', lang, business, [])).toEqual({
        title: `${lang === 'sv' ? 'Boka tid' : 'Book'} – ${name}`,
        description: bookingDescription(lang, business),
      })
      expect(routeTexts('/my-bookings', lang, business, [])).toEqual({
        title: `${lang === 'sv' ? 'Mina bokningar' : 'My bookings'} – ${name}`,
        description: seo[lang].description,
      })
      expect(bookingDescription(lang, business)).not.toBe(seo[lang].description)
    },
  )

  // The Worker's rule for the title, case for case as tests/unit/workerCrawlSurface.test.ts holds
  // `nativePageTitle` to it: the path, the language, the CMS title of the page (null: no such
  // page), the CMS title of the homepage, and the title served.
  const titles: readonly (readonly [
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

  it.each(titles)(
    'titles %s (%s) with CMS title %j beside homepage title %j as %j',
    (path, lang, own, home, expected) => {
      const pages =
        path === '/'
          ? own === null
            ? []
            : [page('/', own)]
          : [
              ...(home === null ? [] : [page('/', home)]),
              ...(own === null ? [] : [page(path, own)]),
            ]
      expect(routeTexts(path, lang, business, pages).title).toBe(expected)
    },
  )

  it.each(NATIVE_PATHS)(
    'describes %s as its own CMS page does when that says something',
    (path) => {
      const pages = NATIVE_PATHS.map((each) => page(each, 'Titel', `Text för ${each}`))
      expect(routeTexts(path, 'sv', business, pages).description).toBe(`Text för ${path}`)
    },
  )

  it.each(['', '   '])(
    'describes a page whose CMS description is %j by the default of its route',
    (blank) => {
      const pages = NATIVE_PATHS.map((path) => page(path, 'Titel', blank))
      for (const lang of ['sv', 'en'] as const) {
        expect(routeTexts('/booking', lang, business, pages).description).toBe(
          bookingDescription(lang, business),
        )
        for (const path of ['/', '/about', '/my-bookings'] as const)
          expect(routeTexts(path, lang, business, pages).description).toBe(seo[lang].description)
      }
    },
  )

  it('reads the text of the language shown, on the page of the path shown', () => {
    const pages: RoutePage[] = [
      page('/about', 'Om salongen', 'Salongens historia'),
      {
        path: '/booking',
        title: { sv: 'Boka klippning', en: 'Book a haircut' },
        description: { sv: 'Välj en tid.', en: 'Pick a time.' },
      },
    ]
    expect(routeTexts('/booking', 'sv', business, pages)).toEqual({
      title: 'Boka klippning',
      description: 'Välj en tid.',
    })
    expect(routeTexts('/booking', 'en', business, pages)).toEqual({
      title: 'Book a haircut',
      description: 'Pick a time.',
    })
    expect(routeTexts('/my-bookings', 'sv', business, pages)).toEqual({
      title: `Mina bokningar – ${name}`,
      description: seo.sv.description,
    })
  })
})

describe('headDocument', () => {
  it('knows a document the app has moved nowhere in from one it has navigated in', () => {
    expect(headDocument(null, renderedRoot).navigated).toBe(false)
    expect(headDocument(null, bareRoot).navigated).toBe(false)
    expect(headDocument('/booking', renderedRoot).navigated).toBe(true)
    expect(headDocument('/?lang=en', bareRoot).navigated).toBe(true)
  })

  it('knows a document the Worker rendered by the revision named on its root', () => {
    expect(headDocument(null, renderedRoot).serverRendered).toBe(true)
    expect(headDocument('/booking', renderedRoot).serverRendered).toBe(true)
    expect(headDocument(null, bareRoot).serverRendered).toBe(false)
    expect(headDocument('/booking', bareRoot).serverRendered).toBe(false)
  })
})

describe('identityWrite', () => {
  it.each(NATIVE_PATHS)('leaves the identity of %s as served until the app navigates', (path) => {
    for (const root of [renderedRoot, bareRoot])
      for (const lang of ['sv', 'en'] as const)
        expect(identityWrite(path, lang, ORIGIN, headDocument(null, root))).toBeNull()
  })

  it.each(NATIVE_PATHS)(
    'gives %s its identity as soon as the app has navigated, rendered or not',
    (path) => {
      // No business settings and no CMS page are asked for: nothing the app loads is waited for.
      for (const root of [renderedRoot, bareRoot])
        for (const lang of ['sv', 'en'] as const)
          expect(identityWrite(path, lang, ORIGIN, headDocument(path, root))).toEqual(
            routeIdentity(path, lang, ORIGIN),
          )
    },
  )

  it('takes the account page out of the index when the app opens it from a served homepage', () => {
    const identity = identityWrite('/my-bookings', 'sv', ORIGIN, {
      navigated: true,
      serverRendered: true,
    })
    expect(identity?.robots).toBe('noindex, follow')
    expect(identity?.canonical).toBeNull()
    expect(identity?.alternates).toEqual([])
    expect(identity?.url).toBe('https://salong.example/my-bookings')
  })

  it('names the English canonical and locales after a language switch', () => {
    const identity = identityWrite('/', 'en', ORIGIN, { navigated: true, serverRendered: true })
    expect(identity?.canonical).toBe('https://salong.example/?lang=en')
    expect(identity?.url).toBe('https://salong.example/?lang=en')
    expect(identity?.locales).toEqual({ locale: 'en_US', alternate: 'sv_SE' })
  })

  it('writes nothing at a path that is not a native route', () => {
    expect(identityWrite(null, 'sv', ORIGIN, { navigated: true, serverRendered: false })).toBeNull()
  })
})

describe('headWrite', () => {
  const pages = [page('/', 'Klippning', 'Om salongen'), page('/booking', 'Boka klippning')]
  const rendered = headDocument(null, renderedRoot)
  const bare = headDocument(null, bareRoot)

  it.each(['sv', 'en'] as const)(
    'leaves the title and descriptions of a rendered homepage as served (%s)',
    (lang) => {
      expect(headWrite('/', lang, business, pages, rendered)).toBeNull()
    },
  )

  it.each(['sv', 'en'] as const)(
    'gives a homepage the Worker did not render its texts and the locales of its language (%s)',
    (lang) => {
      expect(headWrite('/', lang, business, pages, bare)).toEqual({
        texts: {
          title: `${name} – Barbershop ${lang === 'sv' ? 'i' : 'in'} Göteborg | Klippning`,
          description: 'Om salongen',
        },
        locales: openGraphLocales(lang),
      })
      expect(headWrite('/', lang, business, [], bare)).toEqual({
        texts: { title: seo[lang].title, description: seo[lang].description },
        locales: openGraphLocales(lang),
      })
    },
  )

  it.each(['/about', '/booking', '/my-bookings'] as const)(
    'leaves %s as served until the app navigates, rendered or not',
    (path) => {
      expect(headWrite(path, 'sv', business, pages, rendered)).toBeNull()
      expect(headWrite(path, 'en', business, pages, bare)).toBeNull()
    },
  )

  it.each(NATIVE_PATHS)(
    'writes the texts of %s, and no locales, once the app has navigated there',
    (path) => {
      for (const root of [renderedRoot, bareRoot])
        for (const lang of ['sv', 'en'] as const)
          expect(headWrite(path, lang, business, pages, headDocument(path, root))).toEqual({
            texts: routeTexts(path, lang, business, pages),
            locales: null,
          })
    },
  )

  it('writes what the owner wrote for the page the app moved to', () => {
    const navigated = headDocument('/booking', renderedRoot)
    expect(headWrite('/booking', 'sv', business, pages, navigated)?.texts).toEqual({
      title: 'Boka klippning',
      description: bookingDescription('sv', business),
    })
    expect(headWrite('/about', 'sv', business, pages, navigated)?.texts).toEqual({
      title: `Om oss – ${name}`,
      description: seo.sv.description,
    })
  })

  it('writes the texts of the new language after a language switch on a rendered homepage', () => {
    const write = headWrite('/', 'en', business, [], headDocument('/?lang=en', renderedRoot))
    expect(write).toEqual({
      texts: { title: seo.en.title, description: seo.en.description },
      locales: null,
    })
  })

  it('writes nothing at a path that is not a native route', () => {
    expect(headWrite(null, 'sv', business, pages, headDocument('/x', bareRoot))).toBeNull()
    expect(headWrite(null, 'sv', business, pages, bare)).toBeNull()
  })
})
