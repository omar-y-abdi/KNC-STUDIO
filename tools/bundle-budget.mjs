// Budget for the JavaScript every public visit downloads before the app starts: the entry script of
// dist/index.html plus the chunks it modulepreloads, each gzipped at level 9. Run it after the build
// (`npm run build`); CI does. Usage: node tools/bundle-budget.mjs [dist] [budgetKb]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parse } from 'parse5'

// Measured 122.3 kB gzip in GitHub run 42119610488 with the approved hero animation and
// synchronous site layouts. The owner explicitly approved 123 kB when withdrawing the
// unrequested homepage loading screen. Keep the initial homepage directly renderable.
const BUDGET_KB = 123

const [dist = 'dist', budgetArg] = process.argv.slice(2)
const budgetKb = budgetArg === undefined ? BUDGET_KB : Number(budgetArg)

function fail(message) {
  console.error(`bundle-budget: ${message}`)
  process.exit(1)
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const entries = []
const preloads = []
const visit = (node) => {
  if (node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
    const attr = (name) => node.attrs.find((item) => item.name === name)?.value
    if (node.tagName === 'script' && attr('type')?.toLowerCase() === 'module')
      entries.push(attr('src'))
    if (
      node.tagName === 'link' &&
      (attr('rel') ?? '')
        .toLowerCase()
        .split(/[\t\n\f\r ]+/)
        .includes('modulepreload')
    )
      preloads.push(attr('href'))
  }
  for (const child of node.childNodes ?? []) visit(child)
}
visit(parse(html))
// Only files of this build count; an absolute URL is somebody else's script.
const local = (path) =>
  path !== undefined && !path.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(path)
if (!entries.some(local)) fail(`no entry script in ${join(dist, 'index.html')}`)

let bytes = 0
const files = [...entries, ...preloads].filter(local)
for (const path of files) {
  const file = join(dist, path)
  if (!existsSync(file)) fail(`${path} is referenced by index.html but missing from ${dist}`)
  bytes += gzipSync(readFileSync(file), { level: 9 }).length
}

const measured = bytes / 1000
console.log(
  `public boot JS: ${measured.toFixed(1)} kB gzip in ${files.length} files (budget ${budgetKb} kB)`,
)
if (measured > budgetKb) fail(`over budget by ${(measured - budgetKb).toFixed(1)} kB`)
