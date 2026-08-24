// Browser-storage choices for the public site. The consent cookie exists only to remember and
// respect a visitor's decision. Optional storage currently means one first-party cookie that
// remembers a Mina bokningar phone number; analytics, advertising and cross-site tracking are absent.

export interface StoragePreferences {
  readonly functional: boolean
}

export const STORAGE_PREFERENCES_COOKIE = 'bladeblend_storage_preferences'
export const FUNCTIONAL_PREFERENCES_VALUE = 'functional'
export const ESSENTIAL_ONLY_PREFERENCES_VALUE = 'essential'
export const PHONE_MEMORY_COOKIE = 'bladeblend_mybookings_phone'

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

export function readStoragePreferences(): StoragePreferences | null {
  try {
    return parseStoragePreferences(document.cookie)
  } catch {
    return null
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
    // Cookies may be disabled; in that case no optional data is retained.
  }
}

/** The remembered phone is optional convenience storage and must stay off without an opt-in. */
export function functionalStorageAllowed(): boolean {
  return readStoragePreferences()?.functional === true
}

/** Withdraw optional phone-memory consent by deleting its exact first-party cookie. */
export function clearFunctionalStorage(): void {
  try {
    document.cookie = `${PHONE_MEMORY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureAttribute()}`
  } catch {
    // No document in a non-browser test/runtime.
  }
}
