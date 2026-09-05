// smoke-live.mjs — live, non-browser smoke test for the Blade & Blend Studio backend.
//
// Hits the LIVE Supabase project with the PUBLIC anon key only (never a service_role
// key). Verifies public entry points the booking UI depends on:
//
//   1. public catalog + available_slots — discovers current database IDs and returns bookable slots.
//   2. submit-booking (400)  — rejects a malformed body with HTTP 400.
//   3. submit-booking email  — malformed email is rejected before the bot check.
//   4. submit-booking gate   — an empty Turnstile token is rejected (failed_challenge),
//                              proving the bot gate is active in production.
//   5. public action gateway — rejects an empty Turnstile token (failed_challenge).
//   6. lookup_booking RPC    — denied in both stages because the gateway contract is already live;
//                              the retirement stage removes the function itself after coexistence.
//
// Each check logs PASS/FAIL with the key value it observed. Process exits 1 if ANY
// check fails, 0 only when every check passes (so CI can gate on it).
//
// No dependencies — uses the global `fetch` (Node 18+). No browser.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon-jwt> \
//   PUBLIC_BOOKING_STAGE=expand|contract \
//   node tools/smoke-live.mjs

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const PUBLIC_BOOKING_STAGE = process.env.PUBLIC_BOOKING_STAGE

if (
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  (PUBLIC_BOOKING_STAGE !== 'expand' && PUBLIC_BOOKING_STAGE !== 'contract')
) {
  console.error(
    'FATAL: SUPABASE_URL, SUPABASE_ANON_KEY, and PUBLIC_BOOKING_STAGE=expand|contract are required.',
  )
  process.exit(1)
}

const baseUrl = SUPABASE_URL.replace(/\/+$/, '') // tolerate a trailing slash

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

// POST a JSON body and return { status, json, text }. `json` is undefined when the
// response body is not valid JSON (so a check can distinguish "bad JSON" from null).
async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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

// 2. submit-booking with an empty body — expect HTTP 400 (true client fault).
async function checkSubmitBookingInvalid() {
  const { status, json } = await postJson('/functions/v1/submit-booking', {})
  const pass = status === 400
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

// 3. Malformed email is rejected before Turnstile verification.
async function checkSubmitBookingInvalidEmail() {
  const [catalog] = await smokeCatalog()
  const { status, json } = await postJson('/functions/v1/submit-booking', {
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

// 4. submit-booking with a valid body but empty Turnstile token — expect HTTP 200 +
//    { ok:false, error:"failed_challenge" }. This proves Turnstile is active and fail-closed.
async function checkSubmitBookingTurnstileGate() {
  const [catalog] = await smokeCatalog()
  const { status, json } = await postJson('/functions/v1/submit-booking', {
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

// 6. The gateway contract is already live. Expand means "before the three retirement migrations";
//    contract means "after them". Direct anonymous lookup stays denied in both stages.
async function checkDirectLookupContract() {
  const { status, json } = await postJson('/rest/v1/rpc/lookup_booking', {
    p_contact: '0700000000',
  })
  const pass =
    PUBLIC_BOOKING_STAGE === 'expand'
      ? status === 401 || status === 403
      : PUBLIC_BOOKING_STAGE === 'contract'
        ? status === 404
        : false
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

const checks = [
  ['database-owned catalog + available_slots', checkAvailableSlots],
  ['submit-booking invalid (empty body -> 400)', checkSubmitBookingInvalid],
  ['submit-booking invalid email (malformed -> 400)', checkSubmitBookingInvalidEmail],
  [
    'submit-booking turnstile gate (empty token -> failed_challenge)',
    checkSubmitBookingTurnstileGate,
  ],
  ['public action gateway (empty token -> failed_challenge)', checkPublicActionGateway],
  [`direct lookup_booking RPC (anon -> ${PUBLIC_BOOKING_STAGE})`, checkDirectLookupContract],
]

async function main() {
  console.log(`Blade & Blend Studio live smoke test -> ${baseUrl}\n`)
  let failures = 0
  for (const [name, fn] of checks) {
    let pass = false
    let detail = ''
    try {
      ;({ pass, detail } = await fn())
    } catch (err) {
      detail = `threw: ${err && err.message ? err.message : String(err)}`
    }
    if (!pass) failures += 1
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} — ${detail}`)
  }
  const total = checks.length
  console.log(`\nResult: ${total - failures}/${total} passed.`)
  if (failures > 0) {
    console.log(`VERDICT: FAIL (${failures} check${failures === 1 ? '' : 's'} failed)`)
    process.exit(1)
  }
  console.log('VERDICT: ALL_GREEN')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
