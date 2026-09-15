import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

export function integrate(root) {
  const ts = createRequire(resolve(root, 'package.json'))('typescript')
  function edit(path, before, after) {
    const file = resolve(root, path), source = readFileSync(file, 'utf8')
    if (!source.includes(before)) throw new Error(`Missing client routing anchor: ${path}: ${before}`)
    writeFileSync(file, source.replace(before, after))
  }
  edit('src/app/Root.tsx', "import { NotFound } from './NotFound'", "const CmsPublicPage = lazy(() => import('../cms/PublicPage'))")
  edit('src/app/Root.tsx', '? <App /> : <NotFound />', '? <App /> : <Suspense fallback={<AdminFallback />}><CmsPublicPage /></Suspense>')
  edit('src/app/Root.tsx', '          <NotFound />', '          <Suspense fallback={<AdminFallback />}><CmsPublicPage /></Suspense>')
  for (const name of ['DesktopSite', 'MobileSite']) {
    const path = resolve(root, `src/app/${name}.tsx`)
    const original = readFileSync(path, 'utf8')
    const tree = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const changes = []
    const region = key => `<CmsRegion name="${key}" lang={props.lang} mode={props.mode} />`
    const visit = node => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) && (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(tree) === 'AboutSection') {
        changes.push([node.getStart(tree), node.getStart(tree), `<>${region('home-after')}${region('about-before')}`])
        changes.push([node.end, node.end, `${region('about-after')}</>`])
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'HeroLinks') {
        changes.push([node.end, node.end, '\n<CmsPageMenu lang={props.lang} mode={props.mode} />'])
      }
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'h1' && name === 'MobileSite') {
        changes.push([node.getStart(tree), node.getStart(tree), region('home-before')])
      }
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'main' && name === 'DesktopSite') {
        changes.push([node.openingElement.end, node.openingElement.end, region('home-before')])
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    if (changes.length < 4) throw new Error(`Expected native page/section anchors in ${name}`)
    let source = original
    for (const [start, end, value] of changes.sort((a,b) => b[0] - a[0])) source = source.slice(0, start) + value + source.slice(end)
    writeFileSync(path, "import { CmsRegion, CmsPageMenu } from '../cms/Regions'\n" + source)
  }
}
