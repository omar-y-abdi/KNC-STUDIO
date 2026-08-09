import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHROME,
  SITE_TEXT_KEYS,
  defaultSiteText,
  parseScale,
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
      'addr',
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

describe('DEFAULT_CHROME', () => {
  it('is a neutral overlay (no text, 1.0x scales)', () => {
    expect(DEFAULT_CHROME.text).toEqual({})
    expect(DEFAULT_CHROME.homepageScale).toBe('md')
    expect(DEFAULT_CHROME.aboutScale).toBe('md')
  })
})
