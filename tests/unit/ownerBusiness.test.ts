import { describe, expect, it } from 'vitest'
import { ownerBusiness } from '../../modules/public-web/src/app/shared'
import { DEFAULT_CHROME, type SiteChrome } from '../../modules/public-web/src/site/siteChrome'
import { resolveSiteChromeSnapshot } from '../../modules/public-web/src/site/useSiteChrome'

const loaded: SiteChrome = {
  ...DEFAULT_CHROME,
  business: { ...DEFAULT_CHROME.business, cancellationPolicyHours: 48 },
}

describe('ownerBusiness', () => {
  it('is unknown until the site chrome has loaded, and for good when its load fails', () => {
    // 24 is the shipped default, not the owner's deadline.
    const before = resolveSiteChromeSnapshot({}, 'sv', false)
    expect(before.chrome.business.cancellationPolicyHours).toBe(24)
    expect(ownerBusiness(before)).toBe('unknown')
  })

  it('is the loaded settings once the chrome of the language shown has come from the server', () => {
    expect(ownerBusiness(resolveSiteChromeSnapshot({ sv: loaded }, 'sv', false))).toBe(
      loaded.business,
    )
  })

  it('is unknown in a language whose chrome has not loaded, whatever the other language holds', () => {
    expect(ownerBusiness(resolveSiteChromeSnapshot({ sv: loaded }, 'en', false))).toBe('unknown')
  })

  it('is the default without a backend, where the default is all there is', () => {
    const offline = resolveSiteChromeSnapshot(
      { sv: DEFAULT_CHROME, en: DEFAULT_CHROME },
      'sv',
      true,
    )
    expect(ownerBusiness(offline)).toBe(DEFAULT_CHROME.business)
  })
})
