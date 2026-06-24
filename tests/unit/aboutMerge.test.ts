// Unit tests for the pure About-copy merge logic. The CRITICAL property is the byte-identical
// fallback: an EMPTY overlay must leave the i18n base field-for-field unchanged (the mock/baseline
// path). Plus per-key override, and the stylist-copy resolution (DB wins, i18n fallback, none → undefined).

import { describe, expect, it } from 'vitest'
import { mergeAbout, stylistCopyFor } from '../../src/about/content/merge'
import { aboutStrings } from '../../src/i18n/index'
import type { AboutOverlay } from '../../src/about/content/port'
import type { RosterBarber } from '../../src/booking/barbersPort'
import { asBarberId } from '../../src/booking/domain'

const baseSv = aboutStrings('sv')
const baseEn = aboutStrings('en')

describe('mergeAbout', () => {
  it('an EMPTY overlay returns the i18n base field-for-field (byte-identical fallback)', () => {
    const merged = mergeAbout(baseSv, {})
    // Every field equals the base — the mock path is a no-op overlay.
    expect(merged).toEqual(baseSv)
    // The non-DB fields (alts, review form, rating labels) are present + unchanged.
    expect(merged.galleryAlt).toBe(baseSv.galleryAlt)
    expect(merged.reviewSubmit).toBe(baseSv.reviewSubmit)
    expect(merged.ratingValueLabel).toBe(baseSv.ratingValueLabel)
    expect(merged.stylists).toBe(baseSv.stylists)
  })

  it('overrides ONLY the keys present in the overlay; the rest keep i18n', () => {
    const overlay: AboutOverlay = { heading: 'New heading', intro: 'New intro' }
    const merged = mergeAbout(baseEn, overlay)
    expect(merged.heading).toBe('New heading')
    expect(merged.intro).toBe('New intro')
    // Untouched editable keys keep the base.
    expect(merged.eyebrow).toBe(baseEn.eyebrow)
    expect(merged.galleryTitle).toBe(baseEn.galleryTitle)
    // Non-DB fields are untouched.
    expect(merged.reviewSubmit).toBe(baseEn.reviewSubmit)
  })

  it('all 7 editable keys can be overridden at once', () => {
    const overlay: AboutOverlay = {
      eyebrow: 'E',
      heading: 'H',
      intro: 'I',
      galleryTitle: 'G',
      cutsTitle: 'C',
      stylistsTitle: 'S',
      reviewsTitle: 'R',
    }
    const merged = mergeAbout(baseSv, overlay)
    expect(merged.eyebrow).toBe('E')
    expect(merged.heading).toBe('H')
    expect(merged.intro).toBe('I')
    expect(merged.galleryTitle).toBe('G')
    expect(merged.cutsTitle).toBe('C')
    expect(merged.stylistsTitle).toBe('S')
    expect(merged.reviewsTitle).toBe('R')
  })

  it('does not mutate the base (immutability)', () => {
    const before = aboutStrings('sv')
    mergeAbout(before, { heading: 'X' })
    expect(before.heading).toBe(aboutStrings('sv').heading)
  })
})

describe('stylistCopyFor', () => {
  const i18nStylists = baseSv.stylists

  function entry(id: string, copy: RosterBarber['copy']): RosterBarber {
    return { barber: { id: asBarberId(id), name: id, ig: id }, copy }
  }

  it('uses DB copy when present, mapped to the active language', () => {
    const e = entry('newbie', {
      roleSv: 'Mästare',
      roleEn: 'Master',
      bioSv: 'sv bio',
      bioEn: 'en bio',
    })
    expect(stylistCopyFor(e, 'sv', i18nStylists)).toEqual({ role: 'Mästare', bio: 'sv bio' })
    expect(stylistCopyFor(e, 'en', i18nStylists)).toEqual({ role: 'Master', bio: 'en bio' })
  })

  it('falls back to the i18n stylist table when the entry has no DB copy (the mock path)', () => {
    const e = entry('hassan', null)
    const copy = stylistCopyFor(e, 'sv', i18nStylists)
    expect(copy).toEqual({ role: i18nStylists.hassan.role, bio: i18nStylists.hassan.bio })
  })

  it('returns undefined when there is neither DB copy nor an i18n entry (card shows name only)', () => {
    const e = entry('unknown-barber', null)
    expect(stylistCopyFor(e, 'sv', i18nStylists)).toBeUndefined()
  })
})
