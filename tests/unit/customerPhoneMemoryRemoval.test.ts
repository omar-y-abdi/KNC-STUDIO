import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const retainedSources = [
  'src/app/App.tsx',
  'src/i18n/index.ts',
  'src/i18n/sv.ts',
  'src/i18n/en.ts',
  'src/mybookings/adapters/supabaseMyBookings.ts',
  'src/site/PrivacyBanner.tsx',
  'src/site/storageConsent.ts',
  'public/privacy.html',
] as const

describe('customer phone-memory removal contract', () => {
  it('keeps privacy controls while removing remembered-phone semantics', () => {
    for (const path of retainedSources) {
      const source = readFileSync(path, 'utf8')

      expect(source, path).not.toContain('bladeblend_mybookings_phone')
    }
    expect(readFileSync('src/site/storageConsent.ts', 'utf8')).toContain(
      'bladeblend_storage_preferences',
    )
    expect(readFileSync('src/site/PrivacyBanner.tsx', 'utf8')).toContain('functional-storage')
  })

  it('keeps public smoke free of phone-memory while privacy controls remain mounted', () => {
    const smoke = readFileSync('tools/e2e/smoke.mjs', 'utf8')

    expect(smoke).not.toContain('bladeblend_mybookings_phone')
    expect(readFileSync('src/site/PrivacyBanner.tsx', 'utf8')).toContain('functional-storage')
  })

  it('retains only same-tab access-token handling for authorized My Bookings use', () => {
    const adapter = readFileSync('src/mybookings/adapters/supabaseMyBookings.ts', 'utf8')

    expect(adapter).not.toContain('rememberCustomerAccessToken')
    expect(adapter).not.toContain('sessionStorage')
  })
})

describe('current public storage choice', () => {
  afterEach(() => vi.unstubAllGlobals())

  async function storage(initial = '', blocked = false) {
    vi.resetModules()
    let cookie = initial
    vi.stubGlobal('document', {
      get cookie() {
        return cookie
      },
      set cookie(value: string) {
        if (!blocked) cookie = value.split(';')[0] ?? ''
      },
    })
    const consent = await import('../../src/site/storageConsent')
    return {
      ...consent,
      changeCookie: (value: string) => {
        cookie = value
      },
    }
  }

  it('keeps no choice distinct from an explicit rejection', async () => {
    const consent = await storage()
    expect(consent.readStoragePreferences()).toBeNull()
    consent.saveStoragePreferences({ functional: false })
    expect(consent.readStoragePreferences()).toEqual({ functional: false })
  })

  it('keeps the current explicit choice when cookies are blocked or an old cookie cannot be replaced', async () => {
    for (const prior of ['', 'bladeblend_storage_preferences=functional']) {
      const consent = await storage(prior, true)
      consent.saveStoragePreferences({ functional: false })
      expect(consent.readStoragePreferences()).toEqual({ functional: false })
      consent.saveStoragePreferences({ functional: true })
      expect(consent.readStoragePreferences()).toEqual({ functional: true })
    }
  })

  it('notifies mounted controls and observes a later cookie change from another tab', async () => {
    const consent = await storage()
    const changed = vi.fn()
    const unsubscribe = consent.subscribeStoragePreferences(changed)
    consent.saveStoragePreferences({ functional: true })
    expect(changed).toHaveBeenCalledOnce()
    consent.changeCookie('bladeblend_storage_preferences=essential')
    expect(consent.readStoragePreferences()).toEqual({ functional: false })
    unsubscribe()
    consent.saveStoragePreferences({ functional: true })
    expect(changed).toHaveBeenCalledOnce()
  })
})
