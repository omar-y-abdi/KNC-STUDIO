// Backend answers for the public and visual groups (TST-25). The harness build points Supabase at
// https://admin-harness.invalid, which never resolves, so these routes ARE the backend: fixed
// barbers, empty copy overlays and a placeholder for every Storage object. A request this module
// does not know is recorded as a guard violation and fails the test instead of being guessed.

import { readFileSync } from 'node:fs'
import { guardOf } from './network-guard.mjs'
import { installEmptyCmsPresentation } from './public-first-paint.mjs'

const HARNESS_HOST = 'admin-harness.invalid'
const WEEKDAYS = [1, 2, 3, 4, 5]
const STORAGE_PREFIX = '/storage/v1/object/public/'
const PLACEHOLDER_IMAGE = readFileSync(new URL('../../public/og-image.png', import.meta.url))

const BARBERS = [1, 2].map((number) => ({
  id: `e2e-barber-${number}`,
  name: `Fixture Barber ${number}`,
  ig: `fixture.barber.${number}`,
  role_sv: 'Barberare',
  role_en: 'Barber',
  bio_sv: 'Fixturprofil för tester.',
  bio_en: 'Fixture profile for tests.',
  active: true,
  sort_order: number,
  photo_path: null,
}))
const SERVICES = BARBERS.map((barber) => ({
  id: `${barber.id}-cut`,
  barber_id: barber.id,
  name: 'Fixture haircut',
  price: 400,
  duration_min: 30,
  active: true,
  sort_order: 1,
  available_weekdays: WEEKDAYS,
}))
const CATALOG = { barbers: BARBERS, services: SERVICES }
const DISCOVERY = {
  settings: {},
  barbers: BARBERS.map(({ id, name }) => ({ id, name })),
  services: SERVICES.map(({ id, barber_id, price }) => ({ id, barber_id, price })),
  schedules: BARBERS.flatMap(({ id }) =>
    WEEKDAYS.map((weekday) => ({ barber_id: id, weekday, start_min: 540, end_min: 1080 })),
  ),
}

// `METHOD /path` -> JSON body. Empty arrays are the "owner has not customised this" state.
const JSON_ANSWERS = new Map([
  ['GET /rest/v1/site_content', []],
  ['GET /rest/v1/about_content', []],
  ['GET /rest/v1/reviews', []],
  ['GET /rest/v1/gallery_images', []],
  ['POST /rest/v1/rpc/public_business_discovery', DISCOVERY],
  ['POST /rest/v1/rpc/public_booking_catalog', CATALOG],
])

function corsHeaders(request) {
  const headers = request.headers()
  return {
    'access-control-allow-origin': headers['origin'] ?? '*',
    'access-control-allow-headers': headers['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  }
}

function answer(route, guard) {
  const request = route.request()
  const { pathname } = new URL(request.url())
  const headers = corsHeaders(request)
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  if (request.method() === 'GET' && pathname.startsWith(STORAGE_PREFIX))
    return route.fulfill({ headers, contentType: 'image/png', body: PLACEHOLDER_IMAGE })
  const body = JSON_ANSWERS.get(`${request.method()} ${pathname}`)
  if (body !== undefined) return route.fulfill({ headers, json: body })
  guard.record({
    channel: 'request',
    method: request.method(),
    url: request.url(),
    reason: 'unfixtured-harness-request',
  })
  return route.fulfill({
    status: 501,
    headers,
    json: { message: 'No public fixture for this call' },
  })
}

// The booking dialog loads Cloudflare Turnstile; the public groups never reach Cloudflare.
const TURNSTILE_STUB =
  'window.turnstile={render:(_node,options)=>{queueMicrotask(()=>options.callback("local-test-token"));return "local"},remove:()=>{},reset:()=>{}}'

/** CMS presentation, Supabase REST and Storage for one guarded context. Realtime stays offline. */
export async function installPublicBackend(context) {
  const guard = guardOf(context)
  await installEmptyCmsPresentation(context)
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: TURNSTILE_STUB }),
  )
  await context.route(`https://${HARNESS_HOST}/**`, (route) => answer(route, guard))
  await context.routeWebSocket(
    (url) => url.hostname === HARNESS_HOST,
    (socket) => socket.close({ code: 1000, reason: 'Realtime is offline in the public fixtures' }),
  )
}
