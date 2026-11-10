import { signCustomerGateway } from '../../supabase/functions/_shared/customerGatewayAuth'
import {
  CUSTOMER_COOKIE_NAMES,
  customerCookie,
} from '../../supabase/functions/_shared/customerCookies'
import { ownHeaders } from './responseHeaders'
const MAX_BODY_BYTES = 16_384

/** Every gateway answer is JSON for the app alone: never stored, never a search result. */
const GATEWAY_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
} as const

/** The Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc), as the gateway uses it. */
export interface GatewayRateLimit {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>
}

/** The period of that binding's limit, in seconds: how long a refused client is told to wait.
 * tests/unit/workerHttp.test.ts keeps it equal to the period in wrangler.jsonc. */
export const GATEWAY_RATE_LIMIT_PERIOD_SECONDS = 60

/** The actions of public-booking-actions (its request.ts). Each is counted on its own, so reading
 * the booking list never uses up what a cancellation needs. */
export const BOOKING_ACTIONS = [
  'request_access',
  'exchange_access',
  'list',
  'cancel',
  'review',
  'forget_device',
  'request_link',
  'confirm_link',
] as const

/** A gateway without its Supabase address, key or signing secret answers again only after a new
 * deploy has given it them: minutes, not seconds. */
const NOT_CONFIGURED_RETRY_SECONDS = 300

/** Why the Worker itself, not Edge, answered a gateway request. */
export type GatewayErrorCode =
  | 'method_not_allowed'
  | 'origin_not_allowed'
  | 'invalid_payload'
  | 'not_configured'
  | 'rate_limited'
  | 'maintenance'
  | 'system'

/** The Worker's own answer on a gateway path: the JSON shape its clients read, with `extra`
 * headers for what the status needs (Allow, Retry-After). */
export function gatewayError(
  code: GatewayErrorCode,
  status: number,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    { ok: false, error: code },
    { status, headers: ownHeaders({ ...GATEWAY_HEADERS, ...extra }) },
  )
}

/** What a request to public-booking-actions counts against: the action its body names, or `other`
 * for a body that names none of them. Edge refuses such a body; here it still counts, in one
 * bucket, so invented action names cannot multiply the allowance. */
function countedAction(body: string): (typeof BOOKING_ACTIONS)[number] | 'other' {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return 'other'
  }
  const action =
    typeof parsed === 'object' && parsed !== null && 'action' in parsed ? parsed.action : undefined
  return BOOKING_ACTIONS.find((name) => name === action) ?? 'other'
}

/** Whom a request to public-booking-actions is counted for. An IPv6 client is the /64 it is in,
 * which one customer line usually holds whole: its first four groups in one spelling, so another
 * address in it, or another way of writing it, gives no new allowance. An IPv4 address written as
 * IPv6 (::ffff:203.0.113.10, also in hex) is that IPv4 address, as the plain one is. Any other
 * value, a plain IPv4 address too, is counted as it was received. */
function limiterClient(ip: string): string {
  const groups = ipv6Groups(ip)
  if (groups === null) return ip
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return groups
      .slice(6)
      .flatMap((group) => [group >> 8, group & 0xff])
      .join('.')
  }
  const prefix = groups.slice(0, 4).map((group) => group.toString(16))
  return `${prefix.join(':')}::/64`
}

/** The eight 16-bit groups of an IPv6 address in any of its text forms: one to four hex digits a
 * group in either letter case, at most one `::` for one or more zero groups, a dotted IPv4 address
 * as the last two groups, and a zone (`%eth0`), which is dropped. Null for any other text. Each
 * character is read a bounded number of times. */
function ipv6Groups(text: string): readonly number[] | null {
  const zone = text.indexOf('%')
  const address = zone < 0 ? text : text.slice(0, zone)
  const gap = address.indexOf('::')
  if (gap < 0) {
    const groups = ipv6GroupList(address, true)
    return groups?.length === 8 ? groups : null
  }
  // A second `::` leaves an empty part in the tail, which is no group.
  const head = ipv6GroupList(address.slice(0, gap), false)
  const tail = ipv6GroupList(address.slice(gap + 2), true)
  if (head === null || tail === null || head.length + tail.length > 7) return null
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail]
}

/** The groups `text` writes between single colons; a last part that is a dotted IPv4 address is
 * two groups when `ipv4Last`. Null when a part is neither. */
function ipv6GroupList(text: string, ipv4Last: boolean): number[] | null {
  if (text === '') return []
  const parts = text.split(':')
  const groups: number[] = []
  for (const [index, part] of parts.entries()) {
    if (ipv4Last && index === parts.length - 1 && part.includes('.')) {
      const value = ipv4Value(part)
      if (value === null) return null
      groups.push(Math.floor(value / 0x10000), value % 0x10000)
    } else {
      const group = digitsValue(part, 16, 4)
      if (group === null) return null
      groups.push(group)
    }
  }
  return groups
}

/** The 32-bit value of a dotted IPv4 address: four decimal numbers up to 255, none written with a
 * leading zero; null for any other text. */
function ipv4Value(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const octet = part.length > 1 && part.startsWith('0') ? null : digitsValue(part, 10, 3)
    if (octet === null || octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

/** The number `text` writes with one to `width` digits of `radix` (hex in either letter case);
 * null for any other text. */
function digitsValue(text: string, radix: 10 | 16, width: number): number | null {
  if (text.length === 0 || text.length > width) return null
  let value = 0
  for (let at = 0; at < text.length; at++) {
    const digit = Number.parseInt(text.charAt(at), radix)
    if (Number.isNaN(digit)) return null
    value = value * radix + digit
  }
  return value
}

/** Whether a request counted under `key` is within the limit. Without the binding nothing is
 * counted, and a limiter that fails is no reason to refuse a customer: both let the request on. */
async function withinRateLimit(
  limiter: GatewayRateLimit | undefined,
  key: string,
): Promise<boolean> {
  if (limiter === undefined) return true
  try {
    return (await limiter.limit({ key })).success
  } catch {
    return true
  }
}

/** Same-origin transport keeps the HttpOnly customer cookie first-party, including in Safari. */
export async function customerGateway(
  request: Request,
  env: {
    readonly SUPABASE_URL?: string
    readonly SUPABASE_ANON_KEY?: string
    readonly CUSTOMER_GATEWAY_SECRET?: string
    readonly GATEWAY_RATE_LIMIT?: GatewayRateLimit
  },
  endpoint: 'public-booking-actions' | 'submit-booking' = 'public-booking-actions',
): Promise<Response> {
  if (request.method !== 'POST') return gatewayError('method_not_allowed', 405, { Allow: 'POST' })
  const origin = new URL(request.url).origin
  if (request.headers.get('Origin') !== origin) return gatewayError('origin_not_allowed', 403)
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') {
    return gatewayError('invalid_payload', 415)
  }
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.CUSTOMER_GATEWAY_SECRET ||
    env.CUSTOMER_GATEWAY_SECRET.length < 32
  ) {
    return gatewayError('not_configured', 503, {
      'Retry-After': String(NOT_CONFIGURED_RETRY_SECONDS),
    })
  }

  const reader = request.body?.getReader()
  if (!reader) return gatewayError('invalid_payload', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return gatewayError('invalid_payload', 413)
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
  const cookies = CUSTOMER_COOKIE_NAMES.flatMap((name) => {
    const value = customerCookie(request, name)
    return value === null ? [] : [`${name}=${value}`]
  })
  if (cookies.length > 0) upstreamHeaders.set('Cookie', cookies.join('; '))
  // Cloudflare rewrites CF-Connecting-IP on cross-zone subrequests. Authenticate our own header.
  const ip = request.headers.get('CF-Connecting-IP')
  if (!ip) return gatewayError('system', 502)
  const textBody = new TextDecoder().decode(body)
  // One count for each client and action, an IPv6 client being its /64 (limiterClient). The
  // booking submission is not counted here: its database limiter is the limit on that path, and a
  // second one could only refuse sooner. The signature below carries the address as received.
  if (
    endpoint === 'public-booking-actions' &&
    !(await withinRateLimit(
      env.GATEWAY_RATE_LIMIT,
      `${countedAction(textBody)}:${limiterClient(ip)}`,
    ))
  ) {
    return gatewayError('rate_limited', 429, {
      'Retry-After': String(GATEWAY_RATE_LIMIT_PERIOD_SECONDS),
    })
  }
  const signed = await signCustomerGateway(env.CUSTOMER_GATEWAY_SECRET, ip, origin, textBody)
  for (const [name, value] of Object.entries(signed)) upstreamHeaders.set(name, value)

  try {
    const upstream = await fetch(`${env.SUPABASE_URL}/functions/v1/${endpoint}`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: textBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel()
      return gatewayError('system', 502)
    }
    const responseHeaders = ownHeaders(GATEWAY_HEADERS)
    // The one 503 Edge itself answers is a function without its secrets, as the gateway's own is,
    // and Edge names no time: the relayed answer carries the gateway's.
    if (upstream.status === 503) {
      responseHeaders.set('Retry-After', String(NOT_CONFIGURED_RETRY_SECONDS))
    }
    for (const cookie of upstream.headers.getSetCookie()) {
      if (CUSTOMER_COOKIE_NAMES.some((name) => cookie.startsWith(`${name}=`))) {
        responseHeaders.append('Set-Cookie', cookie.replace('SameSite=None', 'SameSite=Lax'))
      }
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch {
    return gatewayError('system', 502)
  }
}
