// The head of a native route as the Worker renders it (supabase/worker/index.ts), for when the app
// changes the address itself. Pure; app/documentHead.ts writes the answers.

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

/** As the Worker's `nativeShellHead` writes them. */
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

/** The Worker reads the same field of the same presentation (`public_cms_page_metadata`). */
function ownText(
  pages: readonly RoutePage[],
  path: NativePublicPath,
  lang: Lang,
  field: 'title' | 'description',
): string | null {
  return pages.find((page) => page.path === path)?.[field][lang] ?? null
}

// The three rules below copy the Worker's `homepageTitle`, `nativePageTitle` and
// `nativePageDescription` (the app cannot import their module); routeHead.test.ts uses their cases.

function homepageTitle(business: RouteHeadBusiness, lang: Lang, cmsTitle: string | null): string {
  if (cmsTitle === null || cmsTitle.trim() === '') return business.seo[lang].title
  return cmsTitle.toLowerCase().includes('barbershop')
    ? cmsTitle
    : `${business.name} – Barbershop ${lang === 'sv' ? 'i' : 'in'} ${business.city} | ${cmsTitle}`
}

/** Studio seeds every native page with the homepage's title, so that title gives way here. */
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

export interface HeadDocument {
  /** The app has changed path or query itself. */
  readonly navigated: boolean
  readonly serverRendered: boolean
}

/** The Worker marks the `<html>` it rendered with the revision; the bare shell (the Vite server, a
 * static fallback) carries none. */
export function headDocument(
  headAddress: string | null,
  root: { hasAttribute(name: string): boolean },
): HeadDocument {
  return {
    navigated: headAddress !== null,
    serverRendered: root.hasAttribute(CMS_REVISION_ATTRIBUTE),
  }
}

/** Waits for nothing the app loads, so the account page leaves the index even while the business
 * settings are slow or fail. */
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
  /** Only where nothing else writes it: a homepage the Worker did not render. */
  readonly locales: OpenGraphLocales | null
}

/** Null leaves the served head: before the app navigates, the Worker's texts are this address's.
 * Only a homepage the Worker did not render (the bare shell) takes them from here. */
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
