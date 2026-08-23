import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  buildEmailMessage,
  defaultEmailTemplate,
  loadEmailBusiness,
  loadEmailTemplate,
  sendViaResend,
  type EmailDetailRow,
  type EmailBusiness,
  type EmailMessage,
  type EmailTemplateName,
} from '../_shared/email.ts'
import { timingSafeEqual } from '../_shared/calendar.ts'

interface WebhookEnvelope {
  readonly record?: unknown
  readonly event?: unknown
}
type BookingEmailEvent = 'booking_confirmed' | 'booking_cancelled' | 'booking_reminder'
type DeliveryStatus = 'delivered' | 'skipped' | 'superseded'
type DeliveryKind = 'customer' | 'barber'
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
type RequestResult =
  | {
      readonly ok: true
      readonly id: string | null
      readonly event: BookingEmailEvent | null
      readonly deliveryId: string | null
    }
  | { readonly ok: false; readonly error: string }
interface DeliveryJob {
  readonly bookingId: string
  readonly event: Exclude<BookingEmailEvent, 'booking_reminder'>
  readonly sentKinds: readonly DeliveryKind[]
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
function nullableString(value: unknown): string | null {
  return nonEmpty(value) ? value : null
}
function isDeliveryKind(value: unknown): value is DeliveryKind {
  return value === 'customer' || value === 'barber'
}
function parseRequest(raw: unknown): RequestResult {
  if (typeof raw !== 'object' || raw === null)
    return { ok: false, error: 'payload must be an object' }
  const envelope = raw as WebhookEnvelope
  const candidate: unknown = envelope.record === undefined ? raw : envelope.record
  if (typeof candidate !== 'object' || candidate === null)
    return { ok: false, error: 'missing record' }
  const record = candidate as Record<string, unknown>
  if (nonEmpty(record.delivery_id)) {
    return { ok: true, id: null, event: null, deliveryId: record.delivery_id }
  }
  if (!nonEmpty(record.id)) return { ok: false, error: 'id is required' }
  const event = record.event ?? envelope.event ?? 'booking_confirmed'
  if (
    event !== 'booking_confirmed' &&
    event !== 'booking_cancelled' &&
    event !== 'booking_reminder'
  ) {
    return { ok: false, error: 'invalid event' }
  }
  return { ok: true, id: record.id, event, deliveryId: null }
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
}

async function fetchBooking(id: string): Promise<BookingRow | null> {
  const client = serviceClient()
  if (client === null) return null
  const { data, error } = await client.rpc('booking_confirmation_details', { p_id: id })
  if (error || typeof data !== 'object' || data === null) return null
  const row = data as Record<string, unknown>
  if (
    !nonEmpty(row.id) ||
    !nonEmpty(row.customer_name) ||
    !nonEmpty(row.start_at) ||
    !nonEmpty(row.service_name) ||
    typeof row.price !== 'number' ||
    typeof row.duration_min !== 'number' ||
    !nonEmpty(row.barber_name) ||
    (row.lang !== 'sv' && row.lang !== 'en') ||
    (row.status !== 'confirmed' && row.status !== 'cancelled')
  )
    return null
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

async function fetchDelivery(id: string): Promise<DeliveryJob | null | 'unavailable'> {
  const client = serviceClient()
  if (client === null) return 'unavailable'
  const { data, error } = await client.rpc('booking_email_delivery_for_dispatch', { p_id: id })
  if (error) return 'unavailable'
  if (typeof data !== 'object' || data === null) return null
  const row = data as Record<string, unknown>
  if (!nonEmpty(row.booking_id) || !Array.isArray(row.sent_kinds)) return null
  if (row.event !== 'booking_confirmed' && row.event !== 'booking_cancelled') return null
  if (!row.sent_kinds.every(isDeliveryKind)) return null
  return { bookingId: row.booking_id, event: row.event, sentKinds: row.sent_kinds }
}

async function completeDelivery(id: string, status: DeliveryStatus): Promise<boolean> {
  const client = serviceClient()
  if (client === null) return false
  const { data, error } = await client.rpc('complete_booking_email_delivery', {
    p_id: id,
    p_status: status,
  })
  return error === null && data === true
}

async function failDelivery(
  id: string,
  errorCode: 'not_configured' | 'send_failed' | 'message_build_failed',
) {
  const client = serviceClient()
  if (client === null) return
  await client.rpc('fail_booking_email_delivery', { p_id: id, p_error_code: errorCode })
}

async function markDeliveryRecipient(id: string, kind: DeliveryKind): Promise<boolean> {
  const client = serviceClient()
  if (client === null) return false
  const { data, error } = await client.rpc('mark_booking_email_delivery_recipient', {
    p_id: id,
    p_kind: kind,
  })
  return error === null && data === true
}

async function markReminder(id: string): Promise<boolean> {
  const client = serviceClient()
  if (client === null) return false
  const { data, error } = await client.rpc('mark_booking_reminder_delivered', { p_id: id })
  return error === null && data === true
}

function formatWhen(booking: BookingRow): { readonly date: string; readonly time: string } {
  const when = new Date(booking.startAt)
  const date = new Intl.DateTimeFormat(booking.lang === 'en' ? 'en-GB' : 'sv-SE', {
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

function variables(booking: BookingRow, business: EmailBusiness): Readonly<Record<string, string>> {
  const when = formatWhen(booking)
  return {
    customer_name: booking.customerName,
    barber_name: booking.barberName,
    booking_date: when.date,
    booking_time: when.time,
    cancellation_hours: String(business.cancellationPolicyHours),
  }
}

function customerRows(booking: BookingRow): readonly EmailDetailRow[] {
  const when = formatWhen(booking)
  return [
    { label: booking.lang === 'en' ? 'Barber' : 'Barberare', value: booking.barberName },
    { label: booking.lang === 'en' ? 'Date' : 'Datum', value: when.date },
    { label: booking.lang === 'en' ? 'Time' : 'Tid', value: when.time },
    { label: booking.lang === 'en' ? 'Service' : 'Behandling', value: booking.serviceName },
    {
      label: booking.lang === 'en' ? 'Price' : 'Pris',
      value: booking.lang === 'en' ? `${booking.price} SEK` : `${booking.price} kr`,
    },
  ]
}

function barberRows(booking: BookingRow): readonly EmailDetailRow[] {
  const when = formatWhen(booking)
  const contact = [booking.phone, booking.email]
    .filter((value): value is string => value !== null)
    .join(' · ')
  return [
    { label: 'Datum', value: when.date },
    { label: 'Tid', value: when.time },
    { label: 'Kund', value: booking.customerName },
    { label: 'Behandling', value: booking.serviceName },
    { label: 'Längd', value: `${booking.durationMin} min` },
    { label: 'Pris', value: `${booking.price} kr` },
    { label: 'Kontakt', value: contact },
  ]
}

async function message(
  booking: BookingRow,
  to: string,
  templateName: EmailTemplateName,
  rows: readonly EmailDetailRow[],
  business: EmailBusiness,
  adminLink = false,
): Promise<EmailMessage> {
  const client = serviceClient()
  const lang = templateName.startsWith('barber_') ? 'sv' : booking.lang
  const copy =
    client === null
      ? defaultEmailTemplate(templateName, lang)
      : await loadEmailTemplate(client, templateName, lang)
  return buildEmailMessage({
    to,
    lang,
    copy,
    variables: variables(booking, business),
    rows,
    ctaHref: adminLink ? 'https://bladeblendstudio.se/admin' : 'https://bladeblendstudio.se',
    business,
  })
}

async function buildMessages(
  event: BookingEmailEvent,
  booking: BookingRow,
  business: EmailBusiness,
): Promise<readonly { kind: DeliveryKind; message: EmailMessage }[]> {
  const candidates: Array<Promise<{ kind: DeliveryKind; message: EmailMessage }> | null> =
    event === 'booking_confirmed'
      ? [
          booking.email === null
            ? null
            : message(
                booking,
                booking.email,
                'customer_confirmation',
                customerRows(booking),
                business,
              ).then((message) => ({ kind: 'customer', message })),
          booking.barberEmail === null
            ? null
            : message(
                booking,
                booking.barberEmail,
                'barber_confirmation',
                barberRows(booking),
                business,
                true,
              ).then((message) => ({ kind: 'barber', message })),
        ]
      : event === 'booking_cancelled'
        ? [
            booking.email === null
              ? null
              : message(
                  booking,
                  booking.email,
                  'customer_cancellation',
                  customerRows(booking),
                  business,
                ).then((message) => ({ kind: 'customer', message })),
            booking.barberEmail === null
              ? null
              : message(
                  booking,
                  booking.barberEmail,
                  'barber_cancellation',
                  barberRows(booking),
                  business,
                  true,
                ).then((message) => ({ kind: 'barber', message })),
          ]
        : [
            booking.email === null
              ? null
              : message(
                  booking,
                  booking.email,
                  'customer_reminder',
                  customerRows(booking),
                  business,
                ).then((message) => ({ kind: 'customer', message })),
          ]
  return Promise.all(
    candidates.filter(
      (candidate): candidate is Promise<{ kind: DeliveryKind; message: EmailMessage }> =>
        candidate !== null,
    ),
  )
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const secret = Deno.env.get('WEBHOOK_SECRET')
  if (!secret) return json({ ok: false, error: 'not_configured' }, 503)
  if (!timingSafeEqual(req.headers.get('x-webhook-secret') ?? '', secret))
    return json({ ok: false, error: 'unauthorized' }, 401)
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  const parsed = parseRequest(raw)
  if (!parsed.ok) return json({ ok: false, error: 'invalid_payload', detail: parsed.error }, 400)
  if (serviceClient() === null) return json({ ok: false, error: 'not_configured' }, 503)

  let bookingId = parsed.id
  let event = parsed.event
  let delivery: DeliveryJob | null = null
  if (parsed.deliveryId !== null) {
    const fetchedDelivery = await fetchDelivery(parsed.deliveryId)
    if (fetchedDelivery === 'unavailable')
      return json({ ok: false, error: 'delivery_unavailable' }, 503)
    if (fetchedDelivery === null) return json({ ok: true, skipped: 'delivery_not_pending' }, 200)
    delivery = fetchedDelivery
    bookingId = delivery.bookingId
    event = delivery.event
  }
  if (bookingId === null || event === null)
    return json({ ok: false, error: 'invalid_payload' }, 400)

  const booking = await fetchBooking(bookingId)
  if (booking === null) return json({ ok: false, error: 'booking_not_found' }, 404)
  const expected = event === 'booking_cancelled' ? 'cancelled' : 'confirmed'
  if (booking.status !== expected) {
    if (parsed.deliveryId !== null && !(await completeDelivery(parsed.deliveryId, 'superseded')))
      return json({ ok: false, error: 'delivery_update_failed' }, 502)
    return json({ ok: true, skipped: 'state_changed' }, 200)
  }

  let messages: readonly { kind: DeliveryKind; message: EmailMessage }[]
  try {
    const client = serviceClient()
    if (client === null) throw new Error('service client unavailable')
    const business = await loadEmailBusiness(client)
    messages = await buildMessages(event, booking, business)
  } catch {
    if (parsed.deliveryId !== null) await failDelivery(parsed.deliveryId, 'message_build_failed')
    console.error('send-confirmation message build failed', {
      event,
      queued: parsed.deliveryId !== null,
    })
    return json({ ok: false, error: 'message_build_failed' }, 502)
  }
  if (messages.length === 0) {
    if (event === 'booking_reminder' && !(await markReminder(booking.id))) {
      return json({ ok: false, error: 'reminder_mark_failed' }, 502)
    }
    if (parsed.deliveryId !== null && !(await completeDelivery(parsed.deliveryId, 'skipped')))
      return json({ ok: false, error: 'delivery_update_failed' }, 502)
    return json({ ok: true, skipped: 'no_recipients' }, 200)
  }
  const messagesToSend =
    delivery === null
      ? messages
      : messages.filter((entry) => !delivery.sentKinds.includes(entry.kind))
  if (messagesToSend.length === 0) {
    if (parsed.deliveryId !== null && !(await completeDelivery(parsed.deliveryId, 'delivered')))
      return json({ ok: false, error: 'delivery_update_failed' }, 502)
    return json({ ok: true, event, sent: [] }, 200)
  }
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    if (parsed.deliveryId !== null) await failDelivery(parsed.deliveryId, 'not_configured')
    return json({ ok: false, error: 'not_configured' }, 503)
  }
  try {
    const scope =
      event === 'booking_confirmed'
        ? 'booking-confirmation'
        : event === 'booking_cancelled'
          ? 'booking-cancellation'
          : 'booking-reminder'
    for (const entry of messagesToSend) {
      await sendViaResend(entry.message, apiKey, `${scope}/${entry.kind}/${booking.id}`)
      if (
        parsed.deliveryId !== null &&
        !(await markDeliveryRecipient(parsed.deliveryId, entry.kind))
      )
        throw new Error('recipient delivery update failed')
    }
    if (event === 'booking_reminder' && !(await markReminder(booking.id)))
      throw new Error('reminder mark failed')
    if (parsed.deliveryId !== null && !(await completeDelivery(parsed.deliveryId, 'delivered')))
      throw new Error('delivery update failed')
    return json({ ok: true, event, sent: messagesToSend.map((entry) => entry.kind) }, 200)
  } catch {
    if (parsed.deliveryId !== null) await failDelivery(parsed.deliveryId, 'send_failed')
    console.error('send-confirmation delivery failed', {
      event,
      queued: parsed.deliveryId !== null,
    })
    return json({ ok: false, error: 'send_failed' }, 502)
  }
})
