import { describe, expect, it } from 'vitest'
import { ownerBusiness } from '../../modules/public-web/src/app/shared'
import { DEFAULT_CHROME, type SiteChrome } from '../../modules/public-web/src/site/siteChrome'
import { resolveSiteChromeSnapshot } from '../../modules/public-web/src/site/useSiteChrome'

// What the app hands "Mina bokningar" as the salon's cancellation terms (app/App.tsx), read off the
// site chrome exactly as `useSiteChrome` resolves it.

/** The chrome of a salon whose owner allows online cancellation until 48 hours before the visit. */
const loaded: SiteChrome = {
  ...DEFAULT_CHROME,
  business: { ...DEFAULT_CHROME.business, cancellationPolicyHours: 48 },
}

describe('ownerBusiness', () => {
  it('is unknown until the site chrome has loaded, and for good when its load fails', () => {
    // The chrome on screen is the shipped default: its 24 hours are not the owner's deadline.
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
    // After a language switch the chrome on screen is the default again until the new one loads.
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
