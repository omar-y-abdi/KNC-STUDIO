// calendar-disconnect — the signed-in barber unlinks their Google Calendar. Invoked from the admin
// panel with the barber's JWT (verify_jwt = true). Identity is DB-derived (auth.getUser + profiles);
// a barber can only disconnect THEIR OWN calendar.
//
// Effect: atomically marks disconnect pending and queues durable deletion for every mapped event.
// Background cleanup revokes the Google grant and removes the token only after mappings drain.
//
// Run locally: npx supabase functions serve calendar-disconnect --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'

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
    .select('role, barber_id, account_enabled')
    .eq('id', callerData.user.id)
    .single()
  if (profileError || profile === null) return json({ ok: false, error: 'unauthorized' }, 401)

  const barberId =
    profile.role === 'barber' && profile.account_enabled === true ? profile.barber_id : null
  if (typeof barberId !== 'string' || barberId === '') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  const { data: result, error: prepareError } = await service.rpc('prepare_calendar_disconnect', {
    p_barber_id: barberId,
  })
  if (prepareError) {
    console.error('calendar-disconnect: prepare failed:', prepareError.message)
    return json({ ok: false, error: 'disconnect_failed' }, 500)
  }

  if (typeof result !== 'object' || result === null || result['ok'] !== true) {
    console.error('calendar-disconnect: invalid prepare result')
    return json({ ok: false, error: 'disconnect_failed' }, 500)
  }

  return json({ ok: true, pending: result['pending'] === true }, 200)
})
