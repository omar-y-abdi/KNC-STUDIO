// calendar-oauth-start — returns the Google consent URL for the SIGNED-IN barber to connect their
// Google Calendar. Invoked from the admin panel with the barber's Supabase JWT (verify_jwt = true).
//
// Identity is DB-derived, NEVER client-supplied: we validate the JWT via auth.getUser() and read the
// caller's own profiles row (role + barber_id). Only a linked barber may connect (an owner's
// current_barber_id() is null — they cannot consent for someone else's Google account). The resolved
// barber_id is bound into an HMAC-signed `state`; the callback trusts ONLY that signed state, so a
// user can never connect another barber's calendar.
//
// SECURITY BOUNDARY: the service-role key and Google client id stay server-side. The response carries
// only the consent URL. Run locally:
//   npx supabase functions serve calendar-oauth-start --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import { buildAuthUrl, signState } from '../_shared/calendar.ts'
import { callerBarberId, json } from '../_shared/calendarCaller.ts'
import { staffCors } from '../_shared/staffCors.ts'

const DEFAULT_ORIGINS = ['https://bladeblendstudio.se', 'https://www.bladeblendstudio.se']

/** Read exactly as `allowedOrigins` in public-booking-actions/index.ts reads them. */
function siteOrigins(configured: string | undefined): readonly string[] {
  if (!configured) return DEFAULT_ORIGINS
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

type ReturnOrigin =
  | { readonly kind: 'none' }
  | { readonly kind: 'site'; readonly origin: string }
  | { readonly kind: 'foreign' }

/** A missing, unreadable or http Origin (local development) gives none: the callback shows its own
 *  page. An https origin not of the site is foreign and refused. */
function returnOrigin(raw: string | null, allowed: readonly string[]): ReturnOrigin {
  if (raw === null) return { kind: 'none' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { kind: 'none' }
  }
  if (url.protocol !== 'https:') return { kind: 'none' }
  return allowed.includes(url.origin) ? { kind: 'site', origin: url.origin } : { kind: 'foreign' }
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
  const stateSecret = Deno.env.get('CALENDAR_STATE_SECRET')
  if (!supabaseUrl || !serviceKey || !clientId || !stateSecret) {
    console.error(
      'calendar-oauth-start: missing env (SUPABASE_*, GOOGLE_OAUTH_CLIENT_ID, CALENDAR_STATE_SECRET)',
    )
    return json({ ok: false, error: 'not_configured' }, 500)
  }
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Only a linked barber connects a personal calendar. An owner (no barber_id) is refused — consent
  // requires the barber's own Google login, which the owner cannot perform on their behalf.
  const barberId = await callerBarberId(req, service)
  if (barberId instanceof Response) return barberId

  const returnTo = returnOrigin(
    req.headers.get('origin'),
    siteOrigins(Deno.env.get('PUBLIC_SITE_ORIGINS')),
  )
  if (returnTo.kind === 'foreign') return json({ ok: false, error: 'origin_not_allowed' }, 403)

  // Bind the barber id into a short-lived signed state (CSRF + identity). iat in epoch seconds.
  const nowSec = Math.floor(Date.now() / 1000)
  const state = await signState(
    returnTo.kind === 'none'
      ? { barber_id: barberId, iat: nowSec }
      : { barber_id: barberId, iat: nowSec, return_to: returnTo.origin },
    stateSecret,
  )

  const redirectUri = `${supabaseUrl}/functions/v1/calendar-oauth-callback`
  return json({ ok: true, url: buildAuthUrl(clientId, redirectUri, state) }, 200)
}

Deno.serve(staffCors(Deno.env.get('CMS_ALLOWED_ORIGINS'), handle))
