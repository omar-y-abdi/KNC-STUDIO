import { signCustomerGateway } from '../../supabase/functions/_shared/customerGatewayAuth'

const SESSION_COOKIE = '__Host-bladeblend_customer_session'
const SESSION_VALUE = new RegExp(`^${SESSION_COOKIE}=[0-9a-f]{64}$`)
const MAX_BODY_BYTES = 16_384

/** Same-origin transport keeps the HttpOnly customer cookie first-party, including in Safari. */
export async function customerGateway(
  request: Request,
  env: {
    readonly SUPABASE_URL?: string
    readonly SUPABASE_ANON_KEY?: string
    readonly CUSTOMER_GATEWAY_SECRET?: string
  },
): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  }
  const error = (code: string, status: number): Response =>
    Response.json({ ok: false, error: code }, { status, headers })

  if (request.method !== 'POST') return error('method_not_allowed', 405)
  const origin = new URL(request.url).origin
  if (request.headers.get('Origin') !== origin) return error('origin_not_allowed', 403)
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') {
    return error('invalid_payload', 415)
  }
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.CUSTOMER_GATEWAY_SECRET ||
    env.CUSTOMER_GATEWAY_SECRET.length < 32
  ) {
    return error('not_configured', 503)
  }

  const reader = request.body?.getReader()
  if (!reader) return error('invalid_payload', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return error('invalid_payload', 413)
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const upstreamHeaders = new Headers({
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Origin: origin,
  })
  // Never forward staff cookies, browser Authorization, or arbitrary proxy destinations.
  const session = request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => SESSION_VALUE.test(part))
  if (session) upstreamHeaders.set('Cookie', session)
  // Cloudflare rewrites CF-Connecting-IP on cross-zone subrequests. Authenticate our own header.
  const ip = request.headers.get('CF-Connecting-IP')
  if (!ip) return error('system', 502)
  const textBody = new TextDecoder().decode(body)
  const signed = await signCustomerGateway(env.CUSTOMER_GATEWAY_SECRET, ip, origin, textBody)
  for (const [name, value] of Object.entries(signed)) upstreamHeaders.set(name, value)

  try {
    const upstream = await fetch(`${env.SUPABASE_URL}/functions/v1/public-booking-actions`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: textBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel()
      return error('system', 502)
    }
    const responseHeaders = new Headers(headers)
    const cookie = upstream.headers.get('Set-Cookie')
    if (cookie?.startsWith(`${SESSION_COOKIE}=`)) {
      responseHeaders.set('Set-Cookie', cookie.replace('SameSite=None', 'SameSite=Lax'))
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch {
    return error('system', 502)
  }
}
