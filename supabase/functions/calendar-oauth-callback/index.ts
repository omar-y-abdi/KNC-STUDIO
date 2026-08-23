// calendar-oauth-callback — the Google OAuth redirect target. Google sends the browser here with
// `?code=...&state=...` after the barber consents. This is a TOP-LEVEL browser redirect from
// accounts.google.com, so it carries NO Supabase JWT (config.toml: verify_jwt = false). It is secured
// instead by the HMAC-signed `state` minted by calendar-oauth-start — that both proves the request
// originated from our authenticated start AND carries the barber id to store the token against.
//
// Flow: verify state -> exchange code for a refresh token (server-side, with the client secret) ->
// store the token for the barber -> backfill future confirmed bookings into Google Calendar ->
// render a small success page. The refresh token is written ONLY through the service_role definer RPC
// and never leaves the server.
//
// Run locally: npx supabase functions serve calendar-oauth-callback --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  buildEvent,
  decodeIdTokenEmail,
  exchangeCode,
  googleEventId,
  insertEvent,
  refreshAccessToken,
  verifyState,
  withGoogleRetry,
} from '../_shared/calendar.ts'
import type { BookingEventInput } from '../_shared/calendar.ts'

const STATE_MAX_AGE_SEC = 600 // the consent round-trip must complete within 10 minutes

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/** A minimal, self-contained result page (no external assets — CSP-safe). */
function page(title: string, message: string, returnTo: string | undefined): string {
  const link =
    returnTo !== undefined
      ? `<p><a href="${returnTo}/admin" style="color:#0a7">Tillbaka till appen</a></p>`
      : '<p>Du kan stänga det här fönstret.</p>'
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:-apple-system,system-ui,sans-serif;max-width:32rem;margin:12vh auto;padding:0 1.5rem;text-align:center;color:#111"><h1 style="font-size:1.4rem">${title}</h1><p style="color:#555">${message}</p>${link}</body></html>`
}

/** Finish the consent round-trip. Prefer redirecting the barber straight back INTO the app — they land
 *  on /admin, where the panel already reflects the new state — instead of stranding them on this
 *  supabase.co page. Fall back to the standalone page only when the signed state carried no app origin.
 *  `outcome` becomes a `?calendar=` hint the app MAY surface. return_to was HMAC-signed + https-checked
 *  in calendar-oauth-start, so this redirect target is trusted. */
function done(
  returnTo: string | undefined,
  outcome: 'connected' | 'error',
  title: string,
  message: string,
  status: number,
): Response {
  if (returnTo !== undefined) {
    return new Response(null, {
      status: 303,
      headers: { location: `${returnTo}/admin?calendar=${outcome}` },
    })
  }
  return html(page(title, message, returnTo), status)
}

interface BackfillBooking extends BookingEventInput {
  readonly id: string
  readonly google_event_id: string | null
}

/** Push every future confirmed booking that is not already mapped into the barber's calendar. Best-effort:
 *  a per-booking failure is recorded and skipped so one bad row never aborts the whole backfill. */
async function backfill(
  service: SupabaseClient,
  barberId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const { data, error } = await service.rpc('calendar_backfill_source', { p_barber_id: barberId })
  if (error || data === null || typeof data !== 'object') return
  const d = data as Record<string, unknown>
  const refreshToken = d['refresh_token']
  const calendarId = typeof d['calendar_id'] === 'string' ? d['calendar_id'] : 'primary'
  const rows = Array.isArray(d['bookings']) ? (d['bookings'] as BackfillBooking[]) : []
  if (typeof refreshToken !== 'string' || rows.length === 0) return

  // Mint the access token WITH retry. This is the step whose silent throw used to abort the whole
  // backfill on a first-connect transient (e.g. the Calendar API's cold-start 403) — leaving zero
  // events AND no recorded error. If it still fails after retries, RECORD it (surfaced in the panel)
  // instead of swallowing, so the failure is visible and a reconnect isn't the only clue.
  let accessToken: string
  try {
    accessToken = await withGoogleRetry(
      () => refreshAccessToken(refreshToken, clientId, clientSecret),
      { retries: 3, delayMs: 500 },
    )
  } catch (err) {
    await service.rpc('calendar_record_error', {
      p_barber_id: barberId,
      p_error: `backfill setup: ${err instanceof Error ? err.message : 'unknown'}`,
    })
    return
  }

  for (const b of rows) {
    if (b.google_event_id !== null) continue // already synced
    try {
      // Retry each insert independently — a thrown insert created nothing, so a retry can't duplicate.
      const eventId = await withGoogleRetry(
        () => insertEvent(accessToken, calendarId, googleEventId(b.id), buildEvent(b)),
        { retries: 2, delayMs: 500 },
      )
      const { error: recordError } = await service.rpc('calendar_record_event', {
        p_booking_id: b.id,
        p_barber_id: barberId,
        p_google_event_id: eventId,
      })
      if (recordError) throw new Error(`record_event: ${recordError.message}`)
    } catch (err) {
      await service.rpc('calendar_record_error', {
        p_barber_id: barberId,
        p_error: `backfill ${b.id}: ${err instanceof Error ? err.message : 'unknown'}`,
      })
    }
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return html(page('Fel', 'Ogiltig förfrågan.', undefined), 405)

  const url = new URL(req.url)
  const err = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const stateSecret = Deno.env.get('CALENDAR_STATE_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!stateSecret || !supabaseUrl || !serviceKey || !clientId || !clientSecret) {
    console.error('calendar-oauth-callback: missing env')
    return html(page('Fel', 'Tjänsten är inte konfigurerad.', undefined), 500)
  }

  // User declined consent at Google.
  if (err !== null) return html(page('Avbröts', 'Kalenderkopplingen avbröts.', undefined), 200)
  if (code === null || state === null) {
    return html(page('Fel', 'Saknar kod eller state.', undefined), 400)
  }

  // Verify the signed state — proves the flow started from our authenticated start and yields barber_id.
  const payload = await verifyState(state, stateSecret, STATE_MAX_AGE_SEC, Date.now())
  if (payload === null)
    return html(page('Fel', 'Ogiltig eller utgången länk. Försök igen.', undefined), 400)

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const profile = await service
    .from('profiles')
    .select('id')
    .eq('role', 'barber')
    .eq('barber_id', payload.barber_id)
    .eq('account_enabled', true)
    .maybeSingle()
  if (profile.error !== null || profile.data === null) {
    return done(
      payload.return_to,
      'error',
      'Fel',
      'Kontot saknar åtkomst. Logga in igen eller kontakta administratören.',
      403,
    )
  }

  const existingToken = await service
    .from('barber_calendar_tokens')
    .select('disconnect_requested_at')
    .eq('barber_id', payload.barber_id)
    .maybeSingle()
  if (existingToken.error !== null) {
    return done(
      payload.return_to,
      'error',
      'Fel',
      'Kunde inte kontrollera kalenderkopplingen. Försök igen.',
      500,
    )
  }

  const redirectUri = `${supabaseUrl}/functions/v1/calendar-oauth-callback`
  try {
    const tokens = await exchangeCode(code, clientId, clientSecret, redirectUri)
    if (typeof tokens.refresh_token !== 'string' || tokens.refresh_token === '') {
      // Should not happen with prompt=consent; without a refresh token we cannot sync unattended.
      return done(
        payload.return_to,
        'error',
        'Fel',
        'Google gav ingen refresh-token. Försök koppla igen.',
        400,
      )
    }
    const email = tokens.id_token !== undefined ? decodeIdTokenEmail(tokens.id_token) : null

    const { data: storeData, error: storeError } = await service.rpc('calendar_store_token', {
      p_barber_id: payload.barber_id,
      p_refresh_token: tokens.refresh_token,
      p_google_email: email,
      p_calendar_id: 'primary',
    })
    if (storeError) {
      console.error('calendar-oauth-callback: store_token failed:', storeError.message)
      return done(
        payload.return_to,
        'error',
        'Fel',
        'Kunde inte spara kopplingen. Försök igen.',
        500,
      )
    }

    if (
      typeof storeData !== 'object' ||
      storeData === null ||
      (storeData as Record<string, unknown>)['ok'] !== true
    ) {
      const error =
        typeof storeData === 'object' && storeData !== null
          ? (storeData as Record<string, unknown>)['error']
          : null
      return done(
        payload.return_to,
        'error',
        'Fel',
        error === 'account_mismatch'
          ? 'Välj samma Google-konto som den tidigare kalenderkopplingen.'
          : 'Kunde inte spara kopplingen. Försök igen.',
        error === 'account_mismatch' ? 409 : 500,
      )
    }

    if ((storeData as Record<string, unknown>)['cleanup_pending'] === true) {
      return done(
        payload.return_to,
        'connected',
        'Google-åtkomst återställd',
        'Kalenderhändelserna tas nu bort säkert. Kopplingen stängs automatiskt efteråt.',
        200,
      )
    }

    // Backfill is best-effort — the connection is already saved. Any per-booking failure is recorded
    // and surfaced in the calendar settings panel.
    try {
      await backfill(service, payload.barber_id, clientId, clientSecret)
    } catch (backfillErr) {
      console.error('calendar-oauth-callback: backfill error:', backfillErr)
    }

    return done(
      payload.return_to,
      'connected',
      'Kalender kopplad!',
      'Dina bokningar dyker upp i Google Calendar-appen.',
      200,
    )
  } catch (exchangeErr) {
    console.error('calendar-oauth-callback: exchange error:', exchangeErr)
    return done(
      payload.return_to,
      'error',
      'Fel',
      'Kunde inte slutföra kopplingen. Försök igen.',
      502,
    )
  }
})
