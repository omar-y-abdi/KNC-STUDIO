// Rebuilds tools/e2e/fixtures/presentation.json.gz from the public CMS presentation: the committed,
// sanitised copy that browser tests use instead of production data. Refresh it after the owner
// publishes (npm has no script for this on purpose; it is a deliberate, read-only GET):
//
//   node tools/e2e/fixtures/refresh-presentation.mjs
//
// Sanitising keeps the public site copy and removes everything that points at production:
//  - every https://<project>.supabase.co origin becomes https://admin-harness.invalid, the fake
//    Supabase origin of the harness builds, so /storage/v1/object/public/<bucket>/<path> keeps its
//    shape and tests serve a placeholder image for it with a route;
//  - every email address outside a reserved example domain becomes contact-N@example.se.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

export const SOURCE_URL = 'https://bladeblendstudio.se/api/cms/presentation'
export const FIXTURE_PATH = fileURLToPath(new URL('./presentation.json.gz', import.meta.url))
export const HARNESS_ORIGIN = 'https://admin-harness.invalid'

const REQUEST_TIMEOUT_MS = 30_000
const SUPABASE_ORIGIN = /https:\/\/[a-z0-9-]+\.supabase\.co/gi
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// RFC 2606 / 6761 reserved names, plus example.se which the fixture itself uses.
const RESERVED_DOMAIN = /(^|\.)(example\.(com|org|net|se)|test|invalid|example|localhost)$/i

function domainOf(address) {
  return address.slice(address.lastIndexOf('@') + 1)
}

function mapStrings(value, transform) {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, transform))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform)]),
    )
  return value
}

function assertResponseShape(response) {
  const shaped =
    response !== null &&
    typeof response === 'object' &&
    Number.isInteger(response.revision) &&
    response.presentation !== null &&
    typeof response.presentation === 'object'
  if (!shaped)
    throw new Error('Unexpected presentation response: expected { revision, presentation }')
}

/** Every reference that must not survive sanitising, found in the serialised document. */
function leftovers(text) {
  const supabase = text.match(/supabase\.co/gi) ?? []
  const emails = (text.match(EMAIL) ?? []).filter(
    (address) => !RESERVED_DOMAIN.test(domainOf(address)),
  )
  return [...supabase, ...emails]
}

/**
 * Pure: `{ revision, presentation }` as served publicly -> the same document without production
 * references, plus what was replaced. Throws when anything production-shaped survives.
 */
export function sanitisePresentation(response) {
  assertResponseShape(response)
  const stats = { supabaseOrigins: 0, emails: 0 }
  const contacts = new Map()
  const rewriteEmail = (address) => {
    if (RESERVED_DOMAIN.test(domainOf(address))) return address
    stats.emails++
    const key = address.toLowerCase()
    if (!contacts.has(key)) contacts.set(key, `contact-${contacts.size + 1}@example.se`)
    return contacts.get(key)
  }
  const sanitised = mapStrings(response, (text) =>
    text
      .replace(SUPABASE_ORIGIN, () => {
        stats.supabaseOrigins++
        return HARNESS_ORIGIN
      })
      .replace(EMAIL, rewriteEmail),
  )
  const remaining = leftovers(JSON.stringify(sanitised))
  if (remaining.length > 0)
    throw new Error(
      `Sanitised presentation still references production: ${remaining.length} item(s)`,
    )
  return { response: sanitised, stats }
}

/** Deterministic gzip of the compact JSON, so an unchanged presentation yields identical bytes. */
export function gzipFixture(response) {
  return gzipSync(Buffer.from(JSON.stringify(response)), { level: 9 })
}

async function fetchPresentation(source, fetchImpl) {
  const response = await fetchImpl(source, {
    headers: { accept: 'application/json' },
    signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GET ${source} failed: HTTP ${response.status}`)
  return response.json()
}

/** Effects at the edge: one GET, sanitise, write. Returns what was written. */
export async function refreshPresentation({
  source = SOURCE_URL,
  out = FIXTURE_PATH,
  fetchImpl = fetch,
} = {}) {
  const { response, stats } = sanitisePresentation(await fetchPresentation(source, fetchImpl))
  const bytes = gzipFixture(response)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, bytes)
  return { out, revision: response.revision, gzipBytes: bytes.length, ...stats }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { source: { type: 'string' }, out: { type: 'string' } },
  })
  const result = await refreshPresentation({
    ...(values.source === undefined ? {} : { source: values.source }),
    ...(values.out === undefined ? {} : { out: values.out }),
  })
  console.log(
    `Wrote ${result.out}: revision ${result.revision}, ${result.gzipBytes} bytes gzipped, ` +
      `${result.supabaseOrigins} Supabase origins and ${result.emails} emails replaced`,
  )
}
