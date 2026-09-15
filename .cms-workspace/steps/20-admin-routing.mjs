import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

export function integrate(root) {
  const ts = createRequire(resolve(root, 'package.json'))('typescript')
  const edit = (path, before, after) => {
    const file = resolve(root, path), source = readFileSync(file, 'utf8')
    if (!source.includes(before)) throw new Error(`Missing routing anchor: ${path}: ${before.slice(0, 80)}`)
    writeFileSync(file, source.replace(before, after))
  }
  edit('src/admin/AdminApp.tsx', "const AdminShell = lazy", "const CmsStudio = lazy(() => import('./cms/Studio').then(module => ({ default: module.CmsStudio })))\nconst CmsPreview = lazy(() => import('./cms/Preview').then(module => ({ default: module.CmsPreview })))\n\nconst AdminShell = lazy")
  edit('src/admin/AdminApp.tsx', 'const [, navigate] = useLocation()', 'const [pathname, navigate] = useLocation()')
  edit('src/admin/AdminApp.tsx', '\n  return (\n    <>', `
  // Use the exact same session and forced-password gate as the operational panel.
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

  const path = resolve(root, 'src/admin/AdminShell.tsx')
  let source = readFileSync(path, 'utf8')
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const retired = new Set(['site', 'about', 'mail', 'barbers'])
  const removedComponents = new Set(['SiteView', 'AboutView', 'MailView', 'BarbersView'])
  const changes = []
  const visit = node => {
    if (ts.isVariableStatement(node) && removedComponents.has(node.declarationList.declarations[0]?.name.getText(tree))) changes.push([node.getFullStart(), node.end, ''])
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'Tab') changes.push([node.type.getStart(tree), node.type.end, node.type.types.filter(type => !retired.has(type.literal?.text)).map(type => type.getText(tree)).join(' | ')])
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'TABS') {
      const entries = node.initializer.elements.filter(entry => !entry.properties.some(property => property.name?.getText(tree) === 'id' && retired.has(property.initializer?.text)))
      changes.push([node.initializer.getStart(tree), node.initializer.end, `[\n${entries.map(entry => entry.getText(tree)).join(',\n')}\n]`])
    }
    if (ts.isCaseClause(node) && retired.has(node.expression.text)) changes.push([node.getFullStart(), node.end, ''])
    ts.forEachChild(node, visit)
  }
  visit(tree)
  for (const [start, end, value] of changes.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + value + source.slice(end)
  source = "import { useLocation } from 'wouter-preact'\n" + source
  source = source.replace('  const { profile } = props', '  const [, navigate] = useLocation()\n  const { profile } = props')
  const filter = 'TABS.filter((tab) => isOwner || !tab.ownerOnly)'
  if (!source.includes(filter)) throw new Error('Missing original role-specific tab filter')
  source = source.replace(filter, "TABS.filter((tab) => (isOwner || !tab.ownerOnly) && (!isOwner || tab.id !== 'profile'))")
  const navigation = '{visibleTabs.map('
  if (!source.includes(navigation)) throw new Error('Missing original navigation renderer')
  source = source.replace(navigation, `{isOwner ? <button type="button" disabled={navigationLocked} style={s.navItemStyle(false)} onClick={() => {
          if (navigationLocked) return
          persistScroll(tab)
          scrollCaptureGeneration.current += 1
          navigate('/admin/cms/')
        }}>{props.lang === 'sv' ? 'Redigering' : 'Editing'}</button> : null}\n        {visibleTabs.map(`)
  writeFileSync(path, source)
  console.log('Owner editing route uses the existing session gate; schedule, bookings, services and settings implementations are unchanged.')
}
