// Browser-storage choices for the public site. The consent cookie only remembers the visitor's
// optional-storage choice. It permits a server-issued receipt for new bookings on this device;
// it never authorizes customer history or replaces an essential email-verified session.

export interface StoragePreferences {
  readonly functional: boolean
}

export const STORAGE_PREFERENCES_COOKIE = 'bladeblend_storage_preferences'
export const FUNCTIONAL_PREFERENCES_VALUE = 'functional'
export const ESSENTIAL_ONLY_PREFERENCES_VALUE = 'essential'
let sessionChoice: StoragePreferences | undefined
let cookieAtChoice: string | null = null
const listeners = new Set<() => void>()

function cookieValue(cookie: string, key: string): string | null {
  const prefix = key + '='
  for (const part of cookie.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length)
  }
  return null
}

function secureAttribute(): string {
  try {
    return globalThis.location?.protocol === 'https:' ? '; Secure' : ''
  } catch {
    return ''
  }
}

/** Null means no optional-storage choice has been recorded yet. */
export function parseStoragePreferences(cookie: string): StoragePreferences | null {
  const value = cookieValue(cookie, STORAGE_PREFERENCES_COOKIE)
  if (value === FUNCTIONAL_PREFERENCES_VALUE) return { functional: true }
  if (value === ESSENTIAL_ONLY_PREFERENCES_VALUE) return { functional: false }
  return null
}

function storedValue(): string | null {
  try {
    return cookieValue(document.cookie, STORAGE_PREFERENCES_COOKIE)
  } catch {
    return null
  }
}

/** Live choice, including the current app session when the browser rejects cookie writes. */
export function readStoragePreferences(): StoragePreferences | null {
  const value = storedValue()
  if (sessionChoice !== undefined && value === cookieAtChoice) return sessionChoice
  sessionChoice = undefined
  return parseStoragePreferences(`${STORAGE_PREFERENCES_COOKIE}=${value ?? ''}`)
}

export function subscribeStoragePreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Records an explicit optional-storage choice. This never enables analytics or advertising. */
export function saveStoragePreferences(preferences: StoragePreferences): void {
  try {
    const value = preferences.functional
      ? FUNCTIONAL_PREFERENCES_VALUE
      : ESSENTIAL_ONLY_PREFERENCES_VALUE
    document.cookie = `${STORAGE_PREFERENCES_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secureAttribute()}`
  } catch {
    // Keep the explicit choice in this app session even when the browser blocks persistence.
  }
  sessionChoice = { functional: preferences.functional }
  cookieAtChoice = storedValue()
  for (const listener of listeners) listener()
}
