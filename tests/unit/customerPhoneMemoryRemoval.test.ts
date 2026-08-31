import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const retainedSources = [
  'src/app/App.tsx',
  'src/i18n/index.ts',
  'src/i18n/sv.ts',
  'src/i18n/en.ts',
  'src/mybookings/adapters/supabaseMyBookings.ts',
  'public/privacy.html',
] as const

describe('customer phone-memory removal contract', () => {
  it('ships no remembered-phone consent or cookie flow', () => {
    for (const path of retainedSources) {
      const source = readFileSync(path, 'utf8')

      expect(source, path).not.toContain('PrivacyBanner')
      expect(source, path).not.toContain('storageConsent')
      expect(source, path).not.toContain('bladeblend_mybookings_phone')
      expect(source, path).not.toContain('bladeblend_storage_preferences')
      expect(source, path).not.toContain('functional-storage')
      expect(source, path).not.toContain('rememberPhone')
    }
  })

  it('retains only same-tab access-token handling for authorized My Bookings use', () => {
    const session = readFileSync('src/mybookings/customerAccessSession.ts', 'utf8')
    const adapter = readFileSync('src/mybookings/adapters/supabaseMyBookings.ts', 'utf8')

    expect(session).toContain('sessionStorage')
    expect(session).not.toContain('localStorage')
    expect(adapter).toContain('rememberCustomerAccessToken')
  })
})
