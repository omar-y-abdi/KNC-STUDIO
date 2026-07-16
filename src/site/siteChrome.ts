// Shared model for the owner-editable homepage chrome (Task 2 §2): the bilingual text overlay
// (kicker / hours / address) + the two per-section font-size presets. Pure — no effects — so the
// scale math is unit-testable and the whole thing has one source of truth.
//
// Font size is a BOUNDED preset (never a free px value): four gentle multipliers the client clamps
// onto each adjustable element's base size, so no choice can overflow or break the layout.

/** The four allowed font-size presets, smallest → largest. */
export type SizePreset = 'sm' | 'md' | 'lg' | 'xl'

/** Preset → multiplier. Deliberately gentle (0.9…1.25) so even 'xl' cannot overflow the hero/cards. */
const SCALE: Readonly<Record<SizePreset, number>> = { sm: 0.9, md: 1.0, lg: 1.12, xl: 1.25 }

/** All presets in display order (for the admin dropdown). */
export const SIZE_PRESETS: readonly SizePreset[] = ['sm', 'md', 'lg', 'xl']

/** Narrow an arbitrary string to a `SizePreset`, defaulting to 'md' (1.0×) for anything unknown. */
export function parseScale(value: string | null | undefined): SizePreset {
  return value === 'sm' || value === 'lg' || value === 'xl' ? value : 'md'
}

/** Scale a base px size by a preset, rounded to a whole px. `md` returns the base unchanged. */
export function scalePx(basePx: number, preset: SizePreset): number {
  return Math.round(basePx * SCALE[preset])
}

/** The `site_content` keys the homepage text is stored under. */
export const SITE_TEXT_KEYS = ['kicker', 'hours', 'addr'] as const
export type SiteTextKey = (typeof SITE_TEXT_KEYS)[number]

/** The DB-editable homepage strings (partial: an unset key keeps its i18n default). Mirrors
 * `AboutOverlay` — present-or-absent, so it composes under `exactOptionalPropertyTypes`. */
export type SiteText = Readonly<Partial<Record<SiteTextKey, string>>>

/** The full homepage-chrome overlay the public site consumes. */
export interface SiteChrome {
  readonly text: SiteText
  /** Scale for the homepage editable text (kicker / hours / address). */
  readonly homepageScale: SizePreset
  /** Scale for the "Om oss" section's editorial copy (eyebrow / heading / intro). */
  readonly aboutScale: SizePreset
}

/** The neutral default — empty text overlay + 1.0× scales. The mock returns this, so the site is
 * byte-identical to the i18n baseline until the owner edits something. */
export const DEFAULT_CHROME: SiteChrome = { text: {}, homepageScale: 'md', aboutScale: 'md' }

/** The `site_settings` keys the two scales are stored under. */
export const HOMEPAGE_SCALE_KEY = 'homepage_scale'
export const ABOUT_SCALE_KEY = 'about_scale'
