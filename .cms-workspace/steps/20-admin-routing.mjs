import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function integrate(root) {
  const edit = (path, before, after) => {
    const file = resolve(root, path), source = readFileSync(file, 'utf8')
    if (!source.includes(before)) throw new Error(`Missing routing anchor: ${path}: ${before.slice(0, 80)}`)
    writeFileSync(file, source.replace(before, after))
  }
  edit('src/admin/AdminApp.tsx', 'const AdminShell = lazy', "const CmsStudio = lazy(() => import('./cms/Studio'))\nconst CmsPreview = lazy(() => import('./cms/Preview'))\n\nconst AdminShell = lazy")
  edit('src/admin/AdminApp.tsx', 'const [, navigate] = useLocation()', 'const [pathname, navigate] = useLocation()')
  edit('src/admin/AdminApp.tsx', '\n  return (\n    <>', `
  // The additive studio uses the existing session and forced-password gate.
  if (pathname === '/admin/cms' || pathname.startsWith('/admin/cms/')) {
    return gate.profile.role === 'owner' ? (
      <LazySurface loadingLabel={t.lazyLoading} errorLabel={t.lazyError} retryLabel={t.lazyReload} minHeight="100vh">
        {pathname.replace(/\\/+$/, '') === '/admin/cms/preview'
          ? <CmsPreview />
          : <CmsStudio profile={gate.profile} initialLang={theme.lang} initialMode={theme.dark ? 'dark' : 'light'} />}
      </LazySurface>
    ) : (
      <main role="alert" style={{ minHeight: '100vh', background: c.bg, color: c.text, padding: '32px' }}>
        <h1>{theme.lang === 'sv' ? 'Endast ägaren kan redigera webbplatsen.' : 'Only the owner can edit the website.'}</h1>
        <button type="button" onClick={() => navigate('/admin')}>{theme.lang === 'sv' ? 'Till admin' : 'Back to admin'}</button>
      </main>
    )
  }

  return (
    <>`)

  // Do not retire, hide, rename or redirect any existing tab during the parallel rollout.
  edit('src/admin/AdminShell.tsx', "import type { JSX } from 'preact'", "import { useLocation } from 'wouter-preact'\nimport type { JSX } from 'preact'")
  edit('src/admin/AdminShell.tsx', '  const { profile } = props', '  const [, navigate] = useLocation()\n  const { profile } = props')
  edit('src/admin/AdminShell.tsx', '{visibleTabs.map(navButton)}', `{isOwner ? <button type="button" disabled={navigationLocked} style={{ textAlign: 'left', border: 'none', borderRadius: '9px', padding: '9px 12px', fontFamily: 'inherit', fontSize: '14px', fontWeight: 500, background: 'transparent', color: c.text, opacity: navigationLocked ? 0.4 : 0.78, cursor: navigationLocked ? 'not-allowed' : 'pointer' }} onClick={() => {
          if (navigationLocked) return
          persistScroll(tab)
          scrollCaptureGeneration.current += 1
          setMobileMenuOpen(false)
          navigate('/admin/cms/')
        }}>{props.lang === 'sv' ? 'Redigering' : 'Editing'}</button> : null}\n        {visibleTabs.map(navButton)}`)
  console.log('Added owner Editing entry and authenticated studio route; every original admin tab, renderer and navigation contract is retained.')
}
