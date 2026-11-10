// calendar-disconnect — the signed-in barber unlinks their Google Calendar. Invoked from the admin
// panel with the barber's JWT (verify_jwt = true). Identity is DB-derived (auth.getUser + profiles);
// a barber can only disconnect THEIR OWN calendar.
//
// Effect: atomically marks disconnect pending and queues durable deletion for every mapped event.
// Background cleanup revokes the Google grant and removes the token only after mappings drain.
//
// Admin log: a request that marks a calendar link for disconnect is recorded under the barber's
// account (_shared/adminAudit.ts). The background cleanup that later removes the token is not a
// staff action and records nothing.
//
// Run locally: npx supabase functions serve calendar-disconnect --env-file supabase/functions/.env

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import { recordOrLogAdminAction, withinAdminLogBound } from '../_shared/adminAudit.ts'
import { callerBarberId, json } from '../_shared/calendarCaller.ts'
import { staffCors } from '../_shared/staffCors.ts'

/**
 * The signed-in barber's auth user id, for the admin log. `callerBarberId` has verified the same
 * token and answers with the barber id only, so the verified user is read once more here. `null`
 * when it cannot be read; the disconnect does not depend on it, so this never throws and never
 * waits past the admin log's bound.
 */
async function callerUserId(req: Request, service: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get('authorization') ?? '').slice('Bearer '.length)
  try {
    const answer = await withinAdminLogBound(() => service.auth.getUser(jwt))
    if (answer.timedOut) {
      console.error('calendar-disconnect: admin log actor lookup failed:', 'timeout')
      return null
    }
    const { data, error } = answer.value
    if (error !== null || data.user === null) {
      console.error('calendar-disconnect: admin log actor lookup failed:', error?.name ?? 'no user')
      return null
    }
    return data.user.id
  } catch (thrown) {
    console.error(
      'calendar-disconnect: admin log actor lookup failed:',
      thrown instanceof Error ? thrown.name : 'unknown',
    )
    return null
  }
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('calendar-disconnect: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    return json({ ok: false, error: 'not_configured' }, 500)
  }
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const barberId = await callerBarberId(req, service)
  if (barberId instanceof Response) return barberId

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

  // `pending` says a calendar link exists and is marked for disconnect; without one nothing was
  // written. The mark is set with the service role, which the database cannot attribute to the
  // barber by itself. A failed entry is logged and the answer is the same.
  if (result['pending'] === true) {
    const actorId = await callerUserId(req, service)
    if (actorId !== null) {
      await recordOrLogAdminAction('calendar-disconnect', service, {
        actorId,
        action: 'update',
        table: 'barber_calendar_tokens',
        targetId: barberId,
        changedColumns: ['disconnect_requested_at'],
      })
    }
  }

  return json({ ok: true, pending: result['pending'] === true }, 200)
}

Deno.serve(staffCors(Deno.env.get('CMS_ALLOWED_ORIGINS'), handle))
