const CUSTOMER_ACCESS_KEY = 'bladeblend.customer-booking-access'
const TOKEN = /^[0-9a-f]{64}$/i

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

export function rememberCustomerAccessToken(token: string): void {
  if (!TOKEN.test(token)) return
  try {
    storage()?.setItem(CUSTOMER_ACCESS_KEY, token)
  } catch {
    // Session persistence is a convenience only; server authorization still fails closed without it.
  }
}

export function currentCustomerAccessToken(): string | null {
  try {
    const value = storage()?.getItem(CUSTOMER_ACCESS_KEY) ?? null
    if (value === null) return null
    if (TOKEN.test(value)) return value
    storage()?.removeItem(CUSTOMER_ACCESS_KEY)
    return null
  } catch {
    return null
  }
}

export function forgetCustomerAccessToken(expected?: string): void {
  try {
    const target = storage()
    if (target === null) return
    if (expected !== undefined && target.getItem(CUSTOMER_ACCESS_KEY) !== expected) return
    target.removeItem(CUSTOMER_ACCESS_KEY)
  } catch {
    // Ignore unavailable session storage.
  }
}
