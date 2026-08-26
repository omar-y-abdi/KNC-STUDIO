// Device registration for Mina bokningar. A phone is written only after a valid email token lists
// its bookings, and only after the customer opted into functional storage in the privacy banner.
// This cookie is convenience metadata, never an authorization input.

const PHONE_COOKIE = 'bladeblend_mybookings_phone'
const PREFERENCES_COOKIE = 'bladeblend_storage_preferences'

function cookieValue(name: string): string | null {
  try {
    for (const entry of document.cookie.split(';')) {
      const [rawName, ...rawValue] = entry.trim().split('=')
      if (rawName === name) return decodeURIComponent(rawValue.join('='))
    }
  } catch {
    // Cookie access unavailable.
  }
  return null
}

function functionalStorageAllowed(): boolean {
  return cookieValue(PREFERENCES_COOKIE) === 'functional'
}

function secureAttribute(): string {
  try {
    return location.protocol === 'https:' ? '; Secure' : ''
  } catch {
    return ''
  }
}

/** Persist the proven phone on this device. Best-effort: a storage failure (private mode / disabled
 * storage) is intentionally non-fatal — remembering is a convenience, not a requirement. */
export function rememberPhone(phone: string): void {
  if (!/^07[0-9]{8}$/.test(phone) || !functionalStorageAllowed()) return
  try {
    document.cookie = `${PHONE_COOKIE}=${encodeURIComponent(phone)}; Max-Age=31536000; Path=/; SameSite=Lax${secureAttribute()}`
  } catch {
    // Cookie access unavailable; booking access itself remains in-memory and unaffected.
  }
}

/** The phone remembered on this device, or null if none is stored / storage is unavailable. */
export function recalledPhone(): string | null {
  if (!functionalStorageAllowed()) return null
  const value = cookieValue(PHONE_COOKIE)
  return value !== null && /^07[0-9]{8}$/.test(value) ? value : null
}

export function forgetPhone(): void {
  try {
    document.cookie = `${PHONE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secureAttribute()}`
  } catch {
    // Cookie access unavailable.
  }
}
