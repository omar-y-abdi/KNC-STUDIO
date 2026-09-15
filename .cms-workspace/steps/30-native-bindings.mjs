import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname, basename } from 'node:path'
import { createRequire } from 'node:module'

export function integrate(root) {
  const ts = createRequire(resolve(root, 'package.json'))('typescript')
  const read = path => readFileSync(resolve(root, path), 'utf8')
  const write = (path, source) => writeFileSync(resolve(root, path), source)
  function replace(path, before, after) {
    const source = read(path)
    if (!source.includes(before)) throw new Error(`Missing native integration anchor: ${path}: ${before.slice(0, 80)}`)
    write(path, source.replace(before, after))
  }
  replace('src/cms/context.tsx', 'export function useCmsPalette<T extends object>(base: T, mode: CmsMode): T {\n  const theme = useCms().presentation.themes[mode]', 'export function mergeCmsPalette<T extends object>(presentation: CmsPresentation, base: T, mode: CmsMode): T {\n  const theme = presentation.themes[mode]')
  write('src/cms/context.tsx', read('src/cms/context.tsx') + '\nexport function useCmsPalette<T extends object>(base: T, mode: CmsMode): T {\n  return mergeCmsPalette(useCms().presentation, base, mode)\n}\n')
  write('src/app/Root.tsx', "import { CmsPublicProvider } from '../cms/context'\n" + read('src/app/Root.tsx'))
  replace('src/app/Root.tsx', '<>\n      <Switch>', '<CmsPublicProvider>\n      <Switch>')
  replace('src/app/Root.tsx', '</Switch>\n    </>', '</Switch>\n    </CmsPublicProvider>')
  write('src/app/App.tsx', "import { CmsLocaleProvider, useCmsTheme } from '../cms/context'\n" + read('src/app/App.tsx'))
  replace('src/app/App.tsx', "const dark = state.mode === 'dark'", "const dark = state.mode === 'dark'\n  useCmsTheme(state.mode)")
  {
    const path = 'src/app/App.tsx', source = read(path), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), changes = []
    const app = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App')
    const visit = node => {
      if (node !== app && ts.isFunctionLike(node)) return
      if (ts.isJsxFragment(node) && ts.isReturnStatement(node.parent?.parent)) {
        changes.push([node.openingFragment.getStart(tree), node.openingFragment.end, '<CmsLocaleProvider lang={lang}>'])
        changes.push([node.closingFragment.getStart(tree), node.closingFragment.end, '</CmsLocaleProvider>'])
      }
      ts.forEachChild(node, visit)
    }
    visit(app)
    if (changes.length !== 4) throw new Error(`Expected the two original App return fragments, got ${changes.length / 2}`)
    let result = source
    for (const [start, end, value] of changes.sort((a,b) => b[0] - a[0])) result = result.slice(0,start) + value + result.slice(end)
    write(path, result)
  }
  replace('src/admin/cms/Preview.tsx', 'CmsDraftProvider, useCmsStrings, useCmsTheme', 'CmsDraftProvider, useCmsStrings, useCmsTheme, useCmsPalette')
  replace('src/admin/cms/Preview.tsx', "const dark = mode === 'dark', c = shellPalette(dark)", "const dark = mode === 'dark', c = useCmsPalette(shellPalette(dark), mode)")
  replace('src/admin/cms/Preview.tsx', '  const scrollRootRef = useRef<HTMLDivElement>(null)\n', '')
  replace('src/admin/cms/Preview.tsx', ' scrollRootRef={scrollRootRef}', '')
  replace('src/admin/cms/Preview.tsx', '<CmsDraftProvider document={snapshot.document}>', '<CmsDraftProvider document={snapshot.document} lang={snapshot.lang}>')
  replace('shared/cms.ts', '@media(max-width:767px)', '@media(max-width:768px)')
  replace('shared/cms.ts', '@media(min-width:768px)', '@media(min-width:769px)')

  const groups = { appStrings: 'app', bookingStrings: 'booking', aboutStrings: 'about', myBookingsStrings: 'myBookings', privacyStrings: 'privacy', calendarStrings: 'calendar', customerEmailLinkStrings: 'customerEmailLink' }
  const siteKeys = new Set(['kicker','hours','yourDetails','summary','fBarber','fWhen','fService','fTotal','name','namePh','phone','phonePh','policy','bookedTitle','confirmSent','addToCal'])
  const aboutKeys = new Set(['eyebrow','heading','intro','galleryTitle','cutsTitle','stylistsTitle','reviewsTitle'])
  const tags = new Set(['main','section','div','p','span','h1','h2','h3','h4','h5','h6','header','footer','nav','aside','a','button','label','input','textarea','select','ul','ol','li','dl','dt','dd','figure','figcaption','img','svg'])
  const files = []
  const walk = path => { for (const entry of readdirSync(resolve(root,path), { withFileTypes: true })) { const next = `${path}/${entry.name}`; if (entry.isDirectory()) walk(next); else if (next.endsWith('.tsx')) files.push(next) } }
  for (const directory of ['src/app', 'src/about', 'src/booking', 'src/mybookings', 'src/site']) walk(directory)
  const inventory = []
  for (const path of files) {
    if (/\/(?:Root|NotFound|Turnstile)\.tsx$/.test(path)) continue
    const source = read(path), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const changes = [], imports = new Set(), componentScopes = new Set()
    let ordinal = 0
    const defaultGroup = path.includes('/about/') ? 'about' : path.includes('/booking/') ? 'booking' : path.includes('/mybookings/') ? 'myBookings' : /Privacy/.test(path) ? 'privacy' : 'app'
    const componentOf = node => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isFunctionDeclaration(parent) && /^(?:[A-Z]|use[A-Z])/.test(parent.name?.text ?? '') && parent.body) return parent
        if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isVariableDeclaration(parent.parent) && /^[A-Z]/.test(parent.parent.name.getText(tree)) && ts.isBlock(parent.body)) return parent
      }
      return null
    }
    const mapKeys = node => {
      const result = []
      for (let parent = node; parent; parent = parent.parent) {
        const opening = ts.isJsxElement(parent) ? parent.openingElement : ts.isJsxSelfClosingElement(parent) ? parent : null
        const key = opening?.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'key')
        if (key?.initializer && ts.isJsxExpression(key.initializer) && key.initializer.expression) result.unshift(key.initializer.expression.getText(tree))
        if (parent === componentOf(node)) break
      }
      return [...new Set(result)]
    }
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const group = groups[node.expression.text], component = componentOf(node)
        if (group && component && node.arguments.length === 1) {
          imports.add('useCms'); imports.add('mergeCmsStrings'); componentScopes.add(component)
          changes.push([node.getStart(tree), node.end, `mergeCmsStrings(_cmsPresentation, '${group}', ${node.arguments[0].getText(tree)}, ${node.getText(tree)})`])
          inventory.push({ path, group, call: node.getText(tree) })
          return
        }
        if (['palette', 'shellPalette'].includes(node.expression.text) && component && node.arguments.length === 1) {
          imports.add('useCms'); imports.add('mergeCmsPalette'); componentScopes.add(component)
          changes.push([node.getStart(tree), node.end, `mergeCmsPalette(_cmsPresentation, ${node.getText(tree)}, ${node.arguments[0].getText(tree)} ? 'dark' : 'light')`])
          return
        }
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tags.has(node.tagName.getText(tree))) {
        const tag = node.tagName.getText(tree), element = ts.isJsxOpeningElement(node) ? node.parent : node
        const attrs = node.attributes.properties
        if (!attrs.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'data-cms-node')) {
          ordinal += 1
          const template = `${basename(path, '.tsx').toLowerCase()}-${tag}-${ordinal}`
          const keys = mapKeys(element)
          const id = keys.length ? `{cmsNodeId('${template}', ${keys.join(', ')})}` : JSON.stringify(template)
          if (keys.length) imports.add('cmsNodeId')
          let binding = null
          const expressions = ts.isJsxElement(element) ? element.children.filter(child => ts.isJsxExpression(child) && child.expression).map(child => child.expression.getText(tree)) : []
          const textual = ts.isJsxElement(element) && element.children.every(child => ts.isJsxExpression(child) || ts.isJsxText(child) && /^[\s@]*$/.test(child.text))
          const bound = textual && expressions.length === 1 ? expressions[0] : null
          const property = bound?.match(/^(tx|t|text|base|props\.tx)\.([A-Za-z][A-Za-z0-9]*)$/)
          if (property) {
            const key = property[2]
            const group = defaultGroup
            binding = JSON.stringify(group === 'about' && aboutKeys.has(key) ? `about:${key}` : ['app','booking'].includes(group) && siteKeys.has(key) ? `site:${key}` : `copy:${group}:${key}`)
          }
          if (!binding) {
            for (const name of ['placeholder', 'aria-label', 'alt']) {
              const attr = attrs.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === name)
              const match = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression?.getText(tree).match(/^(tx|t)\.([A-Za-z][A-Za-z0-9]*)$/) : null
              if (match) { const key = match[2]; binding = JSON.stringify(defaultGroup === 'about' && aboutKeys.has(key) ? `about:${key}` : ['app','booking'].includes(defaultGroup) && siteKeys.has(key) ? `site:${key}` : `copy:${defaultGroup}:${key}`); break }
            }
          }
          if (keys.some(key => /\bb\.id\b/.test(key))) {
            if (bound === 'b.name' || bound === 'b.ig') binding = '{`barber:${b.id}:' + bound.slice(2) + '`}'
            if (path.endsWith('/AboutSection.tsx') && (bound === 'copy.bio' || bound === 'copy.role')) binding = '{`barber:${b.id}:' + bound.slice(5) + '_${lang}`}'
          }
          changes.push([node.tagName.end, node.tagName.end, ` data-cms-node=${id}${binding ? ` data-cms-copy=${binding}` : ''}`])
          if (tag === 'img') { imports.add('CmsImage'); changes.push([node.tagName.getStart(tree), node.tagName.end, 'CmsImage']) }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    for (const component of componentScopes) changes.push([component.body.getStart(tree) + 1, component.body.getStart(tree) + 1, '\n  const _cmsPresentation = useCms().presentation\n'])
    if (changes.length === 0) continue
    let result = source
    for (const [start,end,value] of changes.sort((a,b) => b[0] - a[0] || b[1] - a[1])) result = result.slice(0,start) + value + result.slice(end)
    const contextImports = [...imports].filter(name => name !== 'cmsNodeId')
    const specifier = target => { const value = relative(dirname(resolve(root,path)), resolve(root,target)).replaceAll('\\','/'); return value.startsWith('.') ? value : './' + value }
    if (contextImports.length) result = `import { ${contextImports.join(', ')} } from '${specifier('src/cms/context')}'\n` + result
    if (imports.has('cmsNodeId')) result = `import { cmsNodeId } from '${specifier('src/cms/nodeIdentity')}'\n` + result
    write(path,result)
  }
  write('src/about/AboutSection.tsx', "import { useCmsStrings } from '../cms/context'\n" + read('src/about/AboutSection.tsx'))
  replace('src/about/AboutSection.tsx', 'const tx: AboutStrings = mergeAbout(base, overlay)', "const tx: AboutStrings = useCmsStrings('about', lang, mergeAbout(base, overlay))")
  console.log('Native text sources connected:', JSON.stringify(inventory))
  console.log('Native JSX bindings are explicit in the delivered source; no runtime DOM replacement is used.')
}
