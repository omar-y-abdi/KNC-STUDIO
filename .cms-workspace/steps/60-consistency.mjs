import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

export function integrate(root) {
  const ts = createRequire(resolve(root, 'package.json'))('typescript')
  const read = path => readFileSync(resolve(root, path), 'utf8')
  const write = (path, text) => writeFileSync(resolve(root, path), text)
  function replace(path, before, after) {
    const source = read(path)
    if (!source.includes(before)) throw new Error(`Missing consistency anchor: ${path}: ${before}`)
    write(path, source.replace(before, after))
  }
  for (const path of ['shared/cms.ts', 'src/admin/cms/draft.ts']) {
    write(path, read(path).replaceAll('^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$', '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  }
  replace('shared/cms.ts', "return /^\\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(path) && path.length <= 100", "return path.length <= 100 && path.startsWith('/') && path.slice(1).split(/[-/]/).every(part => /^[a-z0-9]+$/.test(part))")
  const markup = 'shared/cms-markup.ts'
  replace(markup, 'const decodeCss =', "const hasControlOrSpace = (value: string): boolean => [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\\\')\nconst decodeCss =")
  write(markup, read(markup).replaceAll('/[\\u0000-\\u0020\\u007f\\\\]/.test(value)', 'hasControlOrSpace(value)'))
  replace('src/cms/publicWorker.ts', "/^http:\\/\\/(?:127\\.0\\.0\\.1|localhost)(?::\\d+)?$/.test(origin)", "new URL(origin).protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)")
  replace('src/admin/cms/catalog.ts', 'ABOUT_KEYS, EMAIL_NAMES,', 'ABOUT_KEYS, type EMAIL_NAMES,')
  replace('tests/unit/cmsPublicationRoutes.test.ts', "value.pages[0]!.content.sv.html =", "const page = value.pages[0]\n    if (!page) throw new Error('Missing page fixture')\n    page.content.sv.html =")
  for (const name of readdirSync(resolve(root, 'src/admin/cms')).filter(name => /\.tsx?$/.test(name))) {
    const path = `src/admin/cms/${name}`, source = read(path)
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const edits = []
    const visit = node => {
      if (ts.isDeleteExpression(node) && ts.isElementAccessExpression(node.expression)) {
        const { expression, argumentExpression } = node.expression
        edits.push([node.getStart(tree), node.end, `Reflect.deleteProperty(${expression.getText(tree)}, ${argumentExpression.getText(tree)})`])
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    let result = source
    for (const [start, end, value] of edits.sort((a,b) => b[0] - a[0])) result = result.slice(0, start) + value + result.slice(end)
    if (edits.length) write(path, result)
  }
  const contract = 'tests/unit/cmsContract.test.ts'
  write(contract, read(contract).replaceAll('expect(shell).not.toContain(', 'expect(shell).toContain(').replace("'serveCmsPage'", "'cmsPublicResponse'"))
  replace('tests/unit/galleryMarqueeAccessibility.test.ts', "import { readFileSync }", "import { emptyPresentation } from '../../shared/cms'\nimport { readFileSync }")
  replace('tests/unit/galleryMarqueeAccessibility.test.ts', "vi.mock('preact/hooks', () => ({", "vi.mock('preact/hooks', () => ({\n  useContext: () => ({ presentation: emptyPresentation(), draft: null, revision: 0, lang: 'sv' }),")
}
