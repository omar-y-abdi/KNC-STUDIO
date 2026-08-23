// Shared Google Calendar helpers for the calendar-* edge functions.
//
// This module is deliberately runtime-agnostic: it uses ONLY Web-standard globals (crypto.subtle,
// fetch, TextEncoder/Decoder, atob/btoa, URLSearchParams) and imports nothing from esm.sh or `Deno.*`.
// That keeps it importable from BOTH the Deno edge runtime AND Node/vitest, so the pure parts
// (buildEvent, signState/verifyState) are unit-tested in `tests/unit/calendar.test.ts`.
//
// Split (RULES.md — pure core, impure shell):
//   * PURE:   buildEvent, buildAuthUrl, signState/verifyState, decodeIdTokenEmail.
//   * EFFECT: exchangeCode, refreshAccessToken, insertEvent, patchEvent, deleteEvent, revokeToken —
//             each is a thin `fetch` wrapper that throws on an unexpected non-2xx (the caller decides
//             how to surface it). Idempotent no-ops (event already gone) are swallowed on purpose.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_REQUEST_TIMEOUT_MS = 20_000

function googleRequestSignal(): AbortSignal {
  return AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS)
}

/** Scopes: calendar.events.owned is the sensitive one (needs Google verification for production tokens);
 *  openid+email are non-sensitive and only used to show "connected as <email>" in the panel. */
export const OAUTH_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events.owned'
/** All appointment times render in the salon's wall-clock, regardless of the barber's device tz. */
export const SALON_TZ = 'Europe/Stockholm'

// --- base64url + HMAC (Web Crypto) ---------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const bin = atob(padded + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return new Uint8Array(sig)
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// --- OAuth `state` (CSRF token that also binds the barber id) ------------------------------------

export interface StatePayload {
  /** The authenticated barber the connect flow is for — set from current_barber_id() in start. */
  readonly barber_id: string
  /** Issued-at, epoch SECONDS. verifyState rejects tokens older than maxAgeSec. */
  readonly iat: number
  /** Optional app origin to link back to from the callback page (never auto-redirected). */
  readonly return_to?: string
}

/** Sign `{barber_id, iat}` into `body.sig` (HMAC-SHA256, base64url). Tamper-evident, not encrypted. */
export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = b64urlEncode(await hmacSha256(secret, body))
  return `${body}.${sig}`
}

/** Verify a state token: signature valid, well-formed, and not older than maxAgeSec at `nowMs`.
 *  `nowMs` is injected (not read from the clock here) so the check is pure + testable. */
export async function verifyState(
  token: string,
  secret: string,
  maxAgeSec: number,
  nowMs: number,
): Promise<StatePayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const body = parts[0]
  const sig = parts[1]
  if (body === undefined || sig === undefined) return null

  const expected = b64urlEncode(await hmacSha256(secret, body))
  if (!timingSafeEqual(sig, expected)) return null

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(body)))
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    if (typeof p['barber_id'] !== 'string' || typeof p['iat'] !== 'number') return null
    const nowSec = nowMs / 1000
    if (nowSec - p['iat'] > maxAgeSec) return null // expired
    if (p['iat'] - nowSec > 60) return null // implausibly future-dated
    const returnTo = typeof p['return_to'] === 'string' ? p['return_to'] : undefined
    return returnTo === undefined
      ? { barber_id: p['barber_id'], iat: p['iat'] }
      : { barber_id: p['barber_id'], iat: p['iat'], return_to: returnTo }
  } catch {
    return null
  }
}

// --- Consent URL + event body (PURE) -------------------------------------------------------------

/** Build the Google consent URL. access_type=offline + prompt=consent guarantees a refresh_token on
 *  every consent (so a reconnect always yields a fresh, storable token). */
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

/** The booking fields needed to build (and identify) a calendar event. */
export interface BookingEventInput {
  readonly service_name: string
  readonly customer_name: string
  readonly phone: string | null
  readonly start_at: string // RFC3339 / ISO instant (unambiguous with the tz below)
  readonly end_at: string
}

export interface GoogleEventBody {
  readonly summary: string
  readonly description: string
  readonly start: { readonly dateTime: string; readonly timeZone: string }
  readonly end: { readonly dateTime: string; readonly timeZone: string }
  readonly reminders: {
    readonly useDefault: false
    readonly overrides: ReadonlyArray<{ readonly method: 'popup'; readonly minutes: number }>
  }
}

/** Stable Google event id for one booking. Google accepts base32hex characters; UUID hex digits
 * satisfy that alphabet. Retries therefore target one event when Google committed an insert before
 * its response or the local mapping was lost. */
export function googleEventId(bookingId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId)
  ) {
    throw new Error('invalid booking id')
  }
  return `bbs${bookingId.replaceAll('-', '').toLowerCase()}`
}

/** Map a booking to the Google Calendar event body. Customer name and service identify the visit;
 * contact details stay inside the booking system. A 30-min popup reminder fires before the slot. */
export function buildEvent(b: BookingEventInput): GoogleEventBody {
  return {
    summary: `${b.customer_name} — ${b.service_name}`,
    description: `Kund: ${b.customer_name}\nTjänst: ${b.service_name}`,
    start: { dateTime: b.start_at, timeZone: SALON_TZ },
    end: { dateTime: b.end_at, timeZone: SALON_TZ },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
  }
}

/** Read the `email` claim out of a Google id_token WITHOUT verifying the signature — the token came
 *  straight from Google's TLS token endpoint, and the value is only used as a display string. */
export function decodeIdTokenEmail(idToken: string): string | null {
  const parts = idToken.split('.')
  const payloadSeg = parts[1]
  if (payloadSeg === undefined) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadSeg)))
    if (typeof parsed !== 'object' || parsed === null) return null
    const email = (parsed as Record<string, unknown>)['email']
    return typeof email === 'string' ? email : null
  } catch {
    return null
  }
}

// --- Google HTTP (EFFECT; each throws on an unexpected non-2xx) -----------------------------------

/** A Google HTTP failure carrying the status + a short body snippet, so a caller can CLASSIFY it
 *  (e.g. retry only transient failures) instead of string-parsing a message. Extends Error, and its
 *  `message` keeps the old `"<context>: <status>"` shape, so existing message-based logging is
 *  unaffected. */
export class GoogleHttpError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, context: string, body: string) {
    super(`${context}: ${status}`)
    this.name = 'GoogleHttpError'
    this.status = status
    this.body = body
  }
}

/** Build a GoogleHttpError from a non-2xx response, capturing a short body snippet for classification.
 *  The body read is diagnostic only — a read failure must never mask the status. */
async function httpError(res: Response, context: string): Promise<GoogleHttpError> {
  let body = ''
  try {
    body = (await res.text()).slice(0, 300)
  } catch {
    // ignore — the status is the load-bearing signal
  }
  return new GoogleHttpError(res.status, context, body)
}

/** Transient = worth retrying: 429 (rate limit), any 5xx, and the 403 a freshly-enabled Calendar API
 *  returns for the first few minutes of its first use in a project (SERVICE_DISABLED /
 *  accessNotConfigured), which self-heals. Everything else (bad code, invalid_grant, 404) is permanent
 *  and MUST NOT be retried. */
export function isTransientGoogleError(err: unknown): boolean {
  if (!(err instanceof GoogleHttpError)) return false
  if (err.status === 429 || err.status >= 500) return true
  return (
    err.status === 403 &&
    /SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(err.body)
  )
}

/** A user must reauthorize when Google rejects the stored grant. Mappings remain durable until the
 * same account grants access again; transient failures keep normal automatic retries. */
export function isGoogleAuthorizationError(err: unknown): boolean {
  if (!(err instanceof GoogleHttpError) || isTransientGoogleError(err)) return false
  return (
    err.status === 401 ||
    err.status === 403 ||
    (err.status === 400 && /invalid_grant/i.test(err.body))
  )
}

export interface RetryOptions {
  readonly retries: number
  readonly delayMs: number
  /** Injected so tests don't wait on the wall clock (effect at the edge). */
  readonly sleep?: (ms: number) => Promise<void>
}

/** Run `fn`, retrying ONLY transient Google failures with linear backoff. A non-transient error — or
 *  the final attempt — rethrows. PRECONDITION: `fn` is safe to re-run after a throw (a failed insert
 *  created no event), so a retry cannot duplicate work. */
export async function withGoogleRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)))
  let lastErr: unknown
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === opts.retries || !isTransientGoogleError(err)) throw err
      await sleep(opts.delayMs * (attempt + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('withGoogleRetry: exhausted')
}

export interface TokenResponse {
  readonly access_token: string
  readonly refresh_token?: string
  readonly id_token?: string
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: googleRequestSignal(),
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw await httpError(res, 'google token exchange failed')
  return (await res.json()) as TokenResponse
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: googleRequestSignal(),
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw await httpError(res, 'google token refresh failed')
  const data = (await res.json()) as { access_token?: unknown }
  if (typeof data.access_token !== 'string')
    throw new Error('google token refresh: no access_token')
  return data.access_token
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleEventBody,
): Promise<string> {
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...event, id: eventId }),
    signal: googleRequestSignal(),
  })
  // Booking-derived id makes duplicate-id 409 the desired existing event, not a random collision.
  if (res.status === 409) return eventId
  if (!res.ok) throw await httpError(res, 'google event insert failed')
  const data = (await res.json()) as { id?: unknown }
  if (typeof data.id !== 'string') throw new Error('google event insert: no id')
  return data.id
}

/** Patch an existing event. Returns false when Google reports it gone (404/410) so the caller can
 *  re-insert; returns true on success. Throws on any other non-2xx. */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: GoogleEventBody,
): Promise<boolean> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: googleRequestSignal(),
    },
  )
  if (res.status === 404 || res.status === 410) return false
  if (!res.ok) throw await httpError(res, 'google event patch failed')
  return true
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: googleRequestSignal(),
    },
  )
  // Success (204) or already gone (404/410) are both the desired end-state.
  if (res.ok || res.status === 404 || res.status === 410) return
  throw await httpError(res, 'google event delete failed')
}

/** Revoke a refresh token. Google's 400 means token is already invalid/revoked, which is also the
 * desired idempotent end state. Network and server failures remain retryable. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: googleRequestSignal(),
    })
    return res.ok || res.status === 400
  } catch {
    return false
  }
}
