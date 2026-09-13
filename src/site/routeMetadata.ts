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
