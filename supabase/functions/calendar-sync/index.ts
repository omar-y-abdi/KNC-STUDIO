// Compatibility webhook endpoint for Calendar synchronization.
//
// The database transaction now queues calendar_event_sync directly in external_action_jobs, so
// correctness no longer depends on Database Webhook delivery. If an existing production webhook is
// still configured, this endpoint only re-queues the same deduplicated durable action; it never calls
// Google directly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import { timingSafeEqual } from '../_shared/calendar.ts'

type WebhookOp = 'INSERT' | 'UPDATE' | 'DELETE'

interface WebhookEnvelope {
  readonly type?: string
  readonly record?: unknown
  readonly old_record?: unknown
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function parseEnvelope(raw: unknown): { op: WebhookOp; id: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const env = raw as WebhookEnvelope
  const op = env.type
  if (op !== 'INSERT' && op !== 'UPDATE' && op !== 'DELETE') return null
  const source = op === 'DELETE' ? env.old_record : env.record
  if (typeof source !== 'object' || source === null) return null
  const id = (source as Record<string, unknown>)['id']
  return typeof id === 'string' && id.length > 0 ? { op, id } : null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  if (!webhookSecret) return json({ ok: false, error: 'not_configured' }, 503)
  if (!timingSafeEqual(req.headers.get('x-webhook-secret') ?? '', webhookSecret)) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'not_configured' }, 500)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  const parsed = parseEnvelope(raw)
  if (parsed === null) return json({ ok: false, error: 'invalid_payload' }, 400)

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const queued = await service.rpc('queue_calendar_event_sync', { p_booking_id: parsed.id })
  if (queued.error !== null) {
    console.error('calendar-sync: durable queue failed', queued.error.code)
    return json({ ok: false, error: 'database_failed' }, 500)
  }

  console.log(
    `calendar-sync: ${parsed.op} booking ${parsed.id} -> ${queued.data === null ? 'not_required' : 'queued'}`,
  )
  return json({ ok: true, outcome: queued.data === null ? 'not_required' : 'queued' }, 200)
})
