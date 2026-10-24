// Backend answers for the public and visual groups (TST-25). The harness build points Supabase at
// https://admin-harness.invalid, which never resolves, so these routes ARE the backend: fixed
// barbers, empty copy overlays and a placeholder for every Storage object. A request this module
// does not know is recorded as a guard violation and fails the test instead of being guessed.
//
// Two data sets share these routes. installPublicBackend keeps the empty presentation and two
// fixture barbers: it is the code-fallback guard of visual.spec.mjs. installStoredBackend serves the
// committed rev-56 presentation (fixtures/presentation.json.gz) together with the entities that
// presentation was captured from, so its stored barber-card and booking ids meet live nodes
// (PAR-18 stored baselines, LIB-14 id coverage). Both also answer the two customer-gateway calls
// that a page boot makes and refuse every other one (installCustomerGateway), so no spec of the
// public or visual groups reaches the preview's loopback proxy.

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { gatewayAnswerOf, gatewayRefusalReason, isCustomerGatewayUrl } from './customer-gateway.mjs'
import { guardOf } from './network-guard.mjs'
import { installEmptyCmsPresentation } from './public-first-paint.mjs'

const HARNESS_HOST = 'admin-harness.invalid'
const WEEKDAYS = [1, 2, 3, 4, 5]
const STORAGE_PREFIX = '/storage/v1/object/public/'
const PLACEHOLDER_IMAGE = readFileSync(new URL('../../public/og-image.png', import.meta.url))
const STORED_PRESENTATION_PATH = new URL('./fixtures/presentation.json.gz', import.meta.url)
const NO_STORE = { 'cache-control': 'no-store' }

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

// The rev-56 capture rendered these barbers in this order (its About cards and booking cards are
// keyed by barber id) with the public copy below, and no barber photos. Refresh with the fixture.
const STORED_BARBERS = [
  {
    id: 'hassan',
    name: 'Hassan',
    ig: 'freebandzcuts',
    bio_sv:
      'Specialist på skinfades och precisa kanter. Hassan har saxen i handen sedan tonåren och gör jobbet med is i magen.',
    bio_en:
      'Specialist in skin fades and precise lines. Hassan has had the scissors in hand since his teens and works with a steady calm.',
  },
  { id: 'k', name: 'k', ig: 'k', bio_sv: '', bio_en: '' },
  {
    id: 'victor',
    name: 'Victor',
    ig: 'vic.barber1',
    bio_sv:
      'Klassiska klippningar med modern touch. Victor lyssnar in vad du vill ha och levererar varje gång — skägg är hans signatur.',
    bio_en:
      'Classic cuts with a modern touch. Victor listens to what you want and delivers every time — beards are his signature.',
  },
  {
    id: 'salman',
    name: 'Salman',
    ig: 'frescobarbiere',
    bio_sv:
      'Texturerat hår och rena övergångar. Salman tar gärna den extra minuten för att detaljen ska bli helt rätt.',
    bio_en:
      'Textured hair and clean transitions. Salman happily takes the extra minute to get the detail exactly right.',
  },
].map((barber, index) => ({
  ...barber,
  role_sv: 'Barberare',
  role_en: 'Barber',
  active: true,
  sort_order: index + 1,
  photo_path: null,
}))
// The captured booking-options scene lists five services (rows keyed by position); every stored
// barber offers the same menu Monday to Saturday.
const STORED_MENU = [
  { name: 'Hårklippning + skägg', duration_min: 60, price: 450 },
  { name: 'Hårklippning', duration_min: 45, price: 350 },
  { name: 'Skäggklippning', duration_min: 30, price: 200 },
  { name: 'Studentklippning', duration_min: 45, price: 300 },
  { name: 'Klippning, barn', duration_min: 45, price: 289 },
]
const STORED_SERVICES = STORED_BARBERS.flatMap((barber) =>
  STORED_MENU.map((service, index) => ({
    ...service,
    id: `${barber.id}-service-${index + 1}`,
    barber_id: barber.id,
    active: true,
    sort_order: index + 1,
    available_weekdays: [1, 2, 3, 4, 5, 6],
  })),
)
// One photo per gallery, as captured. Tile ids hash the production row id, which the sanitised
// fixture cannot carry, so these ids are local; the Storage paths are the captured ones.
const STORED_GALLERY = [
  {
    id: 'stored-salon-photo',
    kind: 'salon',
    storage_path: 'salon/bfa8c9c3-7f01-4157-95f7-3c76d14607db.webp',
    alt: '',
    sort_order: 1,
  },
  {
    id: 'stored-cuts-photo',
    kind: 'cuts',
    storage_path: 'cuts/ef047011-0810-4b74-b6c2-b36c71c8a742.webp',
    alt: '',
    sort_order: 1,
  },
]

function discoveryOf(barbers, services, weekdays) {
  return {
    settings: {},
    barbers: barbers.map(({ id, name }) => ({ id, name })),
    services: services.map(({ id, barber_id, price }) => ({ id, barber_id, price })),
    schedules: barbers.flatMap(({ id }) =>
      weekdays.map((weekday) => ({ barber_id: id, weekday, start_min: 540, end_min: 1080 })),
    ),
  }
}

// PostgREST filters a select with `kind=eq.<kind>`; an absent filter returns every row.
function galleryRows(rows, url) {
  const filter = url.searchParams.get('kind')
  return filter === null ? rows : rows.filter((row) => `eq.${row.kind}` === filter)
}

/** `METHOD /path` -> answer for the request URL. Empty arrays are "owner has not customised this". */
function answersFor({ barbers, services, gallery, weekdays }) {
  const discovery = discoveryOf(barbers, services, weekdays)
  const catalog = { barbers, services }
  return new Map(
    /** @type {[string, (url: URL) => unknown][]} */ ([
      ['GET /rest/v1/site_content', () => []],
      ['GET /rest/v1/about_content', () => []],
      ['GET /rest/v1/reviews', () => []],
      ['GET /rest/v1/gallery_images', (url) => galleryRows(gallery, url)],
      ['POST /rest/v1/rpc/public_business_discovery', () => discovery],
      ['POST /rest/v1/rpc/public_booking_catalog', () => catalog],
    ]),
  )
}

const CODE_FALLBACK_ANSWERS = answersFor({
  barbers: BARBERS,
  services: SERVICES,
  gallery: [],
  weekdays: WEEKDAYS,
})
const STORED_ANSWERS = answersFor({
  barbers: STORED_BARBERS,
  services: STORED_SERVICES,
  gallery: STORED_GALLERY,
  weekdays: [1, 2, 3, 4, 5, 6],
})

function corsHeaders(request) {
  const headers = request.headers()
  return {
    'access-control-allow-origin': headers['origin'] ?? '*',
    'access-control-allow-headers': headers['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  }
}

function answer(route, guard, answers) {
  const request = route.request()
  const url = new URL(request.url())
  const headers = corsHeaders(request)
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  if (request.method() === 'GET' && url.pathname.startsWith(STORAGE_PREFIX))
    return route.fulfill({ headers, contentType: 'image/png', body: PLACEHOLDER_IMAGE })
  const body = answers.get(`${request.method()} ${url.pathname}`)
  if (body !== undefined) return route.fulfill({ headers, json: body(url) })
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

// In production the Worker relays /api/customer-bookings. The preview proxies it to 127.0.0.1:8787
// (vite.config.ts), out of the browser guard's sight, so shots and assertions would depend on
// whatever listens there. Answer it here and refuse what is not fixtured.
async function installCustomerGateway(context) {
  const guard = guardOf(context)
  await context.route(isCustomerGatewayUrl, (route) => {
    const request = route.request()
    const body = gatewayAnswerOf(() => request.postDataJSON())
    if (body !== undefined) return route.fulfill({ json: body })
    guard.record({
      channel: 'request',
      method: request.method(),
      url: request.url(),
      reason: gatewayRefusalReason(() => request.postDataJSON()),
    })
    return route.fulfill({ status: 501, json: { message: 'No public fixture for this call' } })
  })
}

async function installBackendRoutes(context, answers) {
  const guard = guardOf(context)
  await installCustomerGateway(context)
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: TURNSTILE_STUB }),
  )
  await context.route(`https://${HARNESS_HOST}/**`, (route) => answer(route, guard, answers))
  await context.routeWebSocket(
    (url) => url.hostname === HARNESS_HOST,
    (socket) => socket.close({ code: 1000, reason: 'Realtime is offline in the public fixtures' }),
  )
}

/** CMS presentation, Supabase REST and Storage for one guarded context. Realtime stays offline. */
export async function installPublicBackend(context) {
  await installEmptyCmsPresentation(context)
  await installBackendRoutes(context, CODE_FALLBACK_ANSWERS)
}

let storedResponse = null

/** The committed `{ revision, presentation }` response, decompressed once per worker. */
export function storedPresentationResponse() {
  storedResponse ??= JSON.parse(gunzipSync(readFileSync(STORED_PRESENTATION_PATH)).toString('utf8'))
  return storedResponse
}

/**
 * The stored (rev-56) presentation and its captured entities for one guarded context, and the
 * customer gateway.
 */
export async function installStoredBackend(context) {
  const response = storedPresentationResponse()
  await context.route('**/api/cms/presentation', (route) =>
    route.fulfill({ headers: { 'content-type': 'application/json', ...NO_STORE }, json: response }),
  )
  await installBackendRoutes(context, STORED_ANSWERS)
}
