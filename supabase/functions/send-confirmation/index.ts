// send-confirmation — Supabase Edge Function (Deno).
//
// Purpose: when a booking is INSERTed, notify the salon's iPhone so it can text the customer (and,
// in the Shortcut, the barber) — TWO SMS. Instead of composing any message text here, this function
// emails a STRUCTURED, RAW-FIELD JSON payload (no pre-built sentences) via Resend; an iOS Shortcut
// watching that mailbox parses the JSON and composes + sends the SMS on-device:
//
//   Supabase DB Webhook (bookings INSERT) -> this function -> Resend email (JSON payload)
//     -> iPhone Mail automation -> Shortcut "Get Dictionary from Input" -> 2x Send Message (SMS)
//
// The email TEXT body is the raw JSON of DB-authoritative booking fields
// { name, phone, barber, service, date, time, lang } — the Shortcut owns ALL message wording, so
// copy changes never require a redeploy. With no RESEND_API_KEY set it VALIDATES + logs and returns
// 200 { ok:true, skipped:"no_resend_configured" } (no send), so the DB webhook can be wired before
// the mail bridge exists without retry storms.
//
// Invocation: server -> server from a trusted Supabase Database Webhook, so it receives no user JWT
// (config.toml: verify_jwt = false). Secured by a shared header secret (WEBHOOK_SECRET, fail-closed).
//
// Deno entrypoint. Run locally with `npx supabase functions serve send-confirmation`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// --- Types ------------------------------------------------------------------------------------

// We accept either a Database Webhook envelope ({ type, table, record, ... }, we read `record`) or a
// bare booking object (for manual curl tests). Only `id` is required from the payload — every field
// used to BUILD the message is re-read from the DB by id (see fetchBooking), so a forged payload can
// neither redirect the SMS nor alter its contents.
interface WebhookEnvelope {
  readonly type?: string
  readonly table?: string
  readonly record?: unknown
}

interface BookingRow {
  readonly phone: string
  readonly customer_name: string
  readonly start_at: string // ISO timestamptz
  readonly service_name: string
  readonly barber_name: string
  readonly lang: string
}

type IdResult =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }

// --- Validation (boundary; never trust the request body) --------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

// Extract the booking id from the payload (envelope `record.id` or a bare `id`). Everything else is
// read from the DB, so the id is all we need from the (untrusted) body.
function parseBookingId(raw: unknown): IdResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'payload must be a JSON object' }
  }
  const env = raw as WebhookEnvelope
  const candidate: unknown = env.record !== undefined ? env.record : raw
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, error: 'missing booking record' }
  }
  const r = candidate as Record<string, unknown>
  if (!isNonEmptyString(r.id)) return { ok: false, error: 'id is required' }
  return { ok: true, id: r.id }
}

// --- DB-authoritative read (service-role; never the request body) -----------------------------

// Re-fetch the booking by id with the service-role key (Edge Functions inject SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY). bookings is PII and RPC-gated even for service_role (migration 0002), so
// we read through the definer RPC booking_confirmation_details(p_id) which returns EXACTLY the SMS
// fields (incl. the barber's display name). The send TARGET (phone) AND the message content both come
// from the DATABASE, NOT the POST body — a forged webhook payload cannot redirect or rewrite the SMS (M3).
async function fetchBooking(id: string): Promise<BookingRow | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return null
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('booking_confirmation_details', { p_id: id })
  if (error || data === null || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  // A null phone (e.g. a legacy email-method row) means there is no SMS recipient.
  if (
    !isNonEmptyString(d.phone) ||
    !isNonEmptyString(d.customer_name) ||
    !isNonEmptyString(d.start_at) ||
    !isNonEmptyString(d.service_name) ||
    !isNonEmptyString(d.barber_name) ||
    !isNonEmptyString(d.lang)
  ) {
    return null
  }
  return {
    phone: d.phone,
    customer_name: d.customer_name,
    start_at: d.start_at,
    service_name: d.service_name,
    barber_name: d.barber_name,
    lang: d.lang,
  }
}

// --- Payload building (Stockholm-local date/time; NO composed sentences) -----------------------

// The RAW fields the iOS Shortcut needs to compose BOTH SMS itself. We emit fields, never a finished
// message string — keeping all wording on-device so copy edits never require a redeploy.
interface NotifyPayload {
  readonly name: string
  readonly phone: string
  readonly barber: string
  readonly service: string
  readonly date: string // Stockholm date localized by lang, e.g. "måndag 29 juni"
  readonly time: string // Stockholm wall-clock "HH:MM", e.g. "11:00"
  readonly lang: string
}

// Map the DB-authoritative booking row to the raw payload. Only date/time are derived here, formatted
// as Stockholm wall-clock regardless of the server's timezone (DST-safe via Intl + timeZone).
function buildPayload(booking: BookingRow): NotifyPayload {
  const when = new Date(booking.start_at)
  const locale = booking.lang === 'en' ? 'en-GB' : 'sv-SE'
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Stockholm',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(when)
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
  }).format(when)

  return {
    name: booking.customer_name,
    phone: booking.phone,
    barber: booking.barber_name,
    service: booking.service_name,
    date,
    time,
    lang: booking.lang,
  }
}

// --- Resend bridge ----------------------------------------------------------------------------

// Email the raw JSON payload to NOTIFY_EMAIL via Resend. The email TEXT body is JSON.stringify of the
// payload so the iOS Shortcut can parse it directly with "Get Dictionary from Input". Throws on any
// non-2xx so the caller maps it to 502 (the client-facing error carries no PII).
async function sendViaResend(payload: NotifyPayload, apiKey: string, to: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'knc-studio@resend.dev',
      to: [to],
      subject: 'Ny bokning - KNC Studio',
      text: JSON.stringify(payload),
    }),
  })
  if (!res.ok) {
    throw new Error(`Resend API returned ${res.status}`)
  }
}

// --- HTTP handler -----------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405)
  }

  // Shared-secret auth — FAIL-CLOSED. The webhook is server->server (verify_jwt = false), so this
  // shared secret is the only authentication. If WEBHOOK_SECRET is unset the function is NOT safe to
  // run (it would be a publicly-invokable relay), so reject everything; if set, require the matching
  // header. Set it with `supabase secrets set WEBHOOK_SECRET=...` and send it as `x-webhook-secret`.
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  if (!webhookSecret) {
    return json({ ok: false, error: 'not_configured' }, 503)
  }
  if (req.headers.get('x-webhook-secret') !== webhookSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const parsed = parseBookingId(raw)
  if (!parsed.ok) {
    return json({ ok: false, error: 'invalid_payload', detail: parsed.error }, 400)
  }

  // Re-read the booking from the DB by id — the recipient AND every payload field are DB-authoritative.
  const booking = await fetchBooking(parsed.id)
  if (booking === null) {
    console.error(`send-confirmation: no sendable booking for id ${parsed.id}`)
    return json({ ok: false, error: 'recipient_not_found' }, 404)
  }

  // Resend config (read post-fetch). Missing key OR recipient -> skip 200 so an unconfigured bridge
  // does not trigger webhook retry storms. Both are LIVE-set; the guard keeps the function safe before
  // the bridge exists and keeps `to` a definite string under strict types.
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const notifyEmail = Deno.env.get('NOTIFY_EMAIL')
  if (!resendApiKey || !notifyEmail) {
    console.log(
      `send-confirmation: skipped (no_resend_configured) for booking ${parsed.id} [email->sms]`,
    )
    return json({ ok: true, skipped: 'no_resend_configured' }, 200)
  }

  try {
    const payload = buildPayload(booking)
    await sendViaResend(payload, resendApiKey, notifyEmail)
    console.log(`send-confirmation: sent for booking ${parsed.id} [email->sms]`)
    return json({ ok: true, sent: true }, 200)
  } catch (err) {
    // Bridge failure: log detail server-side, return a generic error (no PII leak).
    console.error(`send-confirmation: resend error for booking ${parsed.id}:`, err)
    return json({ ok: false, error: 'send_failed' }, 502)
  }
})
