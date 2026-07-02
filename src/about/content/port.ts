// The "backend-ready" seam for the editable ABOUT COPY (the `about_content` table) + the per-barber
// stylist copy (role/bio, which live on `barbers`). The public About section depends on this
// interface only.
//
// HYBRID by design: `about_content` carries ONLY 7 keys (eyebrow, heading, intro, galleryTitle,
// cutsTitle, stylistsTitle, reviewsTitle). The About section renders ~20 strings — alt texts, the
// whole review form, the rating labels — which are NOT in the DB and ALWAYS come from i18n. So the
// port returns a PARTIAL overlay (only the keys that exist), and the component merges it over the
// i18n base (`aboutStrings(lang)`): a present key wins, a missing key keeps the i18n value. The mock
// returns an EMPTY overlay, so the section is byte-identical to today's i18n copy.

import type { Lang } from '../../i18n/index'

/** The DB-editable About keys (exactly the `about_content.key` set). */
export type AboutContentKey =
  'eyebrow' | 'heading' | 'intro' | 'galleryTitle' | 'cutsTitle' | 'stylistsTitle' | 'reviewsTitle'

/**
 * A partial overlay of the 7 editable keys for one language. Every key is optional: a key the owner
 * has not set (or that simply has no row) is absent, and the component keeps the i18n default. Empty
 * under the mock.
 */
export type AboutOverlay = Readonly<Partial<Record<AboutContentKey, string>>>

export interface AboutContentPort {
  /**
   * The editable-copy overlay for `lang` (only the keys present in `about_content`). Resolves to an
   * EMPTY overlay under the mock (i18n is the whole source); reads `about_content` under Supabase.
   */
  overlay(lang: Lang): Promise<AboutOverlay>
}
