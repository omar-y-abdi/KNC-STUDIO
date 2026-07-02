// smoke-live.mjs — live, non-browser smoke test for the KNC Studio backend.
//
// Hits the LIVE Supabase project with the PUBLIC anon key only (never a service_role
// key). Verifies the four public entry points the booking UI depends on:
//
//   1. available_slots RPC   — returns bookable "HH:MM" slots for a barber/day.
//   2. submit-booking (400)  — rejects a malformed body with HTTP 400.
//   3. submit-booking gate   — an empty Turnstile token is rejected (failed_challenge),
//                              proving the bot gate is active in production.
//   4. lookup_booking RPC    — returns a JSON result for an unknown phone (not_found).
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
    p_date: '2026-06-29',
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

// 3. submit-booking with a valid body but empty Turnstile token — expect HTTP 200 +
//    { ok:false, error:"failed_challenge" }. This proves Turnstile is ACTIVE: if the
//    secret were unset the gate would fail-open and this would NOT be failed_challenge.
async function checkSubmitBookingTurnstileGate() {
  const { status, json } = await postJson('/functions/v1/submit-booking', {
    booking: {
      barberId: 'hassan',
      serviceId: 'klippning',
      serviceName: 'Klippning',
      price: 350,
      durationMin: 30,
      startAt: '2026-06-29T10:00:00+02:00',
      phone: '0701234567',
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

// 4. lookup_booking for an unknown phone — expect HTTP 200 + a JSON result
//    (the RPC returns { ok:false, error:"not_found" } when no booking matches).
async function checkLookupBooking() {
  const { status, json } = await postJson('/rest/v1/rpc/lookup_booking', {
    p_contact: '0700000000',
  })
  const pass = status === 200 && json !== null && json !== undefined
  return { pass, detail: `status=${status} body=${JSON.stringify(json)}` }
}

const checks = [
  ['available_slots (hassan, 2026-06-29, 30min)', checkAvailableSlots],
  ['submit-booking invalid (empty body -> 400)', checkSubmitBookingInvalid],
  [
    'submit-booking turnstile gate (empty token -> failed_challenge)',
    checkSubmitBookingTurnstileGate,
  ],
  ['lookup_booking (0700000000 -> not_found json)', checkLookupBooking],
]

async function main() {
  console.log(`KNC Studio live smoke test -> ${baseUrl}\n`)
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
