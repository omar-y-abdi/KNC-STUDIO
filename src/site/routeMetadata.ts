/** Native site routes use the same saved presentation across pages. */
export const NATIVE_PUBLIC_PATHS: readonly string[] = ['/', '/about', '/booking', '/my-bookings']

/** Public paths that must wait for the authoritative CMS presentation before rendering App. */
export function isNativePublicPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return NATIVE_PUBLIC_PATHS.includes(path) || /^\/[0-9a-f]{64}$/i.test(path)
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
