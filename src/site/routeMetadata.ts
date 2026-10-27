/** Native site routes use the same saved presentation across pages. */
export const NATIVE_PUBLIC_PATHS: readonly string[] = ['/', '/about', '/booking', '/my-bookings']

/** Public paths that must wait for the authoritative CMS presentation before rendering App. */
export function isNativePublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
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

/** Fixed route names only: never place customer credentials or arbitrary paths in metadata. */
export function privatePageTitle(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '')
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
