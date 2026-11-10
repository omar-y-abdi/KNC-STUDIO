// The document head of a native route as the Worker renders it (supabase/worker/index.ts), for the
// moments the app changes the address itself: a view change, the "Mina bokningar" dialog, a history
// step or a language switch. Everything here is pure; app/documentHead.ts writes the answers.
//
// A head has two parts:
//  - the identity (robots, canonical, `og:url`, the language alternates, the `og:locale` pair) needs
//    only the path, the language and the origin (the Worker's `nativeIdentity`, `withNativeIdentity`
//    and `nativeShellHead`);
//  - the texts (title and description) need the business settings and what the owner wrote for the
//    page in Studio (the Worker's `nativePageTitle` and `nativePageDescription`). The app has both:
//    the settings from the site chrome, the pages from the published presentation it renders.
//
// `identityWrite` and `headWrite` say how much of either the app may write at all: nothing of a
// document as it was served, until the app has changed the address itself.

import type { CmsPage } from '@bladeblend/content-contracts/cms'
import type { Lang } from '../i18n/index'
import {
  CMS_REVISION_ATTRIBUTE,
  bookingDescription,
  nativeRouteTitle,
  type NativePublicPath,
} from '../site/routeMetadata'

export interface RouteHeadBusiness {
  readonly name: string
  readonly city: string
  readonly seo: Readonly<Record<Lang, { readonly title: string; readonly description: string }>>
}

/** A page of the published presentation as far as the head reads it. */
export type RoutePage = Pick<CmsPage, 'path' | 'title' | 'description'>

export interface RouteAlternate {
  readonly hreflang: string
  readonly href: string
}

/** `og:locale` of a page and its `og:locale:alternate`. */
export interface OpenGraphLocales {
  readonly locale: string
  readonly alternate: string
}

export interface RouteIdentity {
  /** Null on the account page, which has no canonical. */
  readonly canonical: string | null
  /** `og:url`: the canonical, or the page's own address where there is none. */
  readonly url: string
  readonly robots: string
  /** The language alternates of a page that is its own canonical; none elsewhere. */
  readonly alternates: readonly RouteAlternate[]
  readonly locales: OpenGraphLocales
}

export interface RouteTexts {
  readonly title: string
  readonly description: string
}

const INDEXABLE = 'index, follow, max-image-preview:large'
const ACCOUNT = 'noindex, follow'

/** The origin the site names itself by: the one of the canonical the server rendered. A document
 * without an absolute canonical (the account page, an unrendered shell) answers at `fallback`. */
export function siteOriginOf(canonical: string | null, fallback: string): string {
  if (canonical === null || !/^https?:\/\//i.test(canonical)) return fallback
  try {
    return new URL(canonical).origin
  } catch {
    return fallback
  }
}

function languageUrl(origin: string, path: NativePublicPath, lang: Lang): string {
  return lang === 'en' ? `${origin}${path}?lang=en` : `${origin}${path}`
}

function languageAlternates(origin: string, path: NativePublicPath): readonly RouteAlternate[] {
  const swedish = languageUrl(origin, path, 'sv')
  return [
    { hreflang: 'sv', href: swedish },
    { hreflang: 'en', href: languageUrl(origin, path, 'en') },
    { hreflang: 'x-default', href: swedish },
  ]
}

/** `og:locale` of a page in `lang` and its `og:locale:alternate`, as the Worker's `nativeShellHead`
 * writes them. */
export function openGraphLocales(lang: Lang): OpenGraphLocales {
  return lang === 'en'
    ? { locale: 'en_US', alternate: 'sv_SE' }
    : { locale: 'sv_SE', alternate: 'en_US' }
}

export function routeIdentity(path: NativePublicPath, lang: Lang, origin: string): RouteIdentity {
  const locales = openGraphLocales(lang)
  switch (path) {
    case '/':
    case '/booking': {
      const canonical = languageUrl(origin, path, lang)
      return {
        canonical,
        url: canonical,
        robots: INDEXABLE,
        alternates: languageAlternates(origin, path),
        locales,
      }
    }
    case '/about': {
      const canonical = languageUrl(origin, '/', lang)
      return { canonical, url: canonical, robots: INDEXABLE, alternates: [], locales }
    }
    case '/my-bookings':
      return {
        canonical: null,
        url: languageUrl(origin, path, lang),
        robots: ACCOUNT,
        alternates: [],
        locales,
      }
  }
}

/** What the owner wrote for the page at `path` in Studio, in `lang`: the Worker reads the same
 * field of the same published presentation (`public_cms_page_metadata`). Null without that page. */
function ownText(
  pages: readonly RoutePage[],
  path: NativePublicPath,
  lang: Lang,
  field: 'title' | 'description',
): string | null {
  return pages.find((page) => page.path === path)?.[field][lang] ?? null
}

// The three rules below are the Worker's own (`homepageTitle`, `nativePageTitle` and
// `nativePageDescription` in supabase/worker/index.ts), repeated here because they live in the
// Worker's entry module, which the app cannot import. tests/unit/routeHead.test.ts holds them to
// the cases tests/unit/workerCrawlSurface.test.ts holds the Worker to.

/** The homepage title: its CMS title, led by the business name and city unless it already says
 * barbershop; the Företag & SEO title when the CMS page has none. */
function homepageTitle(business: RouteHeadBusiness, lang: Lang, cmsTitle: string | null): string {
  if (cmsTitle === null || cmsTitle.trim() === '') return business.seo[lang].title
  return cmsTitle.toLowerCase().includes('barbershop')
    ? cmsTitle
    : `${business.name} – Barbershop ${lang === 'sv' ? 'i' : 'in'} ${business.city} | ${cmsTitle}`
}

/** A native route's title. Studio seeds every native page with the homepage's title, so on the
 * other routes a title that is missing, blank or the homepage's gives way to the route's name. */
function pageTitle(
  path: NativePublicPath,
  lang: Lang,
  business: RouteHeadBusiness,
  own: string | null,
  home: string | null,
): string {
  if (path === '/') return homepageTitle(business, lang, own)
  const title = own?.trim() ?? ''
  const homepage = [home ?? '', homepageTitle(business, lang, home), business.seo[lang].title]
  return own === null || title === '' || homepage.some((value) => value.trim() === title)
    ? nativeRouteTitle(path, lang, business.name)
    : own
}

/** A native route's description: its CMS page's, else the booking page's own default, else the
 * homepage's from Företag & SEO. */
function pageDescription(
  path: NativePublicPath,
  lang: Lang,
  business: RouteHeadBusiness,
  own: string | null,
): string {
  if (own !== null && own.trim() !== '') return own
  return path === '/booking' ? bookingDescription(lang, business) : business.seo[lang].description
}

export function routeTexts(
  path: NativePublicPath,
  lang: Lang,
  business: RouteHeadBusiness,
  pages: readonly RoutePage[],
): RouteTexts {
  return {
    title: pageTitle(
      path,
      lang,
      business,
      ownText(pages, path, lang, 'title'),
      ownText(pages, '/', lang, 'title'),
    ),
    description: pageDescription(path, lang, business, ownText(pages, path, lang, 'description')),
  }
}

/** What the app knows about the document it runs in. */
export interface HeadDocument {
  /** The app has changed path or query itself: a view change, a history step, a language switch. */
  readonly navigated: boolean
  /** The Worker rendered this document's head for the address it was asked for. */
  readonly serverRendered: boolean
}

/**
 * Reads `HeadDocument` off the app's own record and the document. `headAddress` is the address the
 * app last moved to itself, null while it has moved nowhere. The Worker names the revision it
 * rendered a document from on `root`, the `<html>` element; the bare shell (the Vite server, a
 * static fallback) carries none.
 */
export function headDocument(
  headAddress: string | null,
  root: { hasAttribute(name: string): boolean },
): HeadDocument {
  return {
    navigated: headAddress !== null,
    serverRendered: root.hasAttribute(CMS_REVISION_ATTRIBUTE),
  }
}

/**
 * The identity the app writes at `path` (null: not a native route): none while the document is as
 * it was served, the route's as soon as the app has navigated. It waits for nothing the app loads,
 * so the account page is out of the index and a page in the other language names its own
 * canonical also while the business settings are slow or fail.
 */
export function identityWrite(
  path: NativePublicPath | null,
  lang: Lang,
  origin: string,
  document: HeadDocument,
): RouteIdentity | null {
  return path !== null && document.navigated ? routeIdentity(path, lang, origin) : null
}

export interface HeadWrite {
  readonly texts: RouteTexts
  /** The `og:locale` pair, where nothing else writes it: the homepage of a document the Worker did
   * not render, before the app has navigated. Null once `identityWrite` covers it. */
  readonly locales: OpenGraphLocales | null
}

/**
 * The texts the app writes at `path` (null: not a native route), or null to leave them as served.
 * Before the app has navigated, the served head stands: the Worker wrote the title and description
 * of exactly this address. Only a homepage the Worker did not render (the bare shell) takes its
 * texts, and the locales of its language, from here. Once the app has navigated, the texts are the
 * route's.
 */
export function headWrite(
  path: NativePublicPath | null,
  lang: Lang,
  business: RouteHeadBusiness,
  pages: readonly RoutePage[],
  document: HeadDocument,
): HeadWrite | null {
  if (path === null) return null
  if (document.navigated) return { texts: routeTexts(path, lang, business, pages), locales: null }
  return path === '/' && !document.serverRendered
    ? { texts: routeTexts(path, lang, business, pages), locales: openGraphLocales(lang) }
    : null
}
