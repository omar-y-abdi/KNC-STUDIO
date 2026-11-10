// smoke-live.mjs — live, non-browser smoke test for the Blade & Blend Studio backend and the
// deployed site.
//
// Hits the LIVE Supabase project with the PUBLIC anon key only (never a service_role
// key), and the site's own /api/bookings relay for booking submission. Verifies public entry
// points the booking UI depends on:
//
//   1. public catalog + available_slots — discovers current database IDs and returns bookable slots.
//   2. /api/bookings (400)   — the Worker relay to submit-booking rejects a malformed body with HTTP 400.
//   3. /api/bookings email   — malformed email is rejected before the bot check.
//   4. /api/bookings gate    — an empty Turnstile token is rejected (failed_challenge),
//                              proving the bot gate is active in production.
//   5. public action gateway — rejects an empty Turnstile token (failed_challenge).
//   6. lookup_booking RPC    — the direct lookup function does not exist (HTTP 404); booking
//                              lookup goes through the gateway only.
//
// Then reads the deployed site itself. These checks send GET only and follow no redirect:
//
//   7. /, /booking, /contact, /privacy, /terms — HTTP 200 with content-type text/html.
//   8. an unknown path       — HTTP 404, never a successful page.
//   9. /robots.txt, /sitemap.xml, /llms.txt — HTTP 200 with a content-type other than text/html:
//                              an HTML page answering in a file's place is not the file.
//  10. www host              — permanent redirect (301 or 308) to the apex host.
//  11. homepage entry script — the homepage HTML names a module script under /assets/ and that
//                              URL answers HTTP 200 with a content-type other than text/html.
//
// Each check logs PASS/FAIL with the key value it observed. Process exits 1 if ANY
// check fails, 0 only when every check passes (so CI can gate on it).
//
// Every request has a 10-second limit and the whole run a 6-minute budget, so a backend that
// hangs FAILs its checks and the run still ends with a verdict.
//
// No dependencies — uses the global `fetch` (Node 20+). No browser.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon-jwt> \
//   SITE_ORIGIN=https://bladeblendstudio.se \
//   node tools/smoke-live.mjs

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SITE_ORIGIN = process.env.SITE_ORIGIN

// True for `node tools/smoke-live.mjs`. tests/unit/smokeLive.test.ts imports this file for the
// pure page-check functions; an import needs no configuration, never exits and never reaches the
// network. Node resolves symlinks for the entry module's URL, so the started path is resolved the
// same way: a mismatch would skip every check and still exit 0. A process started without a path,
// or with one that names no file, did not start this file.
function startedModuleUrl() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return null
  }
}

const runDirectly = import.meta.url === startedModuleUrl()

if (runDirectly && (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SITE_ORIGIN)) {
  console.error('FATAL: SUPABASE_URL, SUPABASE_ANON_KEY, and SITE_ORIGIN are required.')
  process.exit(1)
}

// Configuration exists for a direct run only; nothing reads these two on an import.
const baseUrl = runDirectly ? SUPABASE_URL.replace(/\/+$/, '') : undefined // tolerate a trailing slash
const siteOrigin = runDirectly ? new URL(SITE_ORIGIN).origin : undefined

// A future date computed at run time. The smoke probes several dates because production schedules
// and service weekdays are owner-managed database state; no weekday or barber is assumed here.
function futureDateIso(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Anon-only headers. PostgREST and the Functions gateway both want the apikey; the
// Bearer is the same public anon JWT (no user session involved).
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
}

const REQUEST_TIMEOUT_MS = 10_000
const RUN_BUDGET_MS = 6 * 60_000

/**
 * The time limit of a request that starts `elapsedMs` into the run: the per-request limit, or what
 * is left of the run's budget when that is less. Null once the budget is used up.
 * @param {number} elapsedMs
 * @returns {number | null}
 */
export function requestTimeLimit(elapsedMs) {
  const left = RUN_BUDGET_MS - elapsedMs
  return left > 0 ? Math.min(REQUEST_TIMEOUT_MS, left) : null
}

const runStartedAt = Date.now()

// The clock edge of every request. The limit covers the response body too. Once the budget is used
// up this throws instead of sending, so each remaining check FAILs at once and the run still
// prints its verdict.
function requestSignal() {
  const limit = requestTimeLimit(Date.now() - runStartedAt)
  if (limit === null)
    throw new Error(
      `the run's time budget of ${RUN_BUDGET_MS / 1000} s is used up; request not sent`,
    )
  return globalThis.AbortSignal.timeout(limit)
}

// POST a JSON body and return { status, json, text }. `json` is undefined when the
// response body is not valid JSON (so a check can distinguish "bad JSON" from null).
async function postJson(path, body, { url = baseUrl, requestHeaders = headers } = {}) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
    signal: requestSignal(),
  })
  const text = await res.text()
  let json
  try {
    json = text.length > 0 ? JSON.parse(text) : null
  } catch {
    json = undefined
  }
  return { status: res.status, json, text }
}

// Bookings go through the Worker relay, which signs them for submit-booking; the browser never
// reaches submit-booking directly. The relay requires its own origin and a JSON content type.
function postBooking(body) {
  return postJson('/api/bookings', body, {
    url: siteOrigin,
    requestHeaders: { Origin: siteOrigin, 'Content-Type': 'application/json' },
  })
}

let catalogPromise

async function smokeCatalog() {
  catalogPromise ??= (async () => {
    const { status, json } = await postJson('/rest/v1/rpc/public_booking_catalog', {})
    const barbers = json !== null && typeof json === 'object' ? json.barbers : null
    const services = json !== null && typeof json === 'object' ? json.services : null
    if (status !== 200 || !Array.isArray(barbers) || !Array.isArray(services)) {
      throw new Error(`public catalog unavailable: status=${status} body=${JSON.stringify(json)}`)
    }
    const activeIds = new Set(
      barbers
        .map((barber) => (barber !== null && typeof barber === 'object' ? barber.id : null))
        .filter((id) => typeof id === 'string' && id.length > 0),
    )
    const candidates = services
      .filter(
        (row) =>
          row !== null &&
          typeof row === 'object' &&
          typeof row.id === 'string' &&
          typeof row.barber_id === 'string' &&
          activeIds.has(row.barber_id) &&
          Number.isInteger(row.duration_min) &&
          row.duration_min > 0,
      )
      .map((service) => ({
        barberId: service.barber_id,
        serviceId: service.id,
        durationMin: service.duration_min,
      }))
    if (candidates.length === 0) {
      throw new Error('public catalog has no active barber/service pair')
    }
    return candidates
  })()
  return catalogPromise
}

// --- Checks: each returns { pass: boolean, detail: string } -----------------------

// 1. available_slots — expect HTTP 200 + a non-empty array of "HH:MM" strings.
async function checkAvailableSlots() {
  const candidates = await smokeCatalog()
  let last = { barberId: candidates[0].barberId, status: 0, json: null, date: futureDateIso(3) }
  for (const catalog of candidates) {
    for (let offset = 3; offset < 24; offset += 1) {
      const date = futureDateIso(offset)
      const { status, json } = await postJson('/rest/v1/rpc/available_slots', {
        p_barber_id: catalog.barberId,
        p_date: date,
        p_duration_min: catalog.durationMin,
      })
      last = { barberId: catalog.barberId, status, json, date }
      const allHHMM =
        Array.isArray(json) &&
        json.length > 0 &&
        json.every((slot) => typeof slot === 'string' && /^\d{2}:\d{2}$/.test(slot))
      if (status === 200 && allHHMM) {
        return {
          pass: true,
          detail: `barber=${catalog.barberId} date=${date} slots=${JSON.stringify(json)}`,
        }
      }
    }
  }
  return {
    pass: false,
    detail: `barber=${last.barberId} last_date=${last.date} status=${last.status} slots=${JSON.stringify(last.json)}`,
  }
}

// 2. /api/bookings with an empty body — expect HTTP 400 (true client fault).
async function checkSubmitBookingInvalid() {
  const { status, json } = await postBooking({})
  const pass = status === 400
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

// 3. Malformed email is rejected before Turnstile verification.
async function checkSubmitBookingInvalidEmail() {
  const [catalog] = await smokeCatalog()
  const { status, json } = await postBooking({
    booking: {
      barberId: catalog.barberId,
      serviceId: catalog.serviceId,
      startAt: `${futureDateIso(3)}T10:00:00+02:00`,
      phone: '0701234567',
      email: 'invalid',
      lang: 'sv',
      customerName: 'Smoke Test',
    },
    turnstileToken: '',
  })
  const pass =
    status === 400 &&
    json !== null &&
    typeof json === 'object' &&
    json.ok === false &&
    json.error === 'invalid_payload'
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

// 4. /api/bookings with a valid body but empty Turnstile token — expect HTTP 200 +
//    { ok:false, error:"failed_challenge" }. This proves Turnstile is active and fail-closed.
async function checkSubmitBookingTurnstileGate() {
  const [catalog] = await smokeCatalog()
  const { status, json } = await postBooking({
    booking: {
      barberId: catalog.barberId,
      serviceId: catalog.serviceId,
      // The Turnstile gate rejects before create_booking ever parses this, so a fixed +02:00
      // offset is fine year-round — the gateway's shape check only needs a non-empty string.
      startAt: `${futureDateIso(3)}T10:00:00+02:00`,
      phone: '0701234567',
      email: 'smoke@example.com',
      lang: 'sv',
      customerName: 'Smoke Test',
    },
    turnstileToken: '',
  })
  const pass =
    status === 200 &&
    json !== null &&
    typeof json === 'object' &&
    json.ok === false &&
    json.error === 'failed_challenge'
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

// 5. Secure-link requests are reachable only through the fail-closed Turnstile gateway.
async function checkPublicActionGateway() {
  const { status, json } = await postJson('/functions/v1/public-booking-actions', {
    action: 'request_access',
    email: 'smoke@example.com',
    lang: 'sv',
    turnstileToken: '',
  })
  const pass =
    status === 200 &&
    json !== null &&
    typeof json === 'object' &&
    json.ok === false &&
    json.error === 'failed_challenge'
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

// 6. Booking lookup goes through the gateway only: the direct function must not exist.
async function checkDirectLookupContract() {
  const { status, json } = await postJson('/rest/v1/rpc/lookup_booking', {
    p_contact: '0700000000',
  })
  const pass = status === 404
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

// --- Deployed site: read-only page checks -----------------------------------------------------
//
// Pure functions decide what to request and whether an answer passes. `getPage` is the only
// place these checks reach the network. Exported for tests/unit/smokeLive.test.ts.

/**
 * What a response must look like. `html` is a page: 200 with content-type text/html. `file` is
 * anything else that is served: 200 with any other content-type.
 * @typedef {{ kind: 'html' }
 *   | { kind: 'file' }
 *   | { kind: 'status', status: number }
 *   | { kind: 'redirect', origin: string }} PageExpectation
 */
/** @typedef {{ name: string, url: string, expect: PageExpectation }} PageCheck */
/**
 * A response body: read, or the reason it could not be read after the headers had arrived.
 * @typedef {{ kind: 'read', text: string } | { kind: 'unread', reason: string }} PageBody
 */
/**
 * The parts of a response the checks read. A header that was not sent is null. Only the entry
 * script lookup needs the body; every other check passes or fails on the status and headers.
 * @typedef {{
 *   status: number,
 *   contentType: string | null,
 *   location: string | null,
 *   cfMitigated: string | null,
 *   body: PageBody,
 * }} PageResponse
 */
/**
 * What arrives with the response headers; `text` reads the body.
 * @typedef {Omit<PageResponse, 'body'> & { text: () => Promise<string> }} PageHead
 */
/**
 * What one GET produced: a response (`retriedAfter` holds the first attempt's failure when a second
 * attempt was needed), or no response in either attempt.
 * @typedef {{ kind: 'response', response: PageResponse, retriedAfter: string | null }
 *   | { kind: 'unreachable', reasons: [string, string] }} PageOutcome
 */
/** @typedef {(url: string) => Promise<PageOutcome>} GetPage */
/** @typedef {{ pass: boolean, detail: string }} Verdict */

const HTML_PAGES = ['/', '/booking', '/contact', '/privacy', '/terms']
const PUBLIC_FILES = ['/robots.txt', '/sitemap.xml', '/llms.txt']
// Not a page, a file, a private route or a customer link (those are 64 hex characters).
const MISSING_PATH = '/live-smoke-no-such-page'
const PERMANENT_REDIRECTS = [301, 308]
const HOMEPAGE_SCRIPT_CHECK = 'homepage module script under /assets/ (200, not text/html)'

/**
 * The checks that are one GET each.
 * @param {string} siteOrigin
 * @returns {PageCheck[]}
 */
export function pageChecks(siteOrigin) {
  const site = new URL(siteOrigin)
  const at = (path) => new URL(path, site).href
  return [
    ...HTML_PAGES.map((path) => ({
      name: `page ${path} (200 text/html)`,
      url: at(path),
      expect: { kind: 'html' },
    })),
    {
      name: `unknown path ${MISSING_PATH} (404)`,
      url: at(MISSING_PATH),
      expect: { kind: 'status', status: 404 },
    },
    ...PUBLIC_FILES.map((path) => ({
      name: `file ${path} (200, not text/html)`,
      url: at(path),
      expect: { kind: 'file' },
    })),
    {
      name: 'www host (permanent redirect to the apex host)',
      url: `${site.protocol}//www.${site.host}/`,
      expect: { kind: 'redirect', origin: site.origin },
    },
  ]
}

const mediaType = (contentType) => (contentType ?? '').split(';')[0].trim().toLowerCase()

// The origin a Location header points at, resolved against the URL that answered.
function locationOrigin(location, requestUrl) {
  return location !== null && URL.canParse(location, requestUrl)
    ? new URL(location, requestUrl).origin
    : null
}

// Whether a response meets a check, and the requirement in words for the failure line.
function requirement(check, response) {
  const { expect } = check
  if (expect.kind === 'html')
    return {
      met: response.status === 200 && mediaType(response.contentType) === 'text/html',
      wanted: 'status 200 with content-type text/html',
    }
  if (expect.kind === 'file')
    return {
      met: response.status === 200 && mediaType(response.contentType) !== 'text/html',
      wanted: 'status 200 with a content-type other than text/html',
    }
  if (expect.kind === 'status')
    return { met: response.status === expect.status, wanted: `status ${expect.status}` }
  return {
    met:
      PERMANENT_REDIRECTS.includes(response.status) &&
      locationOrigin(response.location, check.url) === expect.origin,
    wanted: `status ${PERMANENT_REDIRECTS.join(' or ')} with a Location on ${expect.origin}`,
  }
}

/**
 * The PASS/FAIL line of one check. It always carries the URL and the status, and on a failure
 * what was required.
 * @param {Pick<PageCheck, 'url' | 'expect'>} check
 * @param {PageOutcome} outcome
 * @returns {Verdict}
 */
export function pageVerdict(check, outcome) {
  if (outcome.kind === 'unreachable')
    return {
      pass: false,
      detail: `GET ${check.url} -> status=none; no HTTP response in 2 attempts (${outcome.reasons.join('; then ')})`,
    }
  const { response, retriedAfter } = outcome
  const { met, wanted } = requirement(check, response)
  const observed = [
    `status=${response.status}`,
    `content-type=${response.contentType ?? 'none'}`,
    ...(response.location === null ? [] : [`location=${response.location}`]),
    // Cloudflare sends this header when it answers with a challenge or a block instead of the site.
    ...(response.cfMitigated === null ? [] : [`cf-mitigated=${response.cfMitigated}`]),
    ...(response.body.kind === 'read' ? [] : [`body=unread (${response.body.reason})`]),
    ...(retriedAfter === null
      ? []
      : [`second attempt (the first got no response: ${retriedAfter})`]),
  ].join(' ')
  return {
    pass: met,
    detail: `GET ${check.url} -> ${observed}${met ? '' : `; expected ${wanted}`}`,
  }
}

/**
 * The first module script the HTML names that is served from the page's own origin under /assets/.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {string | null}
 */
export function moduleScriptUrl(html, pageUrl) {
  const page = new URL(pageUrl)
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\stype\s*=\s*(?:"module"|'module'|module[\s>])/i.test(tag)) continue
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const value = src?.[1] ?? src?.[2] ?? src?.[3]
    if (value === undefined || !URL.canParse(value, page)) continue
    const url = new URL(value, page)
    if (url.origin === page.origin && url.pathname.startsWith('/assets/')) return url.href
  }
  return null
}

/**
 * The homepage must name its entry script, and that script must be served.
 * @param {string} siteOrigin
 * @param {GetPage} get
 * @returns {Promise<Verdict>}
 */
async function homepageModuleScript(siteOrigin, get) {
  const home = { url: new URL('/', siteOrigin).href, expect: { kind: 'html' } }
  const page = await get(home.url)
  const verdict = pageVerdict(home, page)
  if (page.kind !== 'response' || !verdict.pass) return verdict
  const { body } = page.response
  if (body.kind === 'unread')
    return {
      pass: false,
      detail: `${verdict.detail}; the entry script cannot be looked up without the body`,
    }
  const scriptUrl = moduleScriptUrl(body.text, home.url)
  if (scriptUrl === null)
    return {
      pass: false,
      detail: `${verdict.detail}; the HTML names no <script type="module"> with a src under /assets/`,
    }
  const script = { url: scriptUrl, expect: { kind: 'file' } }
  return pageVerdict(script, await get(scriptUrl))
}

/**
 * Every site check as a [name, run] entry for smokeChecks(). `get` is their only effect.
 * @param {string} siteOrigin
 * @param {GetPage} get
 * @returns {[string, () => Promise<Verdict>][]}
 */
export function sitePageChecks(siteOrigin, get) {
  return [
    ...pageChecks(siteOrigin).map((check) => [
      check.name,
      async () => pageVerdict(check, await get(check.url)),
    ]),
    [HOMEPAGE_SCRIPT_CHECK, () => homepageModuleScript(siteOrigin, get)],
  ]
}

function failureReason(err) {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause instanceof Error ? ` (${err.cause.code ?? err.cause.message})` : ''
  return `${err.name}: ${err.message}${cause}`
}

/**
 * The response a head belongs to. A body that cannot be read is part of that response.
 * @param {PageHead} head
 * @returns {Promise<PageResponse>}
 */
async function withBody({ text, ...head }) {
  try {
    return { ...head, body: { kind: 'read', text: await text() } }
  } catch (err) {
    return { ...head, body: { kind: 'unread', reason: failureReason(err) } }
  }
}

/**
 * At most two attempts. The second happens only when the first produced no response headers
 * (connection failure or timeout before them). Once headers arrive, that response is the answer,
 * whatever its status and whether or not its body can be read, so a retry cannot turn an error
 * page into a pass.
 * @param {(url: string) => Promise<PageHead>} request
 * @returns {GetPage}
 */
export function retryingOnce(request) {
  const attempt = async (url) => {
    try {
      return { kind: 'head', head: await request(url) }
    } catch (err) {
      return { kind: 'none', reason: failureReason(err) }
    }
  }
  return async (url) => {
    const first = await attempt(url)
    const last = first.kind === 'head' ? first : await attempt(url)
    if (last.kind === 'none') return { kind: 'unreachable', reasons: [first.reason, last.reason] }
    return {
      kind: 'response',
      response: await withBody(last.head),
      retriedAfter: first.kind === 'none' ? first.reason : null,
    }
  }
}

// Names this client in the site's logs. No personal data.
const PAGE_REQUEST_HEADERS = {
  'User-Agent': 'bladeblend-live-smoke/1 (scheduled read-only check of the deployed site)',
  Accept: 'text/html,*/*;q=0.8',
}

// The network edge of the page checks: one GET with a time limit. A redirect is returned, not
// followed, so a page cannot pass by redirecting to another page that answers 200.
async function requestPage(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: PAGE_REQUEST_HEADERS,
    signal: requestSignal(),
  })
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    location: response.headers.get('location'),
    cfMitigated: response.headers.get('cf-mitigated'),
    text: () => response.text(),
  }
}

const getPage = retryingOnce(requestPage)

/**
 * Every check of a run, in order, as [name, run] entries. `get` is the only effect of the site
 * checks; the six before them reach the network through postJson.
 * @param {string} siteOrigin
 * @param {GetPage} get
 * @returns {[string, () => Promise<Verdict>][]}
 */
export function smokeChecks(siteOrigin, get) {
  return [
    ['database-owned catalog + available_slots', checkAvailableSlots],
    ['/api/bookings invalid (empty body -> 400)', checkSubmitBookingInvalid],
    ['/api/bookings invalid email (malformed -> 400)', checkSubmitBookingInvalidEmail],
    [
      '/api/bookings turnstile gate (empty token -> failed_challenge)',
      checkSubmitBookingTurnstileGate,
    ],
    ['public action gateway (empty token -> failed_challenge)', checkPublicActionGateway],
    ['direct lookup_booking RPC (anon -> 404)', checkDirectLookupContract],
    ...sitePageChecks(siteOrigin, get),
  ]
}

/**
 * Runs the checks one after another and reports each as it finishes. A check that throws (a
 * request that failed or ran out of time) is a failure of that check, never the end of the run.
 * @param {[string, () => Promise<Verdict>][]} checks
 * @param {(line: string) => void} report
 * @returns {Promise<{ total: number, failures: number }>}
 */
export async function runChecks(checks, report) {
  let failures = 0
  for (const [name, run] of checks) {
    let pass = false
    let detail = ''
    try {
      ;({ pass, detail } = await run())
    } catch (err) {
      detail = `threw: ${err && err.message ? err.message : String(err)}`
    }
    if (!pass) failures += 1
    report(`[${pass ? 'PASS' : 'FAIL'}] ${name} — ${detail}`)
  }
  return { total: checks.length, failures }
}

/**
 * The closing lines of a run and its exit status. Only a run without a failure gets the
 * all-green line and status 0.
 * @param {{ total: number, failures: number }} result
 * @returns {{ lines: [string, string], exitCode: 0 | 1 }}
 */
export function runVerdict({ total, failures }) {
  const result = `\nResult: ${total - failures}/${total} passed.`
  return failures > 0
    ? {
        lines: [result, `VERDICT: FAIL (${failures} check${failures === 1 ? '' : 's'} failed)`],
        exitCode: 1,
      }
    : { lines: [result, 'VERDICT: ALL_GREEN'], exitCode: 0 }
}

async function main() {
  console.log(`Blade & Blend Studio live smoke test -> ${baseUrl} + ${siteOrigin}\n`)
  const { lines, exitCode } = runVerdict(
    await runChecks(smokeChecks(siteOrigin, getPage), (line) => console.log(line)),
  )
  for (const line of lines) console.log(line)
  if (exitCode !== 0) process.exit(exitCode)
}

if (runDirectly) {
  main().catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
}
