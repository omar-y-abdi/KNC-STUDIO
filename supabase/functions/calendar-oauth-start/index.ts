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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildAuthUrl, signState } from '../_shared/calendar.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

/** A same-scheme https origin we may link back to from the callback page (never auto-redirected). */
function safeOrigin(raw: string | null): string | undefined {
  if (raw === null) return undefined
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' ? u.origin : undefined
  } catch {
    return undefined
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
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

  // AUTH GATE (fail-closed): validate JWT, then read the caller's OWN role + barber_id from the DB.
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401)

  const { data: callerData, error: callerError } = await service.auth.getUser(jwt)
  if (callerError || callerData.user === null)
    return json({ ok: false, error: 'unauthorized' }, 401)

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('role, barber_id')
    .eq('id', callerData.user.id)
    .single()
  if (profileError || profile === null) return json({ ok: false, error: 'unauthorized' }, 401)

  // Only a linked barber connects a personal calendar. An owner (no barber_id) is refused — consent
  // requires the barber's own Google login, which the owner cannot perform on their behalf.
  const barberId = profile.role === 'barber' ? profile.barber_id : null
  if (typeof barberId !== 'string' || barberId === '') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  // Bind the barber id into a short-lived signed state (CSRF + identity). iat in epoch seconds.
  const nowSec = Math.floor(Date.now() / 1000)
  const returnTo = safeOrigin(req.headers.get('origin'))
  const state = await signState(
    returnTo === undefined
      ? { barber_id: barberId, iat: nowSec }
      : { barber_id: barberId, iat: nowSec, return_to: returnTo },
    stateSecret,
  )

  const redirectUri = `${supabaseUrl}/functions/v1/calendar-oauth-callback`
  return json({ ok: true, url: buildAuthUrl(clientId, redirectUri, state) }, 200)
})
