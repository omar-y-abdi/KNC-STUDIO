// send-confirmation — Supabase Edge Function.
//
// Triggered after a booking insert, cancellation, or due reminder. Trusts only booking id and event
// from request, re-reads all recipients and content through a service-role-only RPC, then sends
// transactional email through Resend to:
//   1. customer email stored on booking, and
//   2. linked barber's Supabase Auth email.
//
// Inbound webhook is fail-closed behind BOOKING_WEBHOOK_SECRET. Resend requests use deterministic
// Idempotency-Key values so a webhook retry does not duplicate either recipient's message.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FROM = 'Blade & Blend Studio <no-reply@bladeblendstudio.se>'

interface WebhookEnvelope {
  readonly record?: unknown
  readonly event?: unknown
}

type BookingEmailEvent = 'booking_confirmed' | 'booking_cancelled' | 'booking_reminder'

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
  readonly status: 'confirmed' | 'cancelled'
}

interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

interface EmailHtmlContent {
  readonly lang: 'sv' | 'en'
  readonly preheader: string
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly rows: readonly { readonly label: string; readonly value: string }[]
  readonly note: string
  readonly linkLabel: string
}

type BookingEmailRequestResult =
  | { readonly ok: true; readonly id: string; readonly event: BookingEmailEvent }
  | { readonly ok: false; readonly error: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseBookingEmailRequest(raw: unknown): BookingEmailRequestResult {
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
  const rawEvent = record.event ?? envelope.event
  if (
    rawEvent !== undefined &&
    rawEvent !== 'booking_confirmed' &&
    rawEvent !== 'booking_cancelled' &&
    rawEvent !== 'booking_reminder'
  ) {
    return {
      ok: false,
      error: 'event must be booking_confirmed, booking_cancelled, or booking_reminder',
    }
  }
  return { ok: true, id: record.id, event: rawEvent ?? 'booking_confirmed' }
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
    (row.lang !== 'sv' && row.lang !== 'en') ||
    (row.status !== 'confirmed' && row.status !== 'cancelled')
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
    status: row.status,
  }
}

async function markBookingReminderDelivered(id: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return false

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('mark_booking_reminder_delivered', { p_id: id })
  return error === null && data === true
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

function detailRowsToHtml(
  rows: readonly { readonly label: string; readonly value: string }[],
): string {
  return rows
    .map(
      (row, index) =>
        `<tr><td style="padding:${index === 0 ? '0 0 16px' : '16px 0'};color:#8e8e93;font-size:14px;line-height:1.4;vertical-align:top;border-bottom:${index === rows.length - 1 ? '0' : '1px solid #2c2c2e'}">${escapeHtml(row.label)}</td><td align="right" style="padding:${index === 0 ? '0 0 16px' : '16px 0'};color:#f5f5f7;font-size:15px;font-weight:600;line-height:1.4;vertical-align:top;border-bottom:${index === rows.length - 1 ? '0' : '1px solid #2c2c2e'}">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('')
}

function wrapHtml(content: EmailHtmlContent): string {
  return `<!doctype html><html lang="${content.lang}" style="color-scheme:dark;supported-color-schemes:dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(content.preheader)}</title></head><body bgcolor="#0a0a0b" style="margin:0;padding:0;background:#0a0a0b;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0a0a0b" style="width:100%;background:#0a0a0b"><tr><td align="center" style="padding:40px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px"><tr><td style="padding:0 0 24px;color:#f5f5f7;font-size:17px;font-weight:700;letter-spacing:-.01em">BLADE &amp; BLEND</td><td align="right" style="padding:0 0 24px;color:#8e8e93;font-size:11px;font-weight:600;letter-spacing:.18em">STUDIO</td></tr><tr><td colspan="2" style="border-top:1px solid #2c2c2e;padding:36px 0 0"><p style="margin:0 0 14px;color:#8e8e93;font-size:11px;font-weight:700;letter-spacing:.16em">${escapeHtml(content.eyebrow)}</p><h1 style="margin:0;color:#f5f5f7;font-size:30px;font-weight:700;letter-spacing:-.035em;line-height:1.15">${escapeHtml(content.title)}</h1><p style="margin:18px 0 32px;color:#c7c7cc;font-size:16px;line-height:1.6">${escapeHtml(content.intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-top:1px solid #2c2c2e;border-bottom:1px solid #2c2c2e;padding:18px 0">${detailRowsToHtml(content.rows)}</table><p style="margin:28px 0 24px;color:#a1a1a6;font-size:14px;line-height:1.65">${escapeHtml(content.note)}</p><a href="https://bladeblendstudio.se" style="display:inline-block;background:#f5f5f7;color:#111113;text-decoration:none;padding:14px 20px;border-radius:8px;font-size:14px;font-weight:700">${escapeHtml(content.linkLabel)}</a><p style="margin:40px 0 0;padding-top:20px;border-top:1px solid #2c2c2e;color:#68686d;font-size:12px;line-height:1.6">Geijersgatan 10, 411 34 Göteborg<br>079-304 36 71</p></td></tr></table></td></tr></table></body></html>`
}

function customerConfirmationMessage(booking: BookingRow): EmailMessage | null {
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
    html: wrapHtml({
      lang: booking.lang,
      preheader:
        booking.lang === 'en'
          ? `Your appointment with ${booking.barberName} is confirmed.`
          : `Din tid hos ${booking.barberName} är bokad.`,
      eyebrow: booking.lang === 'en' ? 'BOOKING CONFIRMATION' : 'BOKNINGSBEKRÄFTELSE',
      title: booking.lang === 'en' ? 'Your appointment is confirmed' : 'Din tid är bokad',
      intro:
        booking.lang === 'en'
          ? `Hi ${booking.customerName}. We look forward to seeing you.`
          : `Hej ${booking.customerName}. Vi ser fram emot ditt besök.`,
      rows: [
        { label: booking.lang === 'en' ? 'Barber' : 'Barberare', value: booking.barberName },
        { label: booking.lang === 'en' ? 'Date' : 'Datum', value: when.date },
        { label: booking.lang === 'en' ? 'Time' : 'Tid', value: when.time },
        { label: booking.lang === 'en' ? 'Service' : 'Behandling', value: booking.serviceName },
        {
          label: booking.lang === 'en' ? 'Price' : 'Pris',
          value: booking.lang === 'en' ? `${booking.price} SEK` : `${booking.price} kr`,
        },
      ],
      note:
        booking.lang === 'en'
          ? 'View or cancel your appointment under My appointments using the phone number entered when booking.'
          : 'Se eller avboka tiden under Mina bokningar med telefonnumret du angav vid bokningen.',
      linkLabel: booking.lang === 'en' ? 'Open website' : 'Öppna hemsidan',
    }),
  }
}

function barberConfirmationMessage(booking: BookingRow): EmailMessage | null {
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
    html: wrapHtml({
      lang: 'sv',
      preheader: `Ny bokning ${when.date} ${when.time}.`,
      eyebrow: 'NY BOKNING',
      title: 'En ny tid är bokad',
      intro: `${booking.customerName} har bokat en tid hos ${booking.barberName}.`,
      rows: [
        { label: 'Datum', value: when.date },
        { label: 'Tid', value: when.time },
        { label: 'Behandling', value: booking.serviceName },
        { label: 'Längd', value: `${booking.durationMin} min` },
        { label: 'Pris', value: `${booking.price} kr` },
        { label: 'Kontakt', value: contact.join(' · ') },
      ],
      note: 'Bokningen finns i adminpanelen tillsammans med kundens kontaktuppgifter.',
      linkLabel: 'Öppna hemsidan',
    }),
  }
}

function customerCancellationMessage(booking: BookingRow): EmailMessage | null {
  if (booking.email === null) return null
  const when = formatWhen(booking)
  const lines =
    booking.lang === 'en'
      ? [
          `Hi ${booking.customerName}, your appointment has been cancelled.`,
          `Barber: ${booking.barberName}`,
          `Time: ${when.date}, ${when.time}`,
          `Service: ${booking.serviceName}`,
          'The cancellation is registered and the appointment is no longer active under “My appointments”.',
        ]
      : [
          `Hej ${booking.customerName}, din tid har avbokats.`,
          `Barberare: ${booking.barberName}`,
          `Tid: ${when.date}, ${when.time}`,
          `Behandling: ${booking.serviceName}`,
          'Avbokningen är registrerad och tiden är inte längre aktiv under ”Mina bokningar”.',
        ]
  return {
    to: booking.email,
    subject:
      booking.lang === 'en'
        ? 'Cancellation confirmation – Blade & Blend Studio'
        : 'Avbokningsbekräftelse – Blade & Blend Studio',
    text: lines.join('\n\n'),
    html: wrapHtml({
      lang: booking.lang,
      preheader:
        booking.lang === 'en'
          ? `Your appointment with ${booking.barberName} has been cancelled.`
          : `Din tid hos ${booking.barberName} har avbokats.`,
      eyebrow: booking.lang === 'en' ? 'CANCELLATION CONFIRMATION' : 'AVBOKNINGSBEKRÄFTELSE',
      title: booking.lang === 'en' ? 'Your appointment is cancelled' : 'Din tid är avbokad',
      intro:
        booking.lang === 'en'
          ? `Hi ${booking.customerName}. Your cancellation has been registered.`
          : `Hej ${booking.customerName}. Din avbokning är registrerad.`,
      rows: [
        { label: booking.lang === 'en' ? 'Barber' : 'Barberare', value: booking.barberName },
        { label: booking.lang === 'en' ? 'Date' : 'Datum', value: when.date },
        { label: booking.lang === 'en' ? 'Time' : 'Tid', value: when.time },
        { label: booking.lang === 'en' ? 'Service' : 'Behandling', value: booking.serviceName },
      ],
      note:
        booking.lang === 'en'
          ? 'The appointment is no longer active under My appointments.'
          : 'Tiden är inte längre aktiv under Mina bokningar.',
      linkLabel: booking.lang === 'en' ? 'Book a new appointment' : 'Boka en ny tid',
    }),
  }
}

function barberCancellationMessage(booking: BookingRow): EmailMessage | null {
  if (booking.barberEmail === null) return null
  const when = formatWhen(booking)
  const contact = [booking.phone, booking.email].filter((value): value is string => value !== null)
  const lines = [
    `Avbokad tid för ${booking.barberName}.`,
    `Tid: ${when.date}, ${when.time}`,
    `Kund: ${booking.customerName}`,
    `Behandling: ${booking.serviceName}`,
    `Kontakt: ${contact.join(' · ')}`,
  ]
  return {
    to: booking.barberEmail,
    subject: `Avbokad tid – ${when.date} ${when.time}`,
    text: lines.join('\n\n'),
    html: wrapHtml({
      lang: 'sv',
      preheader: `Avbokad tid ${when.date} ${when.time}.`,
      eyebrow: 'AVBOKAD TID',
      title: 'En tid har avbokats',
      intro: `${booking.customerName}s tid hos ${booking.barberName} har avbokats.`,
      rows: [
        { label: 'Datum', value: when.date },
        { label: 'Tid', value: when.time },
        { label: 'Kund', value: booking.customerName },
        { label: 'Behandling', value: booking.serviceName },
        { label: 'Kontakt', value: contact.join(' · ') },
      ],
      note: 'Tiden har tagits bort från kommande bokningar.',
      linkLabel: 'Öppna adminpanelen',
    }),
  }
}

function customerReminderMessage(booking: BookingRow): EmailMessage | null {
  if (booking.email === null) return null
  const when = formatWhen(booking)
  const lines =
    booking.lang === 'en'
      ? [
          `Hi ${booking.customerName}, this is a reminder about your appointment tomorrow.`,
          `Barber: ${booking.barberName}`,
          `Time: ${when.date}, ${when.time}`,
          `Service: ${booking.serviceName}`,
          'You can view or cancel the booking under “My appointments” using the phone number entered when booking.',
        ]
      : [
          `Hej ${booking.customerName}, detta är en påminnelse om din bokning i morgon.`,
          `Barberare: ${booking.barberName}`,
          `Tid: ${when.date}, ${when.time}`,
          `Behandling: ${booking.serviceName}`,
          'Du kan se eller avboka tiden under ”Mina bokningar” med telefonnumret du angav vid bokningen.',
        ]
  return {
    to: booking.email,
    subject:
      booking.lang === 'en'
        ? 'Reminder for your appointment tomorrow – Blade & Blend Studio'
        : 'Påminnelse om din bokning i morgon – Blade & Blend Studio',
    text: lines.join('\n\n'),
    html: wrapHtml({
      lang: booking.lang,
      preheader:
        booking.lang === 'en'
          ? `Reminder: your appointment with ${booking.barberName} is tomorrow.`
          : `Påminnelse: din tid hos ${booking.barberName} är i morgon.`,
      eyebrow: booking.lang === 'en' ? 'APPOINTMENT REMINDER' : 'BOKNINGSPÅMINNELSE',
      title: booking.lang === 'en' ? 'See you tomorrow' : 'Vi ses i morgon',
      intro:
        booking.lang === 'en'
          ? `Hi ${booking.customerName}. Your appointment is coming up tomorrow.`
          : `Hej ${booking.customerName}. Din bokade tid är i morgon.`,
      rows: [
        { label: booking.lang === 'en' ? 'Barber' : 'Barberare', value: booking.barberName },
        { label: booking.lang === 'en' ? 'Date' : 'Datum', value: when.date },
        { label: booking.lang === 'en' ? 'Time' : 'Tid', value: when.time },
        { label: booking.lang === 'en' ? 'Service' : 'Behandling', value: booking.serviceName },
      ],
      note:
        booking.lang === 'en'
          ? 'Need to cancel? Open My appointments and verify with the phone number used when booking.'
          : 'Behöver du avboka? Öppna Mina bokningar och verifiera med telefonnumret från bokningen.',
      linkLabel: booking.lang === 'en' ? 'Open My appointments' : 'Öppna Mina bokningar',
    }),
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

  const parsed = parseBookingEmailRequest(raw)
  if (!parsed.ok) return json({ ok: false, error: 'invalid_payload', detail: parsed.error }, 400)

  const booking = await fetchBooking(parsed.id)
  if (booking === null) {
    console.error(`send-confirmation: unreadable booking ${parsed.id}`)
    return json({ ok: false, error: 'booking_not_found' }, 404)
  }

  const expectedStatus = parsed.event === 'booking_cancelled' ? 'cancelled' : 'confirmed'
  if (booking.status !== expectedStatus) {
    console.log(
      `send-confirmation: skipped ${parsed.event} for ${booking.id}; status is ${booking.status}`,
    )
    return json({ ok: true, skipped: 'state_changed', event: parsed.event }, 200)
  }

  const candidates =
    parsed.event === 'booking_confirmed'
      ? [
          { kind: 'customer', message: customerConfirmationMessage(booking) },
          { kind: 'barber', message: barberConfirmationMessage(booking) },
        ]
      : parsed.event === 'booking_cancelled'
        ? [
            { kind: 'customer', message: customerCancellationMessage(booking) },
            { kind: 'barber', message: barberCancellationMessage(booking) },
          ]
        : [{ kind: 'customer', message: customerReminderMessage(booking) }]
  const messages = candidates.filter(
    (entry): entry is { readonly kind: string; readonly message: EmailMessage } =>
      entry.message !== null,
  )

  if (messages.length === 0) {
    if (parsed.event === 'booking_reminder') {
      const marked = await markBookingReminderDelivered(booking.id)
      if (!marked) return json({ ok: false, error: 'reminder_mark_failed' }, 502)
    }
    return json({ ok: true, skipped: 'no_recipients', event: parsed.event }, 200)
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return json({ ok: true, skipped: 'no_resend_configured' }, 200)

  try {
    const idempotencyScope =
      parsed.event === 'booking_confirmed'
        ? 'booking-confirmation'
        : parsed.event === 'booking_cancelled'
          ? 'booking-cancellation'
          : 'booking-reminder'
    for (const entry of messages) {
      await sendViaResend(entry.message, apiKey, `${idempotencyScope}/${entry.kind}/${booking.id}`)
    }
    if (parsed.event === 'booking_reminder') {
      const marked = await markBookingReminderDelivered(booking.id)
      if (!marked) throw new Error('Could not mark booking reminder as delivered')
    }
    console.log(
      `send-confirmation: sent ${parsed.event} to ${messages.map((entry) => entry.kind).join(',')} for ${booking.id}`,
    )
    return json({ ok: true, event: parsed.event, sent: messages.map((entry) => entry.kind) }, 200)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown provider error'
    console.error(`send-confirmation: ${parsed.event} send failed for ${booking.id}: ${detail}`)
    return json({ ok: false, error: 'send_failed', detail }, 502)
  }
})
