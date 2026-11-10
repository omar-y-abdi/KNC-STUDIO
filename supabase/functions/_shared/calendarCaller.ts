// Response helpers and the caller gate shared by the barber-invoked calendar-* functions
// (calendar-oauth-start, calendar-disconnect). Those functions deploy without an import map, so this
// module imports supabase-js by URL as they do and stays clear of _shared/http.ts and its `zod`.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'

/** The CORS headers are added by `staffCors` (_shared/staffCors.ts), which wraps both handlers. */
export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** AUTH GATE (fail-closed): validate JWT, then read the caller's OWN role + barber_id from the DB.
 *  Resolves the caller's barber id, or the refusal to answer with. */
export async function callerBarberId(
  req: Request,
  service: SupabaseClient,
): Promise<string | Response> {
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

  // Only a linked, enabled barber passes. An owner (no barber_id) is refused.
  const barberId =
    profile.role === 'barber' && profile.account_enabled === true ? profile.barber_id : null
  if (typeof barberId !== 'string' || barberId === '') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }
  return barberId
}
