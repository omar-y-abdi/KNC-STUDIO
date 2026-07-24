// calendar-sync — pushes a booking change into the affected barber's Google Calendar. Invoked by a
// bookings INSERT/UPDATE/DELETE Database Webhook (server -> server, no user JWT: verify_jwt = false),
// secured by the shared WEBHOOK_SECRET header (fail-closed), exactly like send-confirmation.
//
// DB-authoritative: only the booking id is taken from the (untrusted) webhook body; every field used
// to build the event — and the barber's credentials — is re-read from the DB via service_role definer
// RPCs. A forged payload can neither target another calendar nor alter an event's contents.
//
//   INSERT           -> insert event, map booking -> event id
//   UPDATE confirmed -> patch the mapped event (re-insert if Google lost it)
//   UPDATE cancelled -> delete the mapped event, forget the mapping
//   DELETE           -> delete the mapped event (row already gone), forget the mapping
//   (barber not connected -> no-op)
//
// Run locally: npx supabase functions serve calendar-sync --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildEvent,
  deleteEvent,
  insertEvent,
  patchEvent,
  refreshAccessToken,
} from '../_shared/calendar.ts'

type WebhookOp = 'INSERT' | 'UPDATE' | 'DELETE'

interface WebhookEnvelope {
  readonly type?: string
  readonly record?: unknown
  readonly old_record?: unknown
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** Extract (op, bookingId) from the webhook envelope. id comes from `record` (INSERT/UPDATE) or
 *  `old_record` (DELETE — the row is already gone). */
function parseEnvelope(raw: unknown): { op: WebhookOp; id: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const env = raw as WebhookEnvelope
  const op = env.type
  if (op !== 'INSERT' && op !== 'UPDATE' && op !== 'DELETE') return null
  const source = op === 'DELETE' ? env.old_record : env.record
  if (typeof source !== 'object' || source === null) return null
  const id = (source as Record<string, unknown>)['id']
  if (!isNonEmptyString(id)) return null
  return { op, id }
}

interface SyncSource {
  readonly barber_id: string
  readonly service_name: string
  readonly customer_name: string
  readonly phone: string | null
  readonly start_at: string
  readonly end_at: string
  readonly status: 'confirmed' | 'cancelled'
  readonly refresh_token: string | null
  readonly calendar_id: string
  readonly google_event_id: string | null
}

/** Handle INSERT/UPDATE: re-read the booking + credentials, then insert/patch/delete accordingly.
 *  Returns a short outcome string for the response body. Throws on Google/API failure (caller records
 *  the error against the barber and returns 5xx so the webhook may retry). */
async function syncUpsert(
  service: SupabaseClient,
  bookingId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ outcome: string; barberId: string | null }> {
  const { data, error } = await service.rpc('calendar_sync_source', { p_booking_id: bookingId })
  if (error) throw new Error(`sync_source: ${error.message}`)
  if (data === null || typeof data !== 'object') return { outcome: 'booking_gone', barberId: null }
  const s = data as unknown as SyncSource

  // Barber has not connected a calendar -> nothing to do.
  if (!isNonEmptyString(s.refresh_token)) return { outcome: 'not_connected', barberId: s.barber_id }

  const accessToken = await refreshAccessToken(s.refresh_token, clientId, clientSecret)

  // A cancelled booking should not occupy the calendar: remove any mapped event.
  if (s.status === 'cancelled') {
    if (isNonEmptyString(s.google_event_id)) {
      await deleteEvent(accessToken, s.calendar_id, s.google_event_id)
      await service.rpc('calendar_forget_event', { p_booking_id: bookingId })
    }
    return { outcome: 'cancelled_removed', barberId: s.barber_id }
  }

  const event = buildEvent(s)
  if (isNonEmptyString(s.google_event_id)) {
    const patched = await patchEvent(accessToken, s.calendar_id, s.google_event_id, event)
    if (patched) return { outcome: 'patched', barberId: s.barber_id }
    // Google lost the event — re-insert and re-map.
  }
  const eventId = await insertEvent(accessToken, s.calendar_id, event)
  await service.rpc('calendar_record_event', {
    p_booking_id: bookingId,
    p_barber_id: s.barber_id,
    p_google_event_id: eventId,
  })
  return { outcome: 'inserted', barberId: s.barber_id }
}

/** Handle DELETE: the booking row is gone, so read the mapping + credentials, delete the Google event,
 *  and forget the mapping. */
async function syncDelete(
  service: SupabaseClient,
  bookingId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ outcome: string; barberId: string | null }> {
  const { data, error } = await service.rpc('calendar_deletion_context', { p_booking_id: bookingId })
  if (error) throw new Error(`deletion_context: ${error.message}`)
  if (data === null || typeof data !== 'object') return { outcome: 'nothing_mapped', barberId: null }
  const d = data as Record<string, unknown>
  const eventId = d['google_event_id']
  const refreshToken = d['refresh_token']
  const calendarId = typeof d['calendar_id'] === 'string' ? d['calendar_id'] : 'primary'
  if (!isNonEmptyString(eventId) || !isNonEmptyString(refreshToken)) {
    return { outcome: 'nothing_mapped', barberId: null }
  }
  const accessToken = await refreshAccessToken(refreshToken, clientId, clientSecret)
  await deleteEvent(accessToken, calendarId, eventId)
  await service.rpc('calendar_forget_event', { p_booking_id: bookingId })
  return { outcome: 'deleted', barberId: null }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  // Shared-secret gate — FAIL-CLOSED (the only auth on this server->server function).
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  if (!webhookSecret) return json({ ok: false, error: 'not_configured' }, 503)
  if (req.headers.get('x-webhook-secret') !== webhookSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    console.error('calendar-sync: missing env')
    return json({ ok: false, error: 'not_configured' }, 500)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  const parsed = parseEnvelope(raw)
  if (parsed === null) return json({ ok: false, error: 'invalid_payload' }, 400)

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  try {
    const result =
      parsed.op === 'DELETE'
        ? await syncDelete(service, parsed.id, clientId, clientSecret)
        : await syncUpsert(service, parsed.id, clientId, clientSecret)
    console.log(`calendar-sync: ${parsed.op} booking ${parsed.id} -> ${result.outcome}`)
    return json({ ok: true, outcome: result.outcome }, 200)
  } catch (syncErr) {
    const message = syncErr instanceof Error ? syncErr.message : 'unknown'
    console.error(`calendar-sync: ${parsed.op} booking ${parsed.id} failed:`, message)
    // Best-effort: record the error against the barber if we can identify them from the booking.
    try {
      const { data } = await service.rpc('calendar_sync_source', { p_booking_id: parsed.id })
      const barberId =
        data !== null && typeof data === 'object'
          ? (data as Record<string, unknown>)['barber_id']
          : null
      if (isNonEmptyString(barberId)) {
        await service.rpc('calendar_record_error', { p_barber_id: barberId, p_error: message })
      }
    } catch {
      // ignore — error recording is best-effort
    }
    // 5xx so the Database Webhook retries a transient Google/API failure.
    return json({ ok: false, error: 'sync_failed' }, 500)
  }
})
