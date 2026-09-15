import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(process.argv[2])
const require = createRequire(resolve(root, 'package.json'))
const ts = require('typescript')
const read = path => readFileSync(resolve(root, path), 'utf8')
const write = (path, value) => { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), value) }
function replace(path, before, after) {
  const text = read(path)
  if (!text.includes(before)) throw new Error(`Missing integration anchor: ${path}: ${before.slice(0, 90)}`)
  write(path, text.replace(before, after))
}

// These are concrete compiler errors in the recovered sources, not relaxed compiler flags.
replace('shared/cms.ts', "constructor(readonly path: string, message: string) { super(`${path}: ${message}`); this.name = 'CmsValidationError' }", "readonly path: string\n  constructor(path: string, message: string) { super(`${path}: ${message}`); this.name = 'CmsValidationError'; this.path = path }")
replace('src/admin/cms/api.ts', "constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = 'CmsApiError' }", "readonly status: number\n  readonly code: string\n  constructor(message: string, status: number, code: string) { super(message); this.name = 'CmsApiError'; this.status = status; this.code = code }")
replace('src/admin/cms/Studio.tsx', "import { contentValue, setContent,", "import { setContent,")
replace('src/admin/cms/Studio.tsx', "document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key)", "window.document.addEventListener('keydown', key); return () => window.document.removeEventListener('keydown', key)")
replace('src/admin/cms/controls.tsx', 'hint?: string;', 'hint?: string | undefined;')

// Correct only accesses actually reported by TS4111; preserve all strictness settings.
const configPath = resolve(root, 'tsconfig.app.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(parsed.fileNames, parsed.options)
const edits = new Map()
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  if (diagnostic.code !== 4111 || !diagnostic.file || diagnostic.start === undefined) continue
  const file = diagnostic.file
  if (!file.fileName.startsWith(root + '/') || !/(?:\/shared\/cms|\/src\/(?:admin\/cms|cms)\/)/.test(file.fileName)) continue
  let access
  const visit = node => {
    if (ts.isPropertyAccessExpression(node) && diagnostic.start >= node.name.getStart(file) && diagnostic.start < node.name.end) access = node
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (!access) throw new Error(`Cannot locate reported property access in ${file.fileName}`)
  const start = access.expression.end, end = access.end
  const replacement = `${access.questionDotToken ? '?.' : ''}[${JSON.stringify(access.name.text)}]`
  const changes = edits.get(file.fileName) ?? new Map()
  changes.set(start, { start, end, replacement })
  edits.set(file.fileName, changes)
}
let count = 0
for (const [path, changes] of edits) {
  let text = readFileSync(path, 'utf8')
  for (const change of [...changes.values()].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, change.start) + change.replacement + text.slice(change.end)
    count++
  }
  writeFileSync(path, text)
}
console.log(`Corrected ${count} compiler-reported CMS property accesses without changing compiler options.`)
