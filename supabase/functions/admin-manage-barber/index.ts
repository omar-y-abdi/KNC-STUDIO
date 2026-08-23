import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  executeExternalAction,
  ExternalActionError,
  parseExternalAction,
  type ExternalActionService,
} from '../_shared/externalActions.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Body =
  | { readonly action: 'set_access'; readonly barber_id: string; readonly enabled: boolean }
  | { readonly action: 'delete'; readonly barber_id: string; readonly purge_bookings: boolean }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function parseBody(value: unknown): Body | null {
  if (typeof value !== 'object' || value === null) return null
  const body = value as Record<string, unknown>
  if (typeof body.barber_id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(body.barber_id)) return null
  if (body.action === 'set_access' && typeof body.enabled === 'boolean') {
    return { action: body.action, barber_id: body.barber_id, enabled: body.enabled }
  }
  if (body.action === 'delete' && typeof body.purge_bookings === 'boolean') {
    return {
      action: body.action,
      barber_id: body.barber_id,
      purge_bookings: body.purge_bookings,
    }
  }
  return null
}

function isRpcError(value: unknown): value is { readonly ok: false; readonly error: string } {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return row.ok === false && typeof row.error === 'string'
}

function actionId(value: unknown, key = 'action_id'): string | null {
  if (typeof value !== 'object' || value === null) return null
  const id = (value as Record<string, unknown>)[key]
  return typeof id === 'string' ? id : null
}

async function processActionNow(service: SupabaseClient, id: string): Promise<boolean> {
  const claimed = await service.rpc('claim_external_action', { p_id: id })
  if (claimed.error !== null) {
    console.error('admin-manage-barber: external action claim failed', claimed.error.code)
    return false
  }
  if (claimed.data === null) return false

  const action = parseExternalAction(claimed.data)
  if (action === null) {
    console.error('admin-manage-barber: invalid external action context')
    return false
  }

  try {
    await executeExternalAction(action, service as unknown as ExternalActionService, {
      googleClientId: undefined,
      googleClientSecret: undefined,
    })
  } catch (error) {
    const code = error instanceof ExternalActionError ? error.code : 'external_action_failed'
    console.error(
      `admin-manage-barber: ${action.action_type} failed`,
      error instanceof Error ? error.message : 'unknown',
    )
    await service.rpc('fail_external_action', {
      p_id: action.id,
      p_dispatch_token: action.dispatch_token,
      p_error_code: code,
    })
    return false
  }

  const completed = await service.rpc('complete_external_action', {
    p_id: action.id,
    p_dispatch_token: action.dispatch_token,
  })
  return completed.error === null && completed.data === true
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('admin-manage-barber: missing Supabase runtime configuration')
    return json({ ok: false, error: 'not_configured' }, 500)
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (jwt === '') return json({ ok: false, error: 'unauthorized' }, 401)

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await service.auth.getUser(jwt)
  if (userError !== null || userData.user === null) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const { data: ownerProfile, error: ownerError } = await caller
    .from('profiles')
    .select('role,account_enabled')
    .eq('id', userData.user.id)
    .single()
  if (
    ownerError !== null ||
    ownerProfile === null ||
    ownerProfile.role !== 'owner' ||
    ownerProfile.account_enabled !== true
  ) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_payload' }, 400)
  }
  const body = parseBody(rawBody)
  if (body === null) return json({ ok: false, error: 'invalid_payload' }, 400)

  if (body.action === 'set_access') {
    const changed = await caller.rpc('admin_set_barber_account_enabled', {
      p_barber_id: body.barber_id,
      p_enabled: body.enabled,
    })
    if (changed.error !== null) {
      console.error('admin-manage-barber: database access change failed', changed.error.code)
      return json({ ok: false, error: 'database_failed' }, 500)
    }
    if (isRpcError(changed.data)) return json(changed.data, 409)
    const queuedActionId = actionId(changed.data)
    if (queuedActionId === null) return json({ ok: false, error: 'database_failed' }, 500)
    const synced = await processActionNow(service, queuedActionId)
    return json({
      ok: true,
      account_enabled: body.enabled,
      auth_sync_pending: !synced,
    })
  }

  const deleted = await caller.rpc('admin_delete_barber', {
    p_barber_id: body.barber_id,
    p_purge_bookings: body.purge_bookings,
  })
  if (deleted.error !== null) {
    console.error('admin-manage-barber: barber delete RPC failed', deleted.error.code)
    return json({ ok: false, error: 'database_failed' }, 500)
  }
  if (isRpcError(deleted.data)) return json(deleted.data, 409)
  if (typeof deleted.data !== 'object' || deleted.data === null) {
    return json({ ok: false, error: 'database_failed' }, 500)
  }

  const result = deleted.data as Record<string, unknown>
  const queuedActionId = actionId(result, 'auth_action_id')
  const authCleanupPending =
    queuedActionId === null ? false : !(await processActionNow(service, queuedActionId))
  return json({
    ok: true,
    deleted_bookings: result.deleted_bookings,
    auth_cleanup_pending: authCleanupPending,
  })
})
