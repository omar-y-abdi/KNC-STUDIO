// smoke-live.mjs — live, non-browser smoke test for the Blade & Blend Studio backend.
//
// Hits the LIVE Supabase project with the PUBLIC anon key only (never a service_role
// key). Verifies public entry points the booking UI depends on:
//
//   1. available_slots RPC   — returns bookable "HH:MM" slots for a barber/day.
//   2. submit-booking (400)  — rejects a malformed body with HTTP 400.
//   3. submit-booking email  — malformed email is rejected before the bot check.
//   4. submit-booking gate   — an empty Turnstile token is rejected (failed_challenge),
//                              proving the bot gate is active in production.
//   5. public action gateway — rejects an empty Turnstile token (failed_challenge).
//   6. lookup_booking RPC    — direct anonymous access is denied; only gateway service_role may call.
//
// Each check logs PASS/FAIL with the key value it observed. Process exits 1 if ANY
// check fails, 0 only when every check passes (so CI can gate on it).
//
// No dependencies — uses the global `fetch` (Node 18+). No browser.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon-jwt> \
//   node tools/smoke-live.mjs

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required.')
  process.exit(1)
}

const baseUrl = SUPABASE_URL.replace(/\/+$/, '') // tolerate a trailing slash

// A future working day, computed at run time so the checks stay meaningful forever (a hardcoded
// date silently rots: available_slots excludes past slots, so an elapsed date would return [] and
// fail check 1). Next Monday at least 3 days out — Mondays are working under the seed schedule.
function nextMondayIso() {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const SMOKE_DATE = nextMondayIso()

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

// --- Checks: each returns { pass: boolean, detail: string } -----------------------

// 1. available_slots — expect HTTP 200 + a non-empty array of "HH:MM" strings.
async function checkAvailableSlots() {
  const { status, json } = await postJson('/rest/v1/rpc/available_slots', {
    p_barber_id: 'hassan',
    p_date: SMOKE_DATE,
    p_duration_min: 30,
  })
  const isArray = Array.isArray(json)
  const allHHMM =
    isArray &&
    json.length > 0 &&
    json.every((s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s))
  const pass = status === 200 && allHHMM
  return { pass, detail: `status=${status} slots=${JSON.stringify(json)}` }
}

// 2. submit-booking with an empty body — expect HTTP 400 (true client fault).
async function checkSubmitBookingInvalid() {
  const { status, json } = await postJson('/functions/v1/submit-booking', {})
  const pass = status === 400
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

// 3. Malformed email is rejected before Turnstile verification.
async function checkSubmitBookingInvalidEmail() {
  const { status, json } = await postJson('/functions/v1/submit-booking', {
    booking: {
      barberId: 'hassan',
      serviceId: 'klippning',
      startAt: `${SMOKE_DATE}T10:00:00+02:00`,
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
  const { status, json } = await postJson('/functions/v1/submit-booking', {
    booking: {
      barberId: 'hassan',
      serviceId: 'klippning',
      // The Turnstile gate rejects before create_booking ever parses this, so a fixed +02:00
      // offset is fine year-round — the gateway's shape check only needs a non-empty string.
      startAt: `${SMOKE_DATE}T10:00:00+02:00`,
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

// 5. Phone-based actions are reachable only through the fail-closed Turnstile gateway.
async function checkPublicActionGateway() {
  const { status, json } = await postJson('/functions/v1/public-booking-actions', {
    action: 'lookup',
    phone: '0700000000',
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

// 6. The old direct Data API path must stay revoked for anon.
async function checkDirectLookupDenied() {
  const { status, json } = await postJson('/rest/v1/rpc/lookup_booking', {
    p_contact: '0700000000',
  })
  const pass = status === 401 || status === 403 || status === 404
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

const checks = [
  [`available_slots (hassan, ${SMOKE_DATE}, 30min)`, checkAvailableSlots],
  ['submit-booking invalid (empty body -> 400)', checkSubmitBookingInvalid],
  ['submit-booking invalid email (malformed -> 400)', checkSubmitBookingInvalidEmail],
  [
    'submit-booking turnstile gate (empty token -> failed_challenge)',
    checkSubmitBookingTurnstileGate,
  ],
  ['public action gateway (empty token -> failed_challenge)', checkPublicActionGateway],
  ['direct lookup_booking RPC (anon -> denied)', checkDirectLookupDenied],
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
