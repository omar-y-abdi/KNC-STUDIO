import type { Lang } from '../i18n/index'

const NATIVE_PATHS = ['/', '/about', '/booking', '/my-bookings'] as const

export type NativePublicPath = (typeof NATIVE_PATHS)[number]

/** A native route that is not the homepage: it has a name of its own. */
export type NativeSubpage = Exclude<NativePublicPath, '/'>

/** Native site routes use the same saved presentation across pages. */
export const NATIVE_PUBLIC_PATHS: readonly string[] = NATIVE_PATHS

/** `pathname` as the native route it names exactly; null for every other path. */
export function nativePublicPath(pathname: string): NativePublicPath | null {
  return NATIVE_PATHS.find((path) => path === pathname) ?? null
}

/** /about and /booking are named as the site menu labels them (menuLinks in content-contracts
 * site-page.ts). The menu has no /my-bookings: that name is the one Studio's page list gives the
 * page (studio nativePages.ts), which lists /booking as "Bokning"/"Booking". */
const NATIVE_SUBPAGE_NAMES: Readonly<Record<NativeSubpage, Readonly<Record<Lang, string>>>> = {
  '/about': { sv: 'Om oss', en: 'About' },
  '/booking': { sv: 'Boka tid', en: 'Book' },
  '/my-bookings': { sv: 'Mina bokningar', en: 'My bookings' },
}

/** The title of a native subpage whose CMS page has no title of its own. */
export function nativeRouteTitle(path: NativeSubpage, lang: Lang, businessName: string): string {
  return `${NATIVE_SUBPAGE_NAMES[path][lang]} – ${businessName}`
}

/** The booking page's description when the owner has written none: its own, not the homepage's. */
export function bookingDescription(
  lang: Lang,
  business: { readonly name: string; readonly city: string },
): string {
  return lang === 'sv'
    ? `Boka tid hos ${business.name} i ${business.city}: välj barberare, behandling och en ledig tid online.`
    : `Book an appointment at ${business.name} in ${business.city}: choose a barber, a service and an available time online.`
}

/** Public paths that must wait for the authoritative CMS presentation before rendering App. */
export function isNativePublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? trimTrailingSlashes(pathname) : pathname
  return NATIVE_PUBLIC_PATHS.includes(path) || /^\/[0-9a-f]{64}$/i.test(path)
}

/** The published presentation the native routes read. */
export const PRESENTATION_PATH = '/api/cms/presentation'

/** The Worker writes the revision a native shell was rendered from onto `<html>`; the app reads it. */
export const CMS_REVISION_ATTRIBUTE = 'data-cms-revision'

const REVISION_QUERY = '?rev='

/** A CMS revision written as plain digits: no sign, leading zero, fraction or exponent. */
export function parseCmsRevision(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null
  const revision = Number(value)
  return Number.isSafeInteger(revision) ? revision : null
}

/** The presentation read for one revision; the unversioned read when the shell named none. */
export function presentationPath(revision: number | null): string {
  return revision === null ? PRESENTATION_PATH : `${PRESENTATION_PATH}${REVISION_QUERY}${revision}`
}

/** The revision a presentation request names. Only exactly `?rev=<digits>` is versioned, so the
 * edge cache holds one entry per revision and no other URL form can reach it. */
export function requestedPresentationRevision(url: URL): number | null {
  return url.search.startsWith(REVISION_QUERY)
    ? parseCmsRevision(url.search.slice(REVISION_QUERY.length))
    : null
}

function trimTrailingSlashes(pathname: string): string {
  let end = pathname.length
  while (end > 0 && pathname.charCodeAt(end - 1) === 47) end--
  return pathname.slice(0, end)
}

/** Fixed route names only: never place customer credentials or arbitrary paths in metadata. */
export function privatePageTitle(pathname: string): string | null {
  const path = trimTrailingSlashes(pathname)
  const titles: Readonly<Record<string, string>> = {
    '/login': 'Logga in',
    '/reset': 'Återställ lösenord',
    '/invite': 'Aktivera personalkonto',
    '/auth/confirm': 'Bekräfta e-postadress',
    '/admin': 'Adminpanel',
  }
  const title = path.startsWith('/admin/') ? 'Adminpanel' : titles[path]
  return title === undefined ? null : `${title} — Blade & Blend Studio`
}
