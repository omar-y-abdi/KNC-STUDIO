import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  createCustomerAccessToken,
  encryptCustomerAccessToken,
  hashCustomerAccessToken,
} from '../_shared/customerAccess.ts'
import { verifyCustomerGateway } from '../_shared/customerGatewayAuth.ts'

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
const CUSTOMER_SESSION_COOKIE = '__Host-bladeblend_customer_session'

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
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  return origin === null || allowedOrigins().includes(origin)
}

function json(req: Request, body: unknown, status = 200, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'content-type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra,
    },
  })
}

function sessionCookie(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`))
  const value = match?.slice(CUSTOMER_SESSION_COOKIE.length + 1) ?? null
  return opaqueToken(value) ? value : null
}

function sessionCookieHeader(token: string): string {
  return `${CUSTOMER_SESSION_COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=None`
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
    return body.accessToken === undefined || opaqueToken(body.accessToken)
      ? {
          action: body.action,
          ...(opaqueToken(body.accessToken) ? { accessToken: body.accessToken } : {}),
        }
      : null
  }

  if (body.action === 'cancel') {
    return (body.accessToken === undefined || opaqueToken(body.accessToken)) &&
      isBookingId(body.bookingId)
      ? {
          action: body.action,
          ...(opaqueToken(body.accessToken) ? { accessToken: body.accessToken } : {}),
          bookingId: body.bookingId,
        }
      : null
  }

  if (body.action === 'request_access') {
    const email = normalizeEmail(body.email)
    const lang = body.lang === 'en' ? 'en' : body.lang === 'sv' ? 'sv' : null
    return email === null || lang === null || typeof body.turnstileToken !== 'string'
      ? null
      : { action: body.action, email, lang, turnstileToken: body.turnstileToken }
  }

  const phone = normalizePhone(body.phone)
  if (phone === null || typeof body.turnstileToken !== 'string') return null
  if (body.accessToken !== undefined && !opaqueToken(body.accessToken)) return null
  if (!Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5)
    return null
  if (typeof body.text !== 'string' || body.text.length < 1 || body.text.length > 1000) return null
  return {
    action: body.action,
    phone,
    ...(opaqueToken(body.accessToken) ? { accessToken: body.accessToken } : {}),
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

function customerSessionProof(token: string): Promise<string> {
  return sha256(`customer-session-proof/v1\n${token.toLowerCase()}`)
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
  scope: string,
  ip: string,
  hashSalt: string,
): Promise<'ok' | 'rate_limited' | 'system'> {
  const [ipHash, scopeHash] = await Promise.all([
    sha256(`ip:${ip}:${hashSalt}`),
    sha256(`${action === 'request_access' ? 'email' : 'phone'}:${scope}:${hashSalt}`),
  ])
  const limit = LIMITS[action]
  const { data, error } = await service.rpc('consume_public_action_attempt', {
    p_action: action,
    p_ip_hash: ipHash,
    p_phone_hash: scopeHash,
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
  if (!supabaseUrl || !serviceKey) {
    console.error('public-booking-actions: Supabase runtime configuration missing')
    return json(req, { ok: false, error: 'not_configured' }, 500)
  }

  let raw: unknown
  let bodyText: string
  try {
    bodyText = await req.text()
    raw = JSON.parse(bodyText)
  } catch {
    return json(req, { ok: false, error: 'invalid_payload' }, 400)
  }
  const parsed = parseBody(raw)
  if (parsed === null) return json(req, { ok: false, error: 'invalid_payload' }, 400)

  let ip = clientIp(req)
  if (req.headers.has('x-customer-gateway-signature') || req.headers.has('x-customer-gateway-ip')) {
    const forwarded = await verifyCustomerGateway(
      req,
      Deno.env.get('CUSTOMER_GATEWAY_SECRET'),
      bodyText,
    )
    if (forwarded === null) return json(req, { ok: false, error: 'origin_not_allowed' }, 403)
    ip = forwarded
  }

  const protectedAction = parsed.action === 'request_access' || parsed.action === 'review'
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET')
  const hashSalt = Deno.env.get('PUBLIC_ACTION_HASH_SALT')
  if (protectedAction && (!turnstileSecret || !hashSalt)) {
    console.error('public-booking-actions: public-action protection configuration missing')
    return json(req, { ok: false, error: 'not_configured' }, 503)
  }

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
      ? json(req, { ok: true, session_proof: await customerSessionProof(accessToken) }, 200, {
          'Set-Cookie': sessionCookieHeader(accessToken),
        })
      : json(req, { ok: false, error: 'invalid' })
  }

  if (parsed.action === 'list' || parsed.action === 'cancel') {
    const existingSession = sessionCookie(req)
    let sessionToken = existingSession
    let setCookie: string | undefined
    // An explicit email link selects the customer even when another or expired session exists.
    if (parsed.accessToken !== undefined) {
      sessionToken = createOpaqueToken()
      const established = await service.rpc('establish_customer_booking_session', {
        p_access_token: await sha256(parsed.accessToken.toLowerCase()),
        p_session_hash: await sha256(sessionToken),
      })
      if (established.error) {
        console.error(
          'public-booking-actions: session establishment failed',
          established.error.code,
        )
        return json(req, { ok: false, error: 'system' }, 500)
      }
      if (established.data !== true) {
        return json(req, { ok: false, error: 'access_denied' })
      }
      setCookie = sessionCookieHeader(sessionToken)
    }
    if (sessionToken === null) return json(req, { ok: false, error: 'access_denied' })
    const accessHash = await sha256(sessionToken)
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
    const responseBody =
      parsed.action === 'list' &&
      typeof result.data === 'object' &&
      result.data !== null &&
      (result.data as Record<string, unknown>).ok === true
        ? {
            ...(result.data as Record<string, unknown>),
            session_proof: await customerSessionProof(sessionToken),
          }
        : result.data
    return json(
      req,
      responseBody,
      200,
      setCookie === undefined ? undefined : { 'Set-Cookie': setCookie },
    )
  }

  const phone = parsed.phone ?? ''
  if (!(await verifyTurnstile(parsed.turnstileToken ?? '', ip, turnstileSecret ?? ''))) {
    return json(req, { ok: false, error: 'failed_challenge' })
  }

  let sessionHash: string | null = null
  if (parsed.action === 'review') {
    const token = parsed.accessToken ?? sessionCookie(req)
    if (token !== null) sessionHash = await sha256(token.toLowerCase())
    if (sessionHash === null) return json(req, { ok: false, error: 'no_booking' })
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

  const limitScope = parsed.action === 'request_access' ? (parsed.email ?? '') : phone
  const limited = await consumeLimit(service, parsed.action, limitScope, ip, hashSalt ?? '')
  if (limited === 'system') return json(req, { ok: false, error: 'system' }, 500)
  if (limited === 'rate_limited') return json(req, { ok: false, error: 'rate_limited' })

  if (parsed.action === 'request_access') {
    const code = createCustomerAccessToken()
    const tokenHash = await hashCustomerAccessToken(code)
    const tokenCiphertext = await encryptCustomerAccessToken(code, hashSalt ?? '')
    const { error } = await service.rpc('rotate_customer_booking_access_token', {
      p_email: parsed.email,
      p_token_hash: tokenHash,
      p_token_ciphertext: tokenCiphertext,
      p_access_code: code,
      p_lang: parsed.lang,
    })
    if (error) {
      console.error('public-booking-actions: access rotation RPC failed', error.code)
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
