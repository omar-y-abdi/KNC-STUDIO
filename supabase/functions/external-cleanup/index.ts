import { createClient } from '@supabase/supabase-js'
import {
  parseExternalAction,
  settleExternalAction,
  type ExternalActionService,
} from '../_shared/externalActions.ts'
import { timingSafeEqual } from '../_shared/calendar.ts'
import { retainTaskUntilSettled } from '../_shared/backgroundTask.ts'
import { json } from '../_shared/http.ts'
import { requestSchema } from './request.ts'

async function handleRequest(req: Request): Promise<Response> {
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

  const body = await req.json().catch(() => null)
  const request = requestSchema.safeParse(body)
  if (!request.success) return json({ ok: false, error: 'invalid_payload' }, 400)
  const parsed = request.data

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  // The generic dispatcher resolves Calendar jobs through calendar_external_action_for_dispatch
  // itself (20260913131739), so one lookup serves every action type.
  const context = await service.rpc('external_action_for_dispatch', {
    p_id: parsed.actionId,
    p_dispatch_token: parsed.dispatchToken,
  })
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

  const settlement = await settleExternalAction(
    action,
    service as unknown as ExternalActionService,
    {
      googleClientId: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID'),
      googleClientSecret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET'),
      resendApiKey: Deno.env.get('RESEND_API_KEY'),
      customerAccessHashSalt: Deno.env.get('PUBLIC_ACTION_HASH_SALT'),
    },
  )
  switch (settlement.status) {
    case 'completed':
      return json({ ok: true, status: 'completed', action: action.action_type })
    case 'failed':
      return json({ ok: false, error: settlement.code }, 503)
    case 'database_failed':
      return json({ ok: false, error: 'database_failed' }, 500)
  }
}

Deno.serve((req: Request) => retainTaskUntilSettled(handleRequest(req)))
