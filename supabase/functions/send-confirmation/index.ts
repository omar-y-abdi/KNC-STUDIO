// send-confirmation — Supabase Edge Function.
//
// Triggered after a booking insert. Trusts only booking id from request, re-reads all recipients and
// content through a service-role-only RPC, then sends transactional email through Resend to:
//   1. customer email stored on booking, and
//   2. linked barber's Supabase Auth email.
//
// Inbound webhook is fail-closed behind BOOKING_WEBHOOK_SECRET. Resend requests use deterministic
// Idempotency-Key values so a webhook retry does not duplicate either recipient's message.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FROM = 'Blade & Blend Studio <no-reply@bladeblendstudio.se>'

interface WebhookEnvelope {
  readonly record?: unknown
}

interface BookingRow {
  readonly id: string
  readonly email: string | null
  readonly phone: string | null
  readonly customerName: string
  readonly startAt: string
  readonly serviceName: string
  readonly price: number
  readonly durationMin: number
  readonly barberName: string
  readonly barberEmail: string | null
  readonly lang: 'sv' | 'en'
}

interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

type IdResult =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseBookingId(raw: unknown): IdResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'payload must be a JSON object' }
  }
  const envelope = raw as WebhookEnvelope
  const candidate: unknown = envelope.record === undefined ? raw : envelope.record
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, error: 'missing booking record' }
  }
  const record = candidate as Record<string, unknown>
  if (!isNonEmptyString(record.id)) return { ok: false, error: 'id is required' }
  return { ok: true, id: record.id }
}

function nullableString(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null
}

async function fetchBooking(id: string): Promise<BookingRow | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return null

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('booking_confirmation_details', { p_id: id })
  if (error || data === null || typeof data !== 'object') return null
  const row = data as Record<string, unknown>

  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.customer_name) ||
    !isNonEmptyString(row.start_at) ||
    !isNonEmptyString(row.service_name) ||
    typeof row.price !== 'number' ||
    typeof row.duration_min !== 'number' ||
    !isNonEmptyString(row.barber_name) ||
    (row.lang !== 'sv' && row.lang !== 'en')
  ) {
    return null
  }

  return {
    id: row.id,
    email: nullableString(row.email),
    phone: nullableString(row.phone),
    customerName: row.customer_name,
    startAt: row.start_at,
    serviceName: row.service_name,
    price: row.price,
    durationMin: row.duration_min,
    barberName: row.barber_name,
    barberEmail: nullableString(row.barber_email),
    lang: row.lang,
  }
}

function formatWhen(booking: BookingRow): { readonly date: string; readonly time: string } {
  const when = new Date(booking.startAt)
  const locale = booking.lang === 'en' ? 'en-GB' : 'sv-SE'
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Stockholm',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(when)
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
  }).format(when)
  return { date, time }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function linesToHtml(lines: readonly string[]): string {
  return lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join('')
}

function wrapHtml(content: string): string {
  return `<!doctype html><html lang="sv"><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:28px"><h1 style="font-size:22px;margin:0 0 20px">Blade &amp; Blend Studio</h1>${content}<p style="margin:24px 0 0;color:#71717a;font-size:13px">Geijersgatan 10, 411 34 Göteborg · 079-304 36 71</p></div></div></body></html>`
}

function customerMessage(booking: BookingRow): EmailMessage | null {
  if (booking.email === null) return null
  const when = formatWhen(booking)
  const lines =
    booking.lang === 'en'
      ? [
          `Hi ${booking.customerName}, your appointment is confirmed.`,
          `Barber: ${booking.barberName}`,
          `Time: ${when.date}, ${when.time}`,
          `Service: ${booking.serviceName} · ${booking.price} SEK`,
          'You can view or cancel the booking under “My appointments” using the phone number entered when booking.',
        ]
      : [
          `Hej ${booking.customerName}, din tid är bokad.`,
          `Barberare: ${booking.barberName}`,
          `Tid: ${when.date}, ${when.time}`,
          `Behandling: ${booking.serviceName} · ${booking.price} kr`,
          'Du kan se eller avboka tiden under ”Mina bokningar” med telefonnumret du angav vid bokningen.',
        ]
  return {
    to: booking.email,
    subject:
      booking.lang === 'en'
        ? 'Booking confirmation – Blade & Blend Studio'
        : 'Bokningsbekräftelse – Blade & Blend Studio',
    text: lines.join('\n\n'),
    html: wrapHtml(linesToHtml(lines)),
  }
}

function barberMessage(booking: BookingRow): EmailMessage | null {
  if (booking.barberEmail === null) return null
  const when = formatWhen(booking)
  const contact = [booking.phone, booking.email].filter((value): value is string => value !== null)
  const lines = [
    `Ny bokning för ${booking.barberName}.`,
    `Tid: ${when.date}, ${when.time}`,
    `Kund: ${booking.customerName}`,
    `Behandling: ${booking.serviceName} · ${booking.durationMin} min · ${booking.price} kr`,
    `Kontakt: ${contact.join(' · ')}`,
  ]
  return {
    to: booking.barberEmail,
    subject: `Ny bokning – ${when.date} ${when.time}`,
    text: lines.join('\n\n'),
    html: wrapHtml(linesToHtml(lines)),
  }
}

async function sendViaResend(
  message: EmailMessage,
  apiKey: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: FROM, ...message }),
  })
  if (!response.ok) {
    let providerMessage = 'unknown provider error'
    const payload: unknown = await response.json().catch(() => null)
    if (typeof payload === 'object' && payload !== null) {
      const message = (payload as Record<string, unknown>).message
      if (typeof message === 'string' && message.length > 0) providerMessage = message
    }
    throw new Error(`Resend API returned ${response.status}: ${providerMessage.slice(0, 240)}`)
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const webhookSecret = Deno.env.get('BOOKING_WEBHOOK_SECRET')
  if (!webhookSecret) return json({ ok: false, error: 'not_configured' }, 503)
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
  if (!parsed.ok) return json({ ok: false, error: 'invalid_payload', detail: parsed.error }, 400)

  const booking = await fetchBooking(parsed.id)
  if (booking === null) {
    console.error(`send-confirmation: unreadable booking ${parsed.id}`)
    return json({ ok: false, error: 'booking_not_found' }, 404)
  }

  const messages = [
    { kind: 'customer', message: customerMessage(booking) },
    { kind: 'barber', message: barberMessage(booking) },
  ].filter(
    (entry): entry is { readonly kind: string; readonly message: EmailMessage } =>
      entry.message !== null,
  )

  if (messages.length === 0) return json({ ok: true, skipped: 'no_recipients' }, 200)

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return json({ ok: true, skipped: 'no_resend_configured' }, 200)

  try {
    for (const entry of messages) {
      await sendViaResend(entry.message, apiKey, `booking-confirmation/${entry.kind}/${booking.id}`)
    }
    console.log(
      `send-confirmation: sent ${messages.map((entry) => entry.kind).join(',')} for ${booking.id}`,
    )
    return json({ ok: true, sent: messages.map((entry) => entry.kind) }, 200)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown provider error'
    console.error(`send-confirmation: send failed for ${booking.id}: ${detail}`)
    return json({ ok: false, error: 'send_failed', detail }, 502)
  }
})
