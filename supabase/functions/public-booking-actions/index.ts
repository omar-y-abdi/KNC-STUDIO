import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'

type Action = 'request_access' | 'exchange_access' | 'list' | 'cancel' | 'review'
type Language = 'sv' | 'en'

interface ParsedAction {
  readonly action: Action
  readonly phone?: string
  readonly email?: string
  readonly bookingId?: string
  readonly accessToken?: string
  readonly rating?: number
  readonly text?: string
  readonly turnstileToken?: string
  readonly lang?: Language
}

interface Limit {
  readonly windowSecs: number
  readonly perIp: number
  readonly perPhone: number
}

const LIMITS: Readonly<Record<'request_access' | 'review', Limit>> = {
  request_access: { windowSecs: 600, perIp: 8, perPhone: 3 },
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
  return (
    value === 'request_access' ||
    value === 'exchange_access' ||
    value === 'list' ||
    value === 'cancel' ||
    value === 'review'
  )
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const phone = value.replace(/[\s\-()]/g, '')
  return /^07[0-9]{8}$/.test(phone) ? phone : null
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function opaqueToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function isBookingId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function parseBody(raw: unknown): ParsedAction | null {
  if (typeof raw !== 'object' || raw === null) return null
  const body = raw as Record<string, unknown>
  if (!isAction(body.action)) return null

  if (body.action === 'exchange_access') {
    return opaqueToken(body.accessCode)
      ? { action: body.action, accessToken: body.accessCode }
      : null
  }

  if (body.action === 'list') {
    return opaqueToken(body.accessToken)
      ? { action: body.action, accessToken: body.accessToken }
      : null
  }

  if (body.action === 'cancel') {
    return opaqueToken(body.accessToken) && isBookingId(body.bookingId)
      ? { action: body.action, accessToken: body.accessToken, bookingId: body.bookingId }
      : null
  }

  const phone = normalizePhone(body.phone)
  if (phone === null || typeof body.turnstileToken !== 'string') return null

  if (body.action === 'request_access') {
    const email = normalizeEmail(body.email)
    const lang = body.lang === 'en' ? 'en' : body.lang === 'sv' ? 'sv' : null
    return email === null || lang === null
      ? null
      : { action: body.action, phone, email, lang, turnstileToken: body.turnstileToken }
  }

  if (!opaqueToken(body.accessToken)) return null
  if (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5)
    return null
  if (typeof body.text !== 'string' || body.text.length < 1 || body.text.length > 1000) return null
  return {
    action: body.action,
    phone,
    accessToken: body.accessToken,
    rating: Number(body.rating),
    text: body.text,
    turnstileToken: body.turnstileToken,
  }
}

function clientIp(req: Request): string {
  const cloudflare = req.headers.get('cf-connecting-ip')?.trim()
  return cloudflare || 'unknown'
}

function createOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
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

function serviceClient(url: string, key: string) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function consumeLimit(
  service: ReturnType<typeof serviceClient>,
  action: 'request_access' | 'review',
  phone: string,
  ip: string,
  hashSalt: string,
): Promise<'ok' | 'rate_limited' | 'system'> {
  const [ipHash, phoneHash] = await Promise.all([
    sha256(`ip:${ip}:${hashSalt}`),
    sha256(`phone:${phone}:${hashSalt}`),
  ])
  const limit = LIMITS[action]
  const { data, error } = await service.rpc('consume_public_action_attempt', {
    p_action: action,
    p_ip_hash: ipHash,
    p_phone_hash: phoneHash,
    p_window_secs: limit.windowSecs,
    p_ip_limit: limit.perIp,
    p_phone_limit: limit.perPhone,
  })
  if (error) {
    console.error('public-booking-actions: rate-limit RPC failed', error.code)
    return 'system'
  }
  return data === true ? 'ok' : 'rate_limited'
}

function scopePhone(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value
  if (typeof row !== 'object' || row === null) return null
  const phone = (row as Record<string, unknown>).phone
  return typeof phone === 'string' && /^07[0-9]{8}$/.test(phone) ? phone : null
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

  const service = serviceClient(supabaseUrl, serviceKey)
  if (parsed.action === 'exchange_access') {
    const accessToken = createOpaqueToken()
    const { data, error } = await service.rpc('exchange_customer_booking_access', {
      p_challenge_hash: await sha256(parsed.accessToken ?? ''),
      p_session_hash: await sha256(accessToken),
    })
    if (error) {
      console.error('public-booking-actions: access exchange RPC failed', error.code)
      return json(req, { ok: false, error: 'system' }, 500)
    }
    return data === true
      ? json(req, { ok: true, access_token: accessToken })
      : json(req, { ok: false, error: 'invalid' })
  }

  if (parsed.action === 'list' || parsed.action === 'cancel') {
    const accessHash = await sha256(parsed.accessToken ?? '')
    const result =
      parsed.action === 'list'
        ? await service.rpc('list_customer_bookings_with_access', { p_session_hash: accessHash })
        : await service.rpc('cancel_customer_booking_with_access', {
            p_booking_id: parsed.bookingId,
            p_session_hash: accessHash,
          })
    if (result.error) {
      console.error(`public-booking-actions: ${parsed.action} access RPC failed`, result.error.code)
      return json(req, { ok: false, error: 'system' }, 500)
    }
    return json(req, result.data)
  }

  const phone = parsed.phone ?? ''
  const ip = clientIp(req)
  if (!(await verifyTurnstile(parsed.turnstileToken ?? '', ip, turnstileSecret))) {
    return json(req, { ok: false, error: 'failed_challenge' })
  }

  let sessionHash: string | null = null
  if (parsed.action === 'review') {
    sessionHash = await sha256(parsed.accessToken ?? '')
    const scope = await service.rpc('customer_booking_access_scope', {
      p_session_hash: sessionHash,
    })
    if (scope.error) {
      console.error('public-booking-actions: review access lookup failed', scope.error.code)
      return json(req, { ok: false, error: 'system' }, 500)
    }
    if (scopePhone(scope.data) !== phone) {
      return json(req, { ok: false, error: 'no_booking' })
    }
  }

  const limited = await consumeLimit(service, parsed.action, phone, ip, hashSalt)
  if (limited === 'system') return json(req, { ok: false, error: 'system' }, 500)
  if (limited === 'rate_limited') return json(req, { ok: false, error: 'rate_limited' })

  if (parsed.action === 'request_access') {
    const code = createOpaqueToken()
    const { error } = await service.rpc('create_customer_booking_access_request', {
      p_phone: phone,
      p_email: parsed.email,
      p_token_hash: await sha256(code),
      p_access_code: code,
      p_lang: parsed.lang,
    })
    if (error) {
      console.error('public-booking-actions: access request RPC failed', error.code)
      return json(req, { ok: false, error: 'system' }, 500)
    }
    return json(req, { ok: true })
  }

  const result = await service.rpc('create_review_with_access', {
    p_session_hash: sessionHash,
    p_phone: phone,
    p_rating: parsed.rating,
    p_text: parsed.text,
  })
  if (result.error) {
    console.error('public-booking-actions: review RPC failed', result.error.code)
    return json(req, { ok: false, error: 'system' }, 500)
  }
  return json(req, result.data)
})
