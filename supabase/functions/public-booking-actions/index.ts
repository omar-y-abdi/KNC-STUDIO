import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Action = 'lookup' | 'list' | 'cancel' | 'review'

interface ParsedAction {
  readonly action: Action
  readonly phone: string
  readonly bookingId?: string
  readonly rating?: number
  readonly text?: string
  readonly turnstileToken: string
}

interface Limit {
  readonly windowSecs: number
  readonly perIp: number
  readonly perPhone: number
}

const LIMITS: Readonly<Record<Action, Limit>> = {
  lookup: { windowSecs: 600, perIp: 12, perPhone: 8 },
  list: { windowSecs: 600, perIp: 12, perPhone: 8 },
  cancel: { windowSecs: 600, perIp: 6, perPhone: 3 },
  review: { windowSecs: 86400, perIp: 5, perPhone: 2 },
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const DEFAULT_ORIGINS = ['https://bladeblendstudio.se', 'https://www.bladeblendstudio.se']

function allowedOrigins(): readonly string[] {
  const configured = Deno.env.get('PUBLIC_SITE_ORIGINS')
  if (!configured) return DEFAULT_ORIGINS
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allowOrigin = allowedOrigins().includes(origin) ? origin : DEFAULT_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  return origin === null || allowedOrigins().includes(origin)
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json' },
  })
}

function isAction(value: unknown): value is Action {
  return value === 'lookup' || value === 'list' || value === 'cancel' || value === 'review'
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const phone = value.replace(/[\s\-()]/g, '')
  return /^07[0-9]{8}$/.test(phone) ? phone : null
}

function parseBody(raw: unknown): ParsedAction | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  if (!isAction(body.action)) return null
  const phone = normalizePhone(body.phone)
  if (phone === null || typeof body.turnstileToken !== 'string') return null

  if (body.action === 'cancel') {
    if (
      typeof body.bookingId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.bookingId,
      )
    )
      return null
    return {
      action: body.action,
      phone,
      bookingId: body.bookingId,
      turnstileToken: body.turnstileToken,
    }
  }

  if (body.action === 'review') {
    if (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5)
      return null
    if (typeof body.text !== 'string' || body.text.length < 1 || body.text.length > 1000)
      return null
    return {
      action: body.action,
      phone,
      rating: Number(body.rating),
      text: body.text,
      turnstileToken: body.turnstileToken,
    }
  }

  return { action: body.action, phone, turnstileToken: body.turnstileToken }
}

function clientIp(req: Request): string {
  const cloudflare = req.headers.get('cf-connecting-ip')?.trim()
  if (cloudflare) return cloudflare
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  if (token.length === 0) return false
  try {
    const form = new URLSearchParams({ secret, response: token })
    if (ip !== 'unknown') form.set('remoteip', ip)
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
    if (!response.ok) return false
    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'method_not_allowed' }, 405)
  if (!originAllowed(req)) return json(req, { ok: false, error: 'origin_not_allowed' }, 403)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET')
  const hashSalt = Deno.env.get('PUBLIC_ACTION_HASH_SALT')
  if (!supabaseUrl || !serviceKey || !turnstileSecret || !hashSalt) {
    console.error('public-booking-actions: required secret missing')
    return json(req, { ok: false, error: 'not_configured' }, 500)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json(req, { ok: false, error: 'invalid_payload' }, 400)
  }
  const parsed = parseBody(raw)
  if (parsed === null) return json(req, { ok: false, error: 'invalid_payload' }, 400)

  const ip = clientIp(req)
  if (!(await verifyTurnstile(parsed.turnstileToken, ip, turnstileSecret))) {
    return json(req, { ok: false, error: 'failed_challenge' })
  }

  const [ipHash, phoneHash] = await Promise.all([
    sha256(`ip:${ip}:${hashSalt}`),
    sha256(`phone:${parsed.phone}:${hashSalt}`),
  ])
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const limit = LIMITS[parsed.action]
  const { data: consumed, error: consumeError } = await service.rpc(
    'consume_public_action_attempt',
    {
      p_action: parsed.action,
      p_ip_hash: ipHash,
      p_phone_hash: phoneHash,
      p_window_secs: limit.windowSecs,
      p_ip_limit: limit.perIp,
      p_phone_limit: limit.perPhone,
    },
  )
  if (consumeError) {
    console.error('public-booking-actions: rate-limit RPC failed', consumeError.code)
    return json(req, { ok: false, error: 'system' }, 500)
  }
  if (consumed !== true) return json(req, { ok: false, error: 'rate_limited' })

  let result: { data: unknown; error: { code?: string } | null }
  switch (parsed.action) {
    case 'lookup':
      result = await service.rpc('lookup_booking', { p_contact: parsed.phone })
      break
    case 'list':
      result = await service.rpc('list_bookings_by_phone', { p_contact: parsed.phone })
      break
    case 'cancel':
      result = await service.rpc('cancel_booking', {
        p_booking_id: parsed.bookingId,
        p_contact: parsed.phone,
      })
      break
    case 'review':
      result = await service.rpc('create_review', {
        p_phone: parsed.phone,
        p_rating: parsed.rating,
        p_text: parsed.text,
      })
      break
  }

  if (result.error) {
    console.error(
      `public-booking-actions: ${parsed.action} RPC failed`,
      result.error.code ?? 'unknown',
    )
    return json(req, { ok: false, error: 'system' }, 500)
  }
  return json(req, result.data)
})
