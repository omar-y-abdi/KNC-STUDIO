import { afterEach, describe, expect, it, vi } from 'vitest'

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
