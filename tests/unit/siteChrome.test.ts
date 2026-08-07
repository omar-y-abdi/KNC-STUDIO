import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHROME,
  SITE_TEXT_KEYS,
  parseScale,
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
  it('includes the booking policy and confirmation heading keys', () => {
    expect(SITE_TEXT_KEYS).toEqual(['kicker', 'hours', 'addr', 'policy', 'bookedTitle'])
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
