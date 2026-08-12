import { describe, it, expect } from 'vitest'
import {
  BUSINESS_SETTING_KEYS,
  DEFAULT_CHROME,
  SITE_SETTING_KEYS,
  SITE_TEXT_KEYS,
  defaultSiteText,
  parseCancellationPolicyHours,
  parseScale,
  resolveBusinessSettings,
  resolveSiteText,
  scalePx,
  textOrDefault,
  SIZE_PRESETS,
} from '../../src/site/siteChrome'

describe('parseScale', () => {
  it('passes through the four valid presets', () => {
    for (const p of SIZE_PRESETS) expect(parseScale(p)).toBe(p)
  })

  it('defaults unknown / null / undefined to md', () => {
    expect(parseScale('banana')).toBe('md')
    expect(parseScale(null)).toBe('md')
    expect(parseScale(undefined)).toBe('md')
    expect(parseScale('')).toBe('md')
  })
})

describe('scalePx', () => {
  it('md is the identity (base unchanged)', () => {
    expect(scalePx(13, 'md')).toBe(13)
    expect(scalePx(34, 'md')).toBe(34)
  })

  it('sm shrinks, lg/xl grow, all rounded to whole px', () => {
    expect(scalePx(20, 'sm')).toBe(18) // 20 * 0.9
    expect(scalePx(25, 'lg')).toBe(28) // 25 * 1.12
    expect(scalePx(20, 'xl')).toBe(25) // 20 * 1.25
  })

  it('stays monotonic across presets for a fixed base', () => {
    const base = 16
    const sizes = SIZE_PRESETS.map((p) => scalePx(base, p))
    const sorted = [...sizes].sort((a, b) => a - b)
    expect(sizes).toEqual(sorted)
  })
})

describe('editable public copy', () => {
  it('includes every non-button string visible in the booking details and confirmation dialogs', () => {
    expect(SITE_TEXT_KEYS).toEqual([
      'kicker',
      'hours',
      'yourDetails',
      'summary',
      'fBarber',
      'fWhen',
      'fService',
      'fTotal',
      'name',
      'namePh',
      'phone',
      'phonePh',
      'policy',
      'bookedTitle',
      'confirmSent',
      'addToCal',
    ])
  })

  it('provides the current localized copy when the database has no saved rows', () => {
    const defaults = defaultSiteText('sv')
    expect(defaults.yourDetails).toBe('Dina uppgifter')
    expect(defaults.phonePh).toBe('07X XXX XX XX')
    expect(defaults.policy).toContain('Vid bokning accepterar du')
    expect(defaults.bookedTitle).toBe('Tack — din tid är bokad!')
    expect(defaults.confirmSent).toContain('skickats till {email}')
  })

  it('interpolates the owner-managed cancellation deadline into shipped policy copy', () => {
    expect(defaultSiteText('sv', 48, 'Northside Barbers').policy).toContain('48 timmar')
    expect(defaultSiteText('en', 12, 'Northside Barbers').policy).toContain('12 hours')
    expect(defaultSiteText('sv', 48, 'Northside Barbers').policy).toContain('Northside Barbers')
  })

  it('overlays saved copy but keeps defaults for missing or blank rows', () => {
    const resolved = resolveSiteText(
      { yourDetails: 'Anpassad rubrik', policy: '   ', confirmSent: 'SMS: {phone}' },
      'sv',
    )
    expect(resolved.yourDetails).toBe('Anpassad rubrik')
    expect(resolved.policy).toContain('Vid bokning accepterar du')
    expect(resolved.confirmSent).toBe('SMS: {phone}')
  })

  it('uses defaults for blank editor values while preserving non-blank copy', () => {
    expect(textOrDefault(undefined, 'Default')).toBe('Default')
    expect(textOrDefault('   ', 'Default')).toBe('Default')
    expect(textOrDefault('Saved copy', 'Default')).toBe('Saved copy')
  })
})

describe('business settings', () => {
  it('includes the complete owner-editable business and SEO setting set', () => {
    expect(SITE_SETTING_KEYS).toEqual([
      'homepage_scale',
      'about_scale',
      'business_name',
      'business_email',
      'business_phone_display',
      'business_phone_tel',
      'business_street',
      'business_postal_code',
      'business_city',
      'business_maps_href',
      'cancellation_policy_hours',
      'seo_title_sv',
      'seo_description_sv',
      'seo_title_en',
      'seo_description_en',
    ])
  })

  it('resolves every business identity and language-specific SEO value from settings', () => {
    const business = resolveBusinessSettings(
      new Map([
        [BUSINESS_SETTING_KEYS.name, 'Northside Barbers'],
        [BUSINESS_SETTING_KEYS.email, 'hello@northside.example'],
        [BUSINESS_SETTING_KEYS.phoneDisplay, '08-123 45 67'],
        [BUSINESS_SETTING_KEYS.phoneTel, '+4681234567'],
        [BUSINESS_SETTING_KEYS.street, 'Kungsgatan 1'],
        [BUSINESS_SETTING_KEYS.postalCode, '111 43'],
        [BUSINESS_SETTING_KEYS.city, 'Stockholm'],
        [BUSINESS_SETTING_KEYS.mapsHref, 'https://maps.example.com/northside'],
        [BUSINESS_SETTING_KEYS.cancellationPolicyHours, '48'],
        [BUSINESS_SETTING_KEYS.seo.sv.title, 'Northside – Boka tid'],
        [BUSINESS_SETTING_KEYS.seo.sv.description, 'Svensk beskrivning'],
        [BUSINESS_SETTING_KEYS.seo.en.title, 'Northside – Book online'],
        [BUSINESS_SETTING_KEYS.seo.en.description, 'English description'],
      ]),
    )

    expect(business).toEqual({
      name: 'Northside Barbers',
      email: 'hello@northside.example',
      phoneDisplay: '08-123 45 67',
      phoneTel: '+4681234567',
      street: 'Kungsgatan 1',
      postalCode: '111 43',
      city: 'Stockholm',
      mapsHref: 'https://maps.example.com/northside',
      cancellationPolicyHours: 48,
      seo: {
        sv: { title: 'Northside – Boka tid', description: 'Svensk beskrivning' },
        en: { title: 'Northside – Book online', description: 'English description' },
      },
    })
  })

  it('rejects malformed contact, maps, and cancellation settings in favour of safe defaults', () => {
    const business = resolveBusinessSettings(
      new Map([
        [BUSINESS_SETTING_KEYS.email, 'not-an-email'],
        [BUSINESS_SETTING_KEYS.phoneTel, 'javascript:alert(1)'],
        [BUSINESS_SETTING_KEYS.mapsHref, 'javascript:alert(1)'],
        [BUSINESS_SETTING_KEYS.cancellationPolicyHours, '0'],
      ]),
    )

    expect(business.email).toBe(DEFAULT_CHROME.business.email)
    expect(business.phoneTel).toBe(DEFAULT_CHROME.business.phoneTel)
    expect(business.mapsHref).toBe(DEFAULT_CHROME.business.mapsHref)
    expect(business.cancellationPolicyHours).toBe(DEFAULT_CHROME.business.cancellationPolicyHours)
    expect(parseCancellationPolicyHours('169')).toBe(
      DEFAULT_CHROME.business.cancellationPolicyHours,
    )
  })
})

describe('DEFAULT_CHROME', () => {
  it('is a neutral overlay with safe business fallbacks and 1.0x scales', () => {
    expect(DEFAULT_CHROME.text).toEqual({})
    expect(DEFAULT_CHROME.business.name).toBe('Blade & Blend Studio')
    expect(DEFAULT_CHROME.homepageScale).toBe('md')
    expect(DEFAULT_CHROME.aboutScale).toBe('md')
  })
})
