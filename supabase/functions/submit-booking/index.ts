import { verifyTurnstile, turnstilePolicy } from '../_shared/turnstile.ts'
// submit-booking — Supabase Edge Function (Deno) — the public booking GATEWAY (PLAN §3).
//
// The browser (anon) no longer calls create_booking directly. It POSTs here. This function:
//   1. verifies a Cloudflare Turnstile token server-side (fail-closed),
//   2. hashes the trusted platform client IP, then
//   3. atomically rate-limits IP + phone and calls create_booking through one service-role RPC;
//      the database derives name, price, and duration from
//      the active services row rather than trusting browser-supplied commercial data.
//
// Invocation: browser -> this function (verify_jwt = false; see supabase/config.toml). It is CORS-
// enabled (preflight + every response) because it is called cross-origin from the static site.
//
// HTTP-STATUS DISCIPLINE: supabase-js `functions.invoke` turns any non-2xx into a FunctionsHttpError
// (data:null, reason buried in error.context). So EVERY EXPECTED outcome — failed_challenge,
// rate_limited, and every pass-through create_booking error (slot_taken, outside_hours, invalid, ...) —
// returns HTTP 200 with { ok:false, error }. Non-2xx is reserved for true faults: a bad JSON body (400)
// or an unhandled exception (500).
//
// Run locally: npx supabase functions serve --no-verify-jwt --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import { verifyCustomerGateway } from '../_shared/customerGatewayAuth.ts'
import { createCustomerAccessToken, hashCustomerAccessToken } from '../_shared/customerAccess.ts'
import {
  CUSTOMER_RECEIPT_COOKIE,
  CUSTOMER_SESSION_COOKIE,
  customerCookie,
  customerCookieHeader,
  customerCookieProof,
} from '../_shared/customerCookies.ts'

// --- CORS -------------------------------------------------------------------------------------

// `*` because the static site is served from a different origin (Cloudflare) than the function (Supabase),
// and the request carries no credentials/cookies — only the public anon apikey header.
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Tunable backstops ------------------------------------------------------------------------
// GENEROUS, coarse limits — tunable; Turnstile is the real bot gate. These must NOT false-positive on
// shared CGNAT / salon Wi-Fi (many people behind one IP) or a parent booking self + 2 kids in a row.
const MAX_PER_IP = 10 // max accepted attempts per IP hash within IP_WINDOW_MS
const IP_WINDOW_SECONDS = 10 * 60 // 10 minutes
const MAX_PER_PHONE = 5 // max bookings per phone within PHONE_WINDOW_MS
const PHONE_WINDOW_SECONDS = 24 * 60 * 60 // 24 hours

// --- Types ------------------------------------------------------------------------------------

interface BookingInput {
  readonly barberId: string
  readonly serviceId: string
  readonly startAt: string // ISO timestamptz string (already Stockholm-correct; see PLAN §3 H2)
  readonly phone: string
  readonly email: string
  readonly lang: string
  readonly customerName: string
}

type ParseResult =
  | {
      readonly ok: true
      readonly booking: BookingInput
      readonly turnstileToken: string
      readonly rememberBookings: boolean
    }
  | { readonly ok: false; readonly error: string }

// --- Validation (boundary; never trust the request body) --------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length === 0 || email.length > 254) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function parseRequest(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const root = raw as Record<string, unknown>
  const b = root.booking
  if (typeof b !== 'object' || b === null) {
    return { ok: false, error: 'booking is required' }
  }
  const r = b as Record<string, unknown>

  if (!isNonEmptyString(r.barberId)) return { ok: false, error: 'barberId is required' }
  if (!isNonEmptyString(r.serviceId)) return { ok: false, error: 'serviceId is required' }
  if (!isNonEmptyString(r.startAt)) return { ok: false, error: 'startAt is required' }
  if (!isNonEmptyString(r.phone)) return { ok: false, error: 'phone is required' }
  const email = normalizeEmail(r.email)
  if (email === null) return { ok: false, error: 'email is invalid' }
  if (r.lang !== 'sv' && r.lang !== 'en') return { ok: false, error: 'lang is invalid' }
  if (!isNonEmptyString(r.customerName)) return { ok: false, error: 'customerName is required' }

  // turnstileToken is optional (empty when the widget is offline / unconfigured); coerce to string.
  const token = typeof root.turnstileToken === 'string' ? root.turnstileToken : ''

  return {
    ok: true,
    rememberBookings: root.rememberBookings === true,
    turnstileToken: token,
    booking: {
      barberId: r.barberId,
      serviceId: r.serviceId,
      startAt: r.startAt,
      phone: r.phone,
      email,
      lang: r.lang,
      customerName: r.customerName,
    },
  }
}

// --- Helpers ----------------------------------------------------------------------------------

function json(body: unknown, status: number, cookie?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
      'Cache-Control': 'no-store',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  })
}

// SHA-256 hex of (ip + salt) via Web Crypto. We persist the HASH, never the raw IP -> PII-minimal.
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Supabase's edge gateway attaches cf-connecting-ip. Caller-controlled forwarding headers are ignored;
// missing platform metadata falls back to one shared "unknown" bucket rather than bypassing limits.
function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown'
}

// Turnstile siteverify. Configuration is checked before this helper; missing/invalid tokens and
// verification failures all fail closed.

// --- HTTP handler -----------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight — must be the first thing handled, with the CORS headers.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405)
  }

  // Parse + validate the body. Bad JSON / wrong shape is a true client fault -> non-2xx.
  let raw: unknown
  let bodyText: string
  try {
    bodyText = await req.text()
    raw = JSON.parse(bodyText)
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  const parsed = parseRequest(raw)
  if (!parsed.ok) {
    return json({ ok: false, error: 'invalid_payload', detail: parsed.error }, 400)
  }
  const { booking, turnstileToken, rememberBookings } = parsed

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET')
  const ipSalt = Deno.env.get('IP_SALT')
  if (!supabaseUrl || !serviceKey || !turnstileSecret || !ipSalt) {
    console.error('submit-booking: missing required server configuration.')
    return json({ ok: false, error: 'not_configured' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  let ip = clientIp(req)
  let firstParty = false
  if (req.headers.has('x-customer-gateway-signature') || req.headers.has('x-customer-gateway-ip')) {
    const forwarded = await verifyCustomerGateway(
      req,
      Deno.env.get('CUSTOMER_GATEWAY_SECRET'),
      bodyText,
    )
    if (forwarded === null) return json({ ok: false, error: 'origin_not_allowed' }, 403)
    ip = forwarded
    firstParty = true
  }

  // 1. Turnstile — server-side challenge, fail-closed.
  const challengeOk = await verifyTurnstile(
    turnstileToken,
    ip,
    turnstileSecret,
    turnstilePolicy('booking', Deno.env.get('PUBLIC_SITE_ORIGINS')),
  )
  if (!challengeOk) {
    return json({ ok: false, error: 'failed_challenge' }, 200)
  }

  try {
    // 2. IP hash.
    const ipHash = await sha256Hex(ip + ipSalt)

    // 3. One database transaction locks both rate-limit keys, checks both windows, records the
    //    attempt, and creates the booking. Concurrent requests cannot all pass stale counts.
    const rpc = await supabase.rpc('create_booking_with_limits', {
      p_barber_id: booking.barberId,
      p_service_id: booking.serviceId,
      p_start_at: booking.startAt,
      p_phone: booking.phone,
      p_email: booking.email,
      p_lang: booking.lang,
      p_customer_name: booking.customerName,
      p_ip_hash: ipHash,
      p_ip_window_secs: IP_WINDOW_SECONDS,
      p_phone_window_secs: PHONE_WINDOW_SECONDS,
      p_ip_limit: MAX_PER_IP,
      p_phone_limit: MAX_PER_PHONE,
    })
    if (rpc.error) throw rpc.error

    // Receipt failure can never undo a successful booking or turn it into a failed submit.
    if (
      firstParty &&
      rememberBookings &&
      rpc.data?.ok === true &&
      typeof rpc.data.booking?.id === 'string'
    ) {
      try {
        const existing = customerCookie(req, CUSTOMER_RECEIPT_COOKIE)
        const session = customerCookie(req, CUSTOMER_SESSION_COOKIE)
        const candidate = createCustomerAccessToken()
        const receipt = await supabase.rpc('append_customer_booking_receipt', {
          p_booking_id: rpc.data.booking.id,
          p_existing_hash: existing === null ? null : await hashCustomerAccessToken(existing),
          p_new_hash: await hashCustomerAccessToken(candidate),
          p_session_hash: session === null ? null : await hashCustomerAccessToken(session),
        })
        if (
          !receipt.error &&
          typeof receipt.data?.existing === 'boolean' &&
          Number.isInteger(receipt.data.max_age) &&
          receipt.data.max_age > 0 &&
          receipt.data.max_age <= 2592000
        ) {
          const token = receipt.data.existing && existing !== null ? existing : candidate
          return json(
            { ...rpc.data, receipt_proof: await customerCookieProof(token, 'receipt') },
            200,
            customerCookieHeader(CUSTOMER_RECEIPT_COOKIE, token, receipt.data.max_age),
          )
        }
        console.error(
          'submit-booking: receipt unavailable',
          receipt.error?.code ?? 'invalid_result',
        )
      } catch {
        console.error('submit-booking: receipt unavailable')
      }
    }
    return json(rpc.data, 200)
  } catch (err) {
    console.error('submit-booking: unhandled error:', err)
    return json({ ok: false, error: 'server_error' }, 500)
  }
})
