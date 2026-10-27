import { verifyTurnstile, turnstilePolicy } from '../_shared/turnstile.ts'
import { createClient } from '@supabase/supabase-js'
import {
  createCustomerAccessToken,
  encryptCustomerAccessToken,
  hashCustomerAccessToken,
} from '../_shared/customerAccess.ts'
import { verifyCustomerGateway } from '../_shared/customerGatewayAuth.ts'
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_RECEIPT_COOKIE,
  customerCookie,
  customerCookieHeader,
  customerCookieProof,
} from '../_shared/customerCookies.ts'
import { json } from '../_shared/http.ts'
import { emailAddress, requestSchema } from './request.ts'

interface Limit {
  readonly windowSecs: number
  readonly perIp: number
  readonly perPhone: number
}

const LIMITS: Readonly<Record<'request_access' | 'review', Limit>> = {
  request_access: { windowSecs: 600, perIp: 8, perPhone: 3 },
  review: { windowSecs: 86400, perIp: 5, perPhone: 2 },
}

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
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  return origin === null || allowedOrigins().includes(origin)
}

function reply(
  req: Request,
  body: unknown,
  status = 200,
  extra?: Record<string, string>,
): Response {
  return json(body, status, { ...corsHeaders(req), 'Cache-Control': 'no-store', ...extra })
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

function scopeEmail(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value
  if (typeof row !== 'object' || row === null) return null
  const email = emailAddress.safeParse((row as Record<string, unknown>).email)
  return email.success ? email.data : null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return reply(req, { ok: false, error: 'method_not_allowed' }, 405)
  if (!originAllowed(req)) return reply(req, { ok: false, error: 'origin_not_allowed' }, 403)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('public-booking-actions: Supabase runtime configuration missing')
    return reply(req, { ok: false, error: 'not_configured' }, 500)
  }

  let raw: unknown
  let bodyText: string
  try {
    bodyText = await req.text()
    raw = JSON.parse(bodyText)
  } catch {
    return reply(req, { ok: false, error: 'invalid_payload' }, 400)
  }
  const request = requestSchema.safeParse(raw)
  if (!request.success) return reply(req, { ok: false, error: 'invalid_payload' }, 400)
  const parsed = request.data

  let ip = clientIp(req)
  let firstPartyGateway = false
  if (req.headers.has('x-customer-gateway-signature') || req.headers.has('x-customer-gateway-ip')) {
    const forwarded = await verifyCustomerGateway(
      req,
      Deno.env.get('CUSTOMER_GATEWAY_SECRET'),
      bodyText,
    )
    if (forwarded === null) return reply(req, { ok: false, error: 'origin_not_allowed' }, 403)
    ip = forwarded
    firstPartyGateway = true
  }

  const protectedAction = parsed.action === 'request_access' || parsed.action === 'review'
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET')
  const hashSalt = Deno.env.get('PUBLIC_ACTION_HASH_SALT')
  if (protectedAction && (!turnstileSecret || !hashSalt)) {
    console.error('public-booking-actions: public-action protection configuration missing')
    return reply(req, { ok: false, error: 'not_configured' }, 503)
  }

  const service = serviceClient(supabaseUrl, serviceKey)
  if (parsed.action === 'request_link' || parsed.action === 'confirm_link') {
    if (!firstPartyGateway) return reply(req, { ok: false, error: 'origin_not_allowed' }, 403)
    const cookie = customerCookie(req, CUSTOMER_SESSION_COOKIE)
    if (cookie === null) return reply(req, { ok: false, error: 'access_denied' })
    const sessionHash = await sha256(cookie)
    if (parsed.action === 'confirm_link') {
      const result = await service.rpc('confirm_customer_email_link', {
        p_session_hash: sessionHash,
        p_code_hash: await sha256(parsed.linkCode ?? ''),
      })
      if (result.error) return reply(req, { ok: false, error: 'system' }, 500)
      return reply(req, result.data)
    }
    if (!hashSalt) return reply(req, { ok: false, error: 'not_configured' }, 503)
    const scope = await service.rpc('customer_booking_access_scope', {
      p_session_hash: sessionHash,
    })
    if (scope.error) return reply(req, { ok: false, error: 'system' }, 500)
    const sourceEmail = scopeEmail(scope.data)
    if (sourceEmail === null || sourceEmail !== parsed.sourceEmail)
      return reply(req, { ok: false, error: 'access_denied' })
    // Bound both sender and recipient, including attempts from several authenticated profiles.
    for (const email of new Set([sourceEmail, parsed.email ?? ''])) {
      const limited = await consumeLimit(service, 'request_access', email, ip, hashSalt)
      if (limited !== 'ok') return reply(req, { ok: false, error: limited })
    }
    const sourceCode = createCustomerAccessToken()
    const targetCode = createCustomerAccessToken()
    const [sourceHash, targetHash, sourceCiphertext, targetCiphertext] = await Promise.all([
      hashCustomerAccessToken(sourceCode),
      hashCustomerAccessToken(targetCode),
      encryptCustomerAccessToken(sourceCode, hashSalt),
      encryptCustomerAccessToken(targetCode, hashSalt),
    ])
    const result = await service.rpc('request_customer_email_link', {
      p_session_hash: sessionHash,
      p_target_email: parsed.email,
      p_source_hash: sourceHash,
      p_target_hash: targetHash,
      p_source_ciphertext: sourceCiphertext,
      p_target_ciphertext: targetCiphertext,
      p_lang: parsed.lang,
    })
    if (result.error) return reply(req, { ok: false, error: 'system' }, 500)
    return reply(req, result.data)
  }
  if (parsed.action === 'forget_device') {
    const receipt = customerCookie(req, CUSTOMER_RECEIPT_COOKIE)
    if (receipt !== null) {
      const { error } = await service.rpc('forget_customer_booking_receipt', {
        p_receipt_hash: await sha256(receipt),
      })
      if (error) console.error('public-booking-actions: receipt revocation failed', error.code)
    }
    // Clear optional device access even during a database outage; email-link sessions are separate.
    return reply(req, { ok: true }, 200, {
      'Set-Cookie': customerCookieHeader(CUSTOMER_RECEIPT_COOKIE, '', 0),
    })
  }
  if (parsed.action === 'exchange_access') {
    const accessToken = createOpaqueToken()
    const { data, error } = await service.rpc('exchange_customer_booking_access', {
      p_challenge_hash: await sha256(parsed.accessToken ?? ''),
      p_session_hash: await sha256(accessToken),
    })
    if (error) {
      console.error('public-booking-actions: access exchange RPC failed', error.code)
      return reply(req, { ok: false, error: 'system' }, 500)
    }
    return data === true
      ? reply(
          req,
          { ok: true, session_proof: await customerCookieProof(accessToken, 'session') },
          200,
          {
            'Set-Cookie': customerCookieHeader(CUSTOMER_SESSION_COOKIE, accessToken),
          },
        )
      : reply(req, { ok: false, error: 'invalid' })
  }

  if (parsed.action === 'list' || parsed.action === 'cancel') {
    const existingSession = customerCookie(req, CUSTOMER_SESSION_COOKIE)
    const receiptToken = customerCookie(req, CUSTOMER_RECEIPT_COOKIE)
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
        return reply(req, { ok: false, error: 'system' }, 500)
      }
      if (established.data !== true) {
        return reply(req, { ok: false, error: 'access_denied' })
      }
      setCookie = customerCookieHeader(CUSTOMER_SESSION_COOKIE, sessionToken)
    }
    if (sessionToken === null && receiptToken === null)
      return reply(req, { ok: false, error: 'access_denied' })
    const accessHash = sessionToken === null ? null : await sha256(sessionToken)
    const receiptHash = receiptToken === null ? null : await sha256(receiptToken)
    const result =
      parsed.action === 'list'
        ? await service.rpc('list_customer_bookings_for_browser', {
            p_session_hash: accessHash,
            p_receipt_hash: receiptHash,
          })
        : await service.rpc('cancel_customer_booking_for_browser', {
            p_booking_id: parsed.bookingId,
            p_session_hash: accessHash,
            p_receipt_hash: receiptHash,
          })
    if (result.error) {
      console.error(`public-booking-actions: ${parsed.action} access RPC failed`, result.error.code)
      return reply(req, { ok: false, error: 'system' }, 500)
    }
    const responseBody =
      parsed.action === 'list' &&
      typeof result.data === 'object' &&
      result.data !== null &&
      (result.data as Record<string, unknown>).ok === true
        ? {
            ...(result.data as Record<string, unknown>),
            session_proof:
              (result.data as Record<string, unknown>).authority === 'verified' &&
              sessionToken !== null
                ? await customerCookieProof(sessionToken, 'session')
                : await customerCookieProof(receiptToken ?? '', 'receipt'),
            ...(receiptToken !== null &&
            (result.data as Record<string, unknown>).receipt_active === true
              ? { receipt_proof: await customerCookieProof(receiptToken, 'receipt') }
              : {}),
          }
        : result.data
    return reply(
      req,
      responseBody,
      200,
      setCookie === undefined ? undefined : { 'Set-Cookie': setCookie },
    )
  }

  const phone = parsed.phone ?? ''
  if (
    !(await verifyTurnstile(
      parsed.turnstileToken ?? '',
      ip,
      turnstileSecret ?? '',
      turnstilePolicy(
        parsed.action === 'request_access' ? 'customer_access' : 'review',
        Deno.env.get('PUBLIC_SITE_ORIGINS'),
      ),
    ))
  ) {
    return reply(req, { ok: false, error: 'failed_challenge' })
  }

  let sessionHash: string | null = null
  if (parsed.action === 'review') {
    const token = parsed.accessToken ?? customerCookie(req, CUSTOMER_SESSION_COOKIE)
    if (token !== null) sessionHash = await sha256(token.toLowerCase())
    if (sessionHash === null) return reply(req, { ok: false, error: 'no_booking' })
    // The review RPC checks phone + a completed booking within the verified email profile.
    // A cookie's historical phone snapshot must not reject another number owned by that profile.
  }

  const limitScope = parsed.action === 'request_access' ? (parsed.email ?? '') : phone
  const limited = await consumeLimit(service, parsed.action, limitScope, ip, hashSalt ?? '')
  if (limited === 'system') return reply(req, { ok: false, error: 'system' }, 500)
  if (limited === 'rate_limited') return reply(req, { ok: false, error: 'rate_limited' })

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
      return reply(req, { ok: false, error: 'system' }, 500)
    }
    return reply(req, { ok: true })
  }

  const result = await service.rpc('create_review_with_access', {
    p_session_hash: sessionHash,
    p_phone: phone,
    p_rating: parsed.rating,
    p_text: parsed.text,
  })
  if (result.error) {
    console.error('public-booking-actions: review RPC failed', result.error.code)
    return reply(req, { ok: false, error: 'system' }, 500)
  }
  return reply(req, result.data)
})
