// calendar-disconnect — the signed-in barber unlinks their Google Calendar. Invoked from the admin
// panel with the barber's JWT (verify_jwt = true). Identity is DB-derived (auth.getUser + profiles);
// a barber can only disconnect THEIR OWN calendar.
//
// Effect: delete_token returns the stored refresh token (so we can best-effort revoke it at Google),
// then removes the token row + the barber's event mappings. Existing events already pushed into the
// barber's calendar are left in place (they are real past/future bookings); a future reconnect
// re-backfills from scratch.
//
// Run locally: npx supabase functions serve calendar-disconnect --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { revokeToken } from '../_shared/calendar.ts'

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('calendar-disconnect: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    return json({ ok: false, error: 'not_configured' }, 500)
  }
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

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

  const barberId = profile.role === 'barber' ? profile.barber_id : null
  if (typeof barberId !== 'string' || barberId === '') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  const { data: token, error: deleteError } = await service.rpc('calendar_delete_token', {
    p_barber_id: barberId,
  })
  if (deleteError) {
    console.error('calendar-disconnect: delete_token failed:', deleteError.message)
    return json({ ok: false, error: 'disconnect_failed' }, 500)
  }
  // Best-effort revoke at Google (this is what removes the app from the barber's "third-party access"
  // and frees an unverified-app user slot). The token row is already gone regardless; a failed revoke
  // is logged, not fatal.
  if (typeof token === 'string' && token !== '') {
    const revoked = await revokeToken(token)
    if (!revoked)
      console.error(`calendar-disconnect: google revoke did not confirm for barber ${barberId}`)
  }

  return json({ ok: true }, 200)
})
