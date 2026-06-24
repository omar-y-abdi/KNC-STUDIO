// Pure merge logic for the About section's copy + per-barber stylist copy. Extracted so it is
// unit-testable without React: no effects, no I/O — given the i18n base + the DB overlay/roster, it
// returns the rendered strings. The CRITICAL invariant lives here: an EMPTY overlay yields the i18n
// base UNCHANGED (the mock/baseline path), and a present key overrides exactly that key.

import type { AboutStrings, Lang, StylistCopy } from '../../i18n/index'
import type { RosterBarber } from '../../booking/barbersPort'
import type { AboutOverlay } from './port'

/**
 * Merge the DB overlay (only the 7 editable keys) over the i18n base. A key present in the overlay
 * wins; a missing key keeps the i18n value. The ~13 non-DB fields (alts, the review form, rating
 * labels) always come straight from `base`. With an EMPTY overlay this returns a value field-equal to
 * `base` — the byte-identical mock/baseline path.
 */
export function mergeAbout(base: AboutStrings, overlay: AboutOverlay): AboutStrings {
  return {
    ...base,
    eyebrow: overlay.eyebrow ?? base.eyebrow,
    heading: overlay.heading ?? base.heading,
    intro: overlay.intro ?? base.intro,
    galleryTitle: overlay.galleryTitle ?? base.galleryTitle,
    cutsTitle: overlay.cutsTitle ?? base.cutsTitle,
    stylistsTitle: overlay.stylistsTitle ?? base.stylistsTitle,
    reviewsTitle: overlay.reviewsTitle ?? base.reviewsTitle,
  }
}

/** The role + bio shown on a stylist card (already resolved to the active language). */
export interface ResolvedStylistCopy {
  readonly role: string
  readonly bio: string
}

/**
 * The role + bio for one roster entry. DB copy wins (mapped to `lang`); otherwise the i18n `stylists`
 * table (a string-keyed view, so an OPEN `BarberId` indexes it). Returns `undefined` when neither has
 * copy — the card then renders just the name + handle (the original guard behaviour). Under the mock,
 * `entry.copy` is null and the seeded ids hit the i18n table, so the 3 constant cards are unchanged.
 */
export function stylistCopyFor(
  entry: RosterBarber,
  lang: Lang,
  i18nStylists: Readonly<Record<string, StylistCopy>>,
): ResolvedStylistCopy | undefined {
  if (entry.copy !== null) {
    return {
      role: lang === 'sv' ? entry.copy.roleSv : entry.copy.roleEn,
      bio: lang === 'sv' ? entry.copy.bioSv : entry.copy.bioEn,
    }
  }
  const fromI18n: StylistCopy | undefined = i18nStylists[entry.barber.id]
  return fromI18n ? { role: fromI18n.role, bio: fromI18n.bio } : undefined
}
