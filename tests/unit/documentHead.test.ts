import { describe, expect, it } from 'vitest'
import {
  setMetaContent,
  writeLocales,
  writeRouteIdentity,
  writeRouteTexts,
} from '../../modules/public-web/src/app/documentHead'
import { routeIdentity } from '../../modules/public-web/src/app/routeHead'
import { matchesSelector, type SelectorSubject } from './helpers/fakeSelector'

const ORIGIN = 'https://salong.example'
const indexable = 'index, follow, max-image-preview:large'

// A stand-in for the document head: its tags in document order. A selector the code asks with is
// applied to them for real (helpers/fakeSelector.ts).

class FakeTag implements SelectorSubject {
  readonly tag: string
  readonly attributes = new Map<string, string>()
  private siblings: FakeTag[] | null = null

  constructor(tag: string, attributes: Readonly<Record<string, string>> = {}) {
    this.tag = tag
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  /** Puts the tag last among `tags`, as `appendChild` does. */
  appendTo(tags: FakeTag[]): this {
    this.siblings = tags
    tags.push(this)
    return this
  }

  remove(): void {
    this.siblings?.splice(this.siblings.indexOf(this), 1)
    this.siblings = null
  }
}

interface FakeHead {
  readonly page: Document
  readonly title: () => string
  /** The tags that match, in document order, as plain attribute records. */
  readonly all: (selector: string) => Record<string, string>[]
  readonly first: (selector: string) => FakeTag | undefined
  readonly count: () => number
}

const meta = (key: 'name' | 'property', value: string, content: string): FakeTag =>
  new FakeTag('meta', { [key]: value, content })
const link = (attributes: Readonly<Record<string, string>>): FakeTag =>
  new FakeTag('link', attributes)

function head(...initial: FakeTag[]): FakeHead {
  const tags: FakeTag[] = []
  for (const tag of initial) tag.appendTo(tags)
  const matching = (selector: string): FakeTag[] =>
    tags.filter((tag) => matchesSelector(tag, selector))
  const fake = {
    title: 'Served title',
    head: { appendChild: (tag: FakeTag) => tag.appendTo(tags) },
    createElement: (name: string) => new FakeTag(name),
    querySelector: (selector: string) => matching(selector)[0] ?? null,
    querySelectorAll: matching,
  }
  return {
    page: fake as unknown as Document,
    title: () => fake.title,
    all: (selector) => matching(selector).map((tag) => Object.fromEntries(tag.attributes)),
    first: (selector) => matching(selector)[0],
    count: () => tags.length,
  }
}

/** The texts and the social tags every served document carries. */
const texts = (): FakeTag[] => [
  meta('name', 'description', 'Served description'),
  meta('property', 'og:title', 'Served title'),
  meta('property', 'og:description', 'Served description'),
  meta('name', 'twitter:title', 'Served title'),
  meta('name', 'twitter:description', 'Served description'),
]

/** Links of the shell that are not the route's: a stylesheet, and an alternate that is no language
 * version. */
const otherLinks = (): FakeTag[] => [
  link({ rel: 'stylesheet', href: '/tokens.css' }),
  link({ rel: 'alternate', type: 'application/rss+xml', href: '/feed.xml' }),
]

/** The head the Worker serves for the Swedish homepage. */
const servedHomepage = (): FakeHead =>
  head(
    ...texts(),
    meta('name', 'robots', indexable),
    link({ rel: 'canonical', href: 'https://salong.example/' }),
    link({ rel: 'alternate', hreflang: 'sv', href: 'https://salong.example/' }),
    link({ rel: 'alternate', hreflang: 'en', href: 'https://salong.example/?lang=en' }),
    link({ rel: 'alternate', hreflang: 'x-default', href: 'https://salong.example/' }),
    meta('property', 'og:url', 'https://salong.example/'),
    meta('property', 'og:locale', 'sv_SE'),
    meta('property', 'og:locale:alternate', 'en_US'),
    ...otherLinks(),
  )

/** The head the Worker serves for the Swedish account page: out of the index, without a canonical
 * and without language alternates. */
const servedAccount = (): FakeHead =>
  head(
    ...texts(),
    meta('name', 'robots', 'noindex, follow'),
    meta('property', 'og:url', 'https://salong.example/my-bookings'),
    meta('property', 'og:locale', 'sv_SE'),
    meta('property', 'og:locale:alternate', 'en_US'),
    ...otherLinks(),
  )

const CANONICAL = 'link[rel="canonical"]'
const LANGUAGE_ALTERNATES = 'link[rel="alternate"][hreflang]'
const content = (document: FakeHead, selector: string): string | undefined =>
  document.all(selector)[0]?.['content']

describe('writeRouteIdentity', () => {
  it('moves a served homepage to the account page: out of the index, no canonical, no alternates', () => {
    const document = servedHomepage()
    writeRouteIdentity(document.page, routeIdentity('/my-bookings', 'sv', ORIGIN))
    expect(content(document, 'meta[name="robots"]')).toBe('noindex, follow')
    expect(content(document, 'meta[property="og:url"]')).toBe('https://salong.example/my-bookings')
    expect(document.all(CANONICAL)).toEqual([])
    expect(document.all(LANGUAGE_ALTERNATES)).toEqual([])
    expect(content(document, 'meta[property="og:locale"]')).toBe('sv_SE')
    expect(content(document, 'meta[property="og:locale:alternate"]')).toBe('en_US')
    // The other links of the shell stay.
    expect(document.all('link')).toEqual([
      { rel: 'stylesheet', href: '/tokens.css' },
      { rel: 'alternate', type: 'application/rss+xml', href: '/feed.xml' },
    ])
  })

  it('moves a served account page to the English homepage: every tag of its identity', () => {
    const document = servedAccount()
    writeRouteIdentity(document.page, routeIdentity('/', 'en', ORIGIN))
    expect(content(document, 'meta[name="robots"]')).toBe(indexable)
    expect(content(document, 'meta[property="og:url"]')).toBe('https://salong.example/?lang=en')
    expect(content(document, 'meta[property="og:locale"]')).toBe('en_US')
    expect(content(document, 'meta[property="og:locale:alternate"]')).toBe('sv_SE')
    expect(document.all(CANONICAL)).toEqual([
      { rel: 'canonical', href: 'https://salong.example/?lang=en' },
    ])
    expect(document.all(LANGUAGE_ALTERNATES)).toEqual([
      { rel: 'alternate', hreflang: 'sv', href: 'https://salong.example/' },
      { rel: 'alternate', hreflang: 'en', href: 'https://salong.example/?lang=en' },
      { rel: 'alternate', hreflang: 'x-default', href: 'https://salong.example/' },
    ])
  })

  it('rewrites the links a document already has, and adds none beside them', () => {
    const document = servedHomepage()
    const canonical = document.first(CANONICAL)
    const tags = document.count()
    writeRouteIdentity(document.page, routeIdentity('/booking', 'en', ORIGIN))
    expect(document.count()).toBe(tags)
    expect(document.first(CANONICAL)).toBe(canonical)
    expect(document.all(CANONICAL)).toEqual([
      { rel: 'canonical', href: 'https://salong.example/booking?lang=en' },
    ])
    expect(document.all(LANGUAGE_ALTERNATES)).toEqual([
      { rel: 'alternate', hreflang: 'sv', href: 'https://salong.example/booking' },
      { rel: 'alternate', hreflang: 'en', href: 'https://salong.example/booking?lang=en' },
      { rel: 'alternate', hreflang: 'x-default', href: 'https://salong.example/booking' },
    ])
    expect(content(document, 'meta[property="og:url"]')).toBe(
      'https://salong.example/booking?lang=en',
    )
  })

  it('points /about at the homepage and takes the language alternates away', () => {
    const document = servedHomepage()
    writeRouteIdentity(document.page, routeIdentity('/about', 'en', ORIGIN))
    expect(document.all(CANONICAL)).toEqual([
      { rel: 'canonical', href: 'https://salong.example/?lang=en' },
    ])
    expect(content(document, 'meta[property="og:url"]')).toBe('https://salong.example/?lang=en')
    expect(document.all(LANGUAGE_ALTERNATES)).toEqual([])
    expect(content(document, 'meta[name="robots"]')).toBe(indexable)
  })

  it('leaves the title and the descriptions alone', () => {
    const document = servedHomepage()
    writeRouteIdentity(document.page, routeIdentity('/my-bookings', 'en', ORIGIN))
    expect(document.title()).toBe('Served title')
    expect(content(document, 'meta[name="description"]')).toBe('Served description')
    expect(content(document, 'meta[property="og:title"]')).toBe('Served title')
  })
})

describe('writeLocales', () => {
  it('writes the locale and its alternate, each into its own tag', () => {
    const document = servedHomepage()
    writeLocales(document.page, { locale: 'en_US', alternate: 'sv_SE' })
    expect(content(document, 'meta[property="og:locale"]')).toBe('en_US')
    expect(content(document, 'meta[property="og:locale:alternate"]')).toBe('sv_SE')
  })
})

describe('writeRouteTexts', () => {
  it('writes the title and the description into every tag that repeats them', () => {
    const document = servedHomepage()
    writeRouteTexts(document.page, { title: 'Boka tid – Salong', description: 'Välj en tid.' })
    expect(document.title()).toBe('Boka tid – Salong')
    expect(content(document, 'meta[name="description"]')).toBe('Välj en tid.')
    expect(content(document, 'meta[property="og:title"]')).toBe('Boka tid – Salong')
    expect(content(document, 'meta[property="og:description"]')).toBe('Välj en tid.')
    expect(content(document, 'meta[name="twitter:title"]')).toBe('Boka tid – Salong')
    expect(content(document, 'meta[name="twitter:description"]')).toBe('Välj en tid.')
    // The identity of the address is not the texts'.
    expect(content(document, 'meta[property="og:url"]')).toBe('https://salong.example/')
    expect(content(document, 'meta[name="robots"]')).toBe(indexable)
  })

  it('creates no tag the shell does not carry', () => {
    const document = head(meta('name', 'description', 'Served description'))
    writeRouteTexts(document.page, { title: 'Titel', description: 'Text' })
    expect(document.title()).toBe('Titel')
    expect(document.all('meta')).toEqual([{ name: 'description', content: 'Text' }])
  })
})

describe('setMetaContent', () => {
  it('writes the first tag that matches and creates none', () => {
    const document = head(meta('property', 'og:site_name', 'Served name'))
    setMetaContent(document.page, 'meta[property="og:site_name"]', 'Salong')
    setMetaContent(document.page, 'meta[property="og:image:alt"]', 'Salong')
    expect(document.all('meta')).toEqual([{ property: 'og:site_name', content: 'Salong' }])
  })
})
