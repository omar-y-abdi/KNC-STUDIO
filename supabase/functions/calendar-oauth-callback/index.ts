// calendar-oauth-callback — the Google OAuth redirect target. Google sends the browser here with
// `?code=...&state=...` after the barber consents. This is a TOP-LEVEL browser redirect from
// accounts.google.com, so it carries NO Supabase JWT (config.toml: verify_jwt = false). It is secured
// instead by the HMAC-signed `state` minted by calendar-oauth-start — that both proves the request
// originated from our authenticated start AND carries the barber id to store the token against.
//
// Flow: verify state -> exchange code for a refresh token (server-side, with the client secret) ->
// store the token for the barber -> queue future confirmed bookings for the durable Calendar worker ->
// render a small success page. The refresh token is written ONLY through the service_role definer RPC
// and never leaves the server.
//
// Admin log: this request carries no JWT, so the entry names the one staff account of the signed
// state's barber id (profiles_one_account_per_barber_idx).
//
// Run locally: npx supabase functions serve calendar-oauth-callback --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import { recordOrLogAdminAction, type AdminActionRecord } from '../_shared/adminAudit.ts'
import { decodeIdTokenEmail, exchangeCode, verifyState } from '../_shared/calendar.ts'
import { queueBackfill, type CalendarBackfillService } from '../_shared/calendarBackfill.ts'

const STATE_MAX_AGE_SEC = 600 // the consent round-trip must complete within 10 minutes

/** A minimal, self-contained result page (no external assets — CSP-safe). */
function page(title: string, message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:-apple-system,system-ui,sans-serif;max-width:32rem;margin:12vh auto;padding:0 1.5rem;text-align:center;color:#111"><h1 style="font-size:1.4rem">${title}</h1><p style="color:#555">${message}</p><p>Du kan stänga det här fönstret.</p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
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
  return page(title, message, status)
}

function staffAccountId(row: unknown): string | null {
  if (typeof row !== 'object' || row === null || !('id' in row)) return null
  return typeof row.id === 'string' && row.id !== '' ? row.id : null
}

/** `cleanup_pending` or `repair_pending` means the store renewed a kept link: its Google account and
 * disconnect mark stay. `connected_at` is set only on a new row. */
function storedTokenRecord(
  actorId: string,
  barberId: string,
  hadToken: boolean,
  stored: object,
): AdminActionRecord {
  const renewed =
    ('cleanup_pending' in stored && stored.cleanup_pending === true) ||
    ('repair_pending' in stored && stored.repair_pending === true)
  if (renewed) {
    return {
      actorId,
      action: 'update',
      table: 'barber_calendar_tokens',
      targetId: barberId,
      changedColumns: ['refresh_token', 'calendar_id', 'updated_at', 'last_sync_error'],
    }
  }
  if (!hadToken) {
    return { actorId, action: 'insert', table: 'barber_calendar_tokens', targetId: barberId }
  }
  return {
    actorId,
    action: 'update',
    table: 'barber_calendar_tokens',
    targetId: barberId,
    changedColumns: [
      'refresh_token',
      'google_email',
      'calendar_id',
      'updated_at',
      'last_sync_error',
      'disconnect_requested_at',
    ],
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return page('Fel', 'Ogiltig förfrågan.', 405)

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
    return page('Fel', 'Tjänsten är inte konfigurerad.', 500)
  }

  // User declined consent at Google.
  if (err !== null) return page('Avbröts', 'Kalenderkopplingen avbröts.', 200)
  if (code === null || state === null) return page('Fel', 'Saknar kod eller state.', 400)

  // Verify the signed state — proves the flow started from our authenticated start and yields barber_id.
  const payload = await verifyState(state, stateSecret, STATE_MAX_AGE_SEC, Date.now())
  if (payload === null) return page('Fel', 'Ogiltig eller utgången länk. Försök igen.', 400)
  const fail = (message: string, status: number): Response =>
    done(payload.return_to, 'error', 'Fel', message, status)

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const profile = await service
    .from('profiles')
    .select('id')
    .eq('role', 'barber')
    .eq('barber_id', payload.barber_id)
    .eq('account_enabled', true)
    .maybeSingle()
  if (profile.error !== null || profile.data === null) {
    return fail('Kontot saknar åtkomst. Logga in igen eller kontakta administratören.', 403)
  }

  const existingToken = await service
    .from('barber_calendar_tokens')
    .select('disconnect_requested_at')
    .eq('barber_id', payload.barber_id)
    .maybeSingle()
  if (existingToken.error !== null) {
    return fail('Kunde inte kontrollera kalenderkopplingen. Försök igen.', 500)
  }

  const redirectUri = `${supabaseUrl}/functions/v1/calendar-oauth-callback`
  try {
    const tokens = await exchangeCode(code, clientId, clientSecret, redirectUri)
    if (typeof tokens.refresh_token !== 'string' || tokens.refresh_token === '') {
      // Should not happen with prompt=consent; without a refresh token we cannot sync unattended.
      return fail('Google gav ingen refresh-token. Försök koppla igen.', 400)
    }
    const email = tokens.id_token !== undefined ? decodeIdTokenEmail(tokens.id_token) : null
    if (email === null || email.trim() === '') {
      return fail('Google-kontots e-post kunde inte verifieras. Försök koppla igen.', 400)
    }

    const { data: storeData, error: storeError } = await service.rpc('calendar_store_token', {
      p_barber_id: payload.barber_id,
      p_refresh_token: tokens.refresh_token,
      p_google_email: email.trim(),
      p_calendar_id: 'primary',
    })
    if (storeError) {
      console.error('calendar-oauth-callback: store_token failed:', storeError.message)
      return fail('Kunde inte spara kopplingen. Försök igen.', 500)
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
      return fail(
        error === 'account_mismatch'
          ? 'Välj samma Google-konto som den tidigare kalenderkopplingen.'
          : 'Kunde inte spara kopplingen. Försök igen.',
        error === 'account_mismatch' ? 409 : 500,
      )
    }

    // ADMIN LOG: the database cannot attribute a service-role write; a failed entry is only logged.
    // The signed state comes only from this barber's own signed-in start.
    const actorId = staffAccountId(profile.data)
    if (actorId === null) {
      console.error('calendar-oauth-callback: admin log actor lookup failed:', 'no account id')
    } else {
      await recordOrLogAdminAction(
        'calendar-oauth-callback',
        service,
        storedTokenRecord(actorId, payload.barber_id, existingToken.data !== null, storeData),
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

    // backfill future confirmed bookings as best-effort — the connection is already saved. Any per-booking failure is recorded
    // and surfaced in the calendar settings panel.
    try {
      await queueBackfill(service as unknown as CalendarBackfillService, payload.barber_id)
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
    return fail('Kunde inte slutföra kopplingen. Försök igen.', 502)
  }
})
