// Lazy-boundary gate (ADMIN_SPEC §4 + §7). Proves that the PUBLIC critical path ships NONE of the
// admin/auth code: the chunk(s) `index.html` eagerly loads must contain no admin-only tokens, and
// the admin code must live in a SEPARATE chunk that the entry only references via a dynamic import.
//
// What it checks against `dist/`:
//   1. index.html eagerly loads exactly the entry chunk(s) (script[type=module] + modulepreload).
//   2. Those eager chunk(s) contain ZERO admin-only tokens (login/admin UI + the admin storageKey).
//   3. Those eager chunk(s) contain NO STATIC import (`...from"./x.js"`) — everything is dynamic.
//   4. The admin tokens DO appear in some non-eager (lazy) chunk (so the feature actually shipped).
//
// Exit 0 = boundary intact; exit 1 = a regression (admin code leaked onto the public path).

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = process.env.DIST ?? './dist'
const ASSETS = join(DIST, 'assets')
const INDEX = join(DIST, 'index.html')

/** Tokens that must NEVER appear in an eagerly-loaded (public-path) chunk. */
const ADMIN_TOKENS = ['knc-admin-auth', 'Mina bokningar', 'Mitt schema', 'Logga in']

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

const indexHtml = readFileSync(INDEX, 'utf8')

// (1) The chunks index.html eagerly fetches: the entry <script type=module src> + any modulepreload.
const eager = new Set()
for (const m of indexHtml.matchAll(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+)"/g)) {
  eager.add(m[1])
}
for (const m of indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+)"/g)) {
  eager.add(m[1])
}
if (eager.size === 0) fail('No eager module script found in index.html')
console.log(`Eagerly-loaded chunk(s): ${[...eager].join(', ')}`)

// (2) + (3) Each eager chunk must be admin-token-free AND have no static local imports.
for (const file of eager) {
  const code = readFileSync(join(ASSETS, file), 'utf8')
  for (const token of ADMIN_TOKENS) {
    if (code.includes(token)) {
      fail(`Eager chunk ${file} contains admin token ${JSON.stringify(token)} — admin code leaked onto the public path.`)
    }
  }
  const staticImports = code.match(/from"\.\/[A-Za-z0-9_-]+\.js"/g) ?? []
  if (staticImports.length > 0) {
    fail(`Eager chunk ${file} has ${staticImports.length} STATIC import(s) ${JSON.stringify(staticImports)} — must be dynamic so nothing eager-loads admin/supabase.`)
  }
}
console.log('Eager chunk(s) are admin-token-free and have no static local imports.')

// (4) The admin tokens must exist in SOME non-eager (lazy) chunk — proof the feature shipped lazily.
const allChunks = readdirSync(ASSETS).filter((f) => f.endsWith('.js'))
const lazyChunks = allChunks.filter((f) => !eager.has(f))
const tokenFound = new Map(ADMIN_TOKENS.map((t) => [t, false]))
for (const file of lazyChunks) {
  const code = readFileSync(join(ASSETS, file), 'utf8')
  for (const token of ADMIN_TOKENS) {
    if (code.includes(token)) tokenFound.set(token, true)
  }
}
const missing = [...tokenFound.entries()].filter(([, found]) => !found).map(([t]) => t)
if (missing.length > 0) {
  fail(`Admin tokens not found in any lazy chunk: ${JSON.stringify(missing)} — did the admin bundle build?`)
}
console.log('All admin tokens present in lazy chunk(s) only.')

console.log('\nPASS: admin code is a separate lazy chunk; the public path ships none of it.')
