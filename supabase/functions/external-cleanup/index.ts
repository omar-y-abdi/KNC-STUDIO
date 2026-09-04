import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  executeExternalAction,
  ExternalActionError,
  isMissingCalendarDispatcherError,
  parseExternalAction,
  type ExternalActionService,
} from '../_shared/externalActions.ts'
import { timingSafeEqual } from '../_shared/calendar.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function parseRequest(
  value: unknown,
): { readonly actionId: string; readonly dispatchToken: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return typeof row.action_id === 'string' &&
    uuid.test(row.action_id) &&
    typeof row.dispatch_token === 'string' &&
    uuid.test(row.dispatch_token)
    ? { actionId: row.action_id, dispatchToken: row.dispatch_token }
    : null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const expectedSecret = Deno.env.get('WEBHOOK_SECRET')
  if (
    !expectedSecret ||
    !timingSafeEqual(req.headers.get('x-webhook-secret') ?? '', expectedSecret)
  ) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('external-cleanup: missing Supabase runtime configuration')
    return json({ ok: false, error: 'not_configured' }, 503)
  }

  let parsed: ReturnType<typeof parseRequest>
  try {
    parsed = parseRequest(await req.json())
  } catch {
    return json({ ok: false, error: 'invalid_payload' }, 400)
  }
  if (parsed === null) return json({ ok: false, error: 'invalid_payload' }, 400)

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const calendarContext = await service.rpc('calendar_external_action_for_dispatch', {
    p_id: parsed.actionId,
    p_dispatch_token: parsed.dispatchToken,
  })
  let context: Awaited<ReturnType<ExternalActionService['rpc']>>
  if (calendarContext.error === null && calendarContext.data !== null) {
    context = calendarContext
  } else if (
    calendarContext.error === null ||
    isMissingCalendarDispatcherError(calendarContext.error)
  ) {
    // Expand may have reached the database before this Edge version.  Only an explicit missing
    // function error permits the old generic dispatcher; permissions, network, and SQL failures
    // must fail closed rather than silently changing the Calendar contract.
    context = await service.rpc('external_action_for_dispatch', {
      p_id: parsed.actionId,
      p_dispatch_token: parsed.dispatchToken,
    })
  } else {
    console.error('external-cleanup: Calendar dispatch lookup failed', calendarContext.error.code)
    return json({ ok: false, error: 'database_failed' }, 500)
  }
  if (context.error !== null) {
    console.error('external-cleanup: dispatch lookup failed', context.error.code)
    return json({ ok: false, error: 'database_failed' }, 500)
  }
  if (context.data === null) return json({ ok: true, status: 'superseded' })

  const action = parseExternalAction(context.data)
  if (action === null) {
    const failed = await service.rpc('fail_external_action', {
      p_id: parsed.actionId,
      p_dispatch_token: parsed.dispatchToken,
      p_error_code: 'invalid_context',
    })
    if (failed.error !== null || failed.data !== true) {
      return json({ ok: false, error: 'database_failed' }, 500)
    }
    return json({ ok: false, error: 'invalid_context' }, 503)
  }

  try {
    await executeExternalAction(action, service as unknown as ExternalActionService, {
      googleClientId: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID'),
      googleClientSecret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET'),
      resendApiKey: Deno.env.get('RESEND_API_KEY'),
    })
  } catch (error) {
    const code = error instanceof ExternalActionError ? error.code : 'external_action_failed'
    console.error(
      `external-cleanup: ${action.action_type} failed`,
      error instanceof Error ? error.message : 'unknown',
    )
    const resolutionRpc =
      error instanceof ExternalActionError && !error.retryable
        ? 'block_external_action'
        : 'fail_external_action'
    const failed = await service.rpc(resolutionRpc, {
      p_id: action.id,
      p_dispatch_token: action.dispatch_token,
      p_error_code: code,
    })
    if (failed.error !== null || failed.data !== true) {
      return json({ ok: false, error: 'database_failed' }, 500)
    }
    return json({ ok: false, error: code }, 503)
  }

  const completed = await service.rpc('complete_external_action', {
    p_id: action.id,
    p_dispatch_token: action.dispatch_token,
  })
  if (completed.error !== null || completed.data !== true) {
    console.error('external-cleanup: completion update failed', completed.error?.code)
    return json({ ok: false, error: 'database_failed' }, 500)
  }
  return json({ ok: true, status: 'completed', action: action.action_type })
})
