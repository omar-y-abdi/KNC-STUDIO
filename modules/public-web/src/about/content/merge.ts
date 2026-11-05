// Pure merge logic for the About section's copy + per-barber stylist copy. Extracted so it is
// unit-testable without React: no effects, no I/O — given the i18n base + the DB overlay/roster, it
// returns the rendered strings. The CRITICAL invariant lives here: an EMPTY overlay yields the i18n
// base UNCHANGED (the mock/baseline path), and a present key overrides exactly that key.

import type { AboutStrings, Lang } from '../../i18n/index'
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
 * Role + bio for one database roster entry, mapped to active language. Missing copy renders
 * name/handle only; frontend contains no barber-specific fallback data.
 */
export function stylistCopyFor(entry: RosterBarber, lang: Lang): ResolvedStylistCopy | undefined {
  if (entry.copy === null) return undefined
  return {
    role: lang === 'sv' ? entry.copy.roleSv : entry.copy.roleEn,
    bio: lang === 'sv' ? entry.copy.bioSv : entry.copy.bioEn,
  }
}
