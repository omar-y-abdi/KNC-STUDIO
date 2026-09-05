import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
    expect(readFileSync('src/app/App.tsx', 'utf8')).toContain('PrivacyBanner')
    expect(readFileSync('src/site/storageConsent.ts', 'utf8')).toContain(
      'bladeblend_storage_preferences',
    )
    expect(readFileSync('src/site/PrivacyBanner.tsx', 'utf8')).toContain('functional-storage')
  })

  it('keeps public smoke free of phone-memory while privacy controls remain mounted', () => {
    const smoke = readFileSync('tools/e2e/smoke.mjs', 'utf8')

    expect(smoke).not.toContain('bladeblend_mybookings_phone')
    expect(readFileSync('src/app/App.tsx', 'utf8')).toContain('PrivacyBanner')
    expect(readFileSync('src/site/PrivacyBanner.tsx', 'utf8')).toContain('functional-storage')
  })

  it('retains only same-tab access-token handling for authorized My Bookings use', () => {
    const adapter = readFileSync('src/mybookings/adapters/supabaseMyBookings.ts', 'utf8')

    expect(adapter).not.toContain('rememberCustomerAccessToken')
    expect(adapter).not.toContain('sessionStorage')
  })
})
