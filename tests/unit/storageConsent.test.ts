import { describe, expect, it } from 'vitest'
import {
  ESSENTIAL_ONLY_PREFERENCES_VALUE,
  FUNCTIONAL_PREFERENCES_VALUE,
  PHONE_MEMORY_COOKIE,
  parseStoragePreferences,
  STORAGE_PREFERENCES_COOKIE,
} from '../../src/site/storageConsent'

describe('public storage-consent cookie contract', () => {
  it('recognises only the explicit functional opt-in', () => {
    expect(
      parseStoragePreferences(`${STORAGE_PREFERENCES_COOKIE}=${FUNCTIONAL_PREFERENCES_VALUE}`),
    ).toEqual({ functional: true })
    expect(
      parseStoragePreferences(`${STORAGE_PREFERENCES_COOKIE}=${ESSENTIAL_ONLY_PREFERENCES_VALUE}`),
    ).toEqual({ functional: false })
  })

  it('keeps absent, malformed, and lookalike cookies opt-out by default', () => {
    expect(parseStoragePreferences('')).toBeNull()
    expect(parseStoragePreferences(`${STORAGE_PREFERENCES_COOKIE}=yes`)).toBeNull()
    expect(
      parseStoragePreferences(`x_${STORAGE_PREFERENCES_COOKIE}=${FUNCTIONAL_PREFERENCES_VALUE}`),
    ).toBeNull()
    expect(PHONE_MEMORY_COOKIE).toBe('bladeblend_mybookings_phone')
  })
})
