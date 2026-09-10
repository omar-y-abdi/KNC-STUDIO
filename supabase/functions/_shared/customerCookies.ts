import { isCustomerAccessToken } from './customerAccess.ts'

export const CUSTOMER_SESSION_COOKIE = '__Host-bladeblend_customer_session'
export const CUSTOMER_RECEIPT_COOKIE = '__Host-bladeblend_booking_receipts'
export const CUSTOMER_COOKIE_NAMES = [CUSTOMER_SESSION_COOKIE, CUSTOMER_RECEIPT_COOKIE] as const

export function customerCookie(
  request: Request,
  name: (typeof CUSTOMER_COOKIE_NAMES)[number],
): string | null {
  const value = request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  return isCustomerAccessToken(value) ? value : null
}

export function customerCookieHeader(
  name: (typeof CUSTOMER_COOKIE_NAMES)[number],
  token: string,
  maxAge = 2592000,
): string {
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`
}

/** Non-bearer digest lets the browser prove that its intended HttpOnly credential survived. */
export async function customerCookieProof(
  token: string,
  kind: 'session' | 'receipt',
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`customer-${kind}-proof/v1\n${token}`),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
