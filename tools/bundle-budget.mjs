// Budget for the JavaScript every public visit downloads before the app starts: the entry script of
// dist/index.html plus the chunks it modulepreloads, each gzipped at level 9. Run it after the build
// (`npm run build`); CI does. Usage: node tools/bundle-budget.mjs [dist] [budgetKb]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// Measured 109.3 kB gzip on 2026-10-24 with the tracked .env (Embla and zod off the entry). The
// budget keeps about 5 kB of room above that, so a small addition to the boot path does not fail
// CI; lower it when boot code leaves, css-tree being the next.
const BUDGET_KB = 115

const [dist = 'dist', budgetArg] = process.argv.slice(2)
const budgetKb = budgetArg === undefined ? BUDGET_KB : Number(budgetArg)

function fail(message) {
  console.error(`bundle-budget: ${message}`)
  process.exit(1)
}

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const srcOf = (tag) => /\bsrc="([^"]+)"/.exec(tag)?.[1]
const hrefOf = (tag) => /\bhref="([^"]+)"/.exec(tag)?.[1]
const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? []
const entries = tags
  .filter((tag) => tag.startsWith('<script') && tag.includes('type="module"'))
  .map(srcOf)
const preloads = tags
  .filter((tag) => tag.startsWith('<link') && tag.includes('rel="modulepreload"'))
  .map(hrefOf)
// Only files of this build count; an absolute URL is somebody else's script.
const local = (path) => path !== undefined && !/^[a-z][a-z0-9+.-]*:/i.test(path)
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
