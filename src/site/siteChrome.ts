// Shared model for owner-editable public-site copy, business identity, runtime SEO, and sizing:
// bilingual homepage text, every non-button booking-dialog string, and two font-size presets.
//
// Font size is a BOUNDED preset (never a free px value): four gentle multipliers the client clamps
// onto each adjustable element's base size, so no choice can overflow or break the layout.

import type { BookingStrings, Lang } from '../i18n/index'
import { appStrings, bookingStrings } from '../i18n/index'
import {
  BUSINESS_SETTING_KEYS,
  DEFAULT_BUSINESS,
  EMPTY_BUSINESS_FACTS,
  type BusinessDiscoveryFacts,
  type BusinessSettings,
} from './business'

export {
  BUSINESS_SETTING_KEYS,
  formatBusinessAddress,
  parseCancellationPolicyHours,
  resolveBusinessSettings,
  type BusinessDiscoveryFacts,
  type BusinessSettings,
  type SeoSettings,
} from './business'

/** The four allowed font-size presets, smallest → largest. */
export type SizePreset = 'sm' | 'md' | 'lg' | 'xl'
export type HomepageLogoStyle = 'classic' | 'monochrome'
const HOMEPAGE_LOGO_PATH =
  /^logo\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/

export interface HomepageLogo {
  /** Null keeps the shipped vector lockup. A non-null URL is a public, processed gallery object. */
  readonly url: string | null
  readonly path: string | null
  readonly scale: SizePreset
  readonly style: HomepageLogoStyle
}

/** Preset → multiplier. Deliberately gentle (0.9…1.25) so even 'xl' cannot overflow the hero/cards. */
const SCALE: Readonly<Record<SizePreset, number>> = { sm: 0.9, md: 1.0, lg: 1.12, xl: 1.25 }

/** All presets in display order (for the admin dropdown). */
export const SIZE_PRESETS: readonly SizePreset[] = ['sm', 'md', 'lg', 'xl']

/** Narrow an arbitrary string to a `SizePreset`, defaulting to 'md' (1.0×) for anything unknown. */
export function parseScale(value: string | null | undefined): SizePreset {
  return value === 'sm' || value === 'lg' || value === 'xl' ? value : 'md'
}

export function parseHomepageLogoStyle(value: string | null | undefined): HomepageLogoStyle {
  return value === 'monochrome' ? 'monochrome' : 'classic'
}

/** Accept only server-generated public gallery logo paths; malformed CMS data falls back to vector. */
export function parseHomepageLogoPath(value: string | null | undefined): string | null {
  const path = value?.trim() ?? ''
  return HOMEPAGE_LOGO_PATH.test(path) ? path : null
}

/** Scale a base px size by a preset, rounded to a whole px. `md` returns the base unchanged. */
export function scalePx(basePx: number, preset: SizePreset): number {
  return Math.round(basePx * SCALE[preset])
}

export const HOMEPAGE_TEXT_KEYS = ['kicker', 'hours'] as const
export const BOOKING_DETAILS_TEXT_KEYS = [
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
] as const satisfies readonly (keyof BookingStrings)[]
export const BOOKING_CONFIRMATION_TEXT_KEYS = [
  'bookedTitle',
  'confirmSent',
  'addToCal',
] as const satisfies readonly (keyof BookingStrings)[]
export const BOOKING_POPUP_TEXT_KEYS = [
  ...BOOKING_DETAILS_TEXT_KEYS,
  ...BOOKING_CONFIRMATION_TEXT_KEYS,
] as const
export type BookingPopupTextKey = (typeof BOOKING_POPUP_TEXT_KEYS)[number]

/** Every `site_content` key stored per language for the public site. */
export const SITE_TEXT_KEYS = [...HOMEPAGE_TEXT_KEYS, ...BOOKING_POPUP_TEXT_KEYS] as const
export type SiteTextKey = (typeof SITE_TEXT_KEYS)[number]

/** The DB-editable homepage strings (partial: an unset key keeps its i18n default). Mirrors
 * `AboutOverlay` — present-or-absent, so it composes under `exactOptionalPropertyTypes`. */
export type SiteText = Readonly<Partial<Record<SiteTextKey, string>>>

/** Use the i18n default until an owner has entered non-blank replacement copy. */
export function textOrDefault(value: string | undefined, fallback: string): string {
  return value?.trim() === '' || value === undefined ? fallback : value
}

export type ResolvedSiteText = Readonly<Record<SiteTextKey, string>>

/** Current shipped copy, used to prefill admin fields before any owner override exists. */
export function defaultSiteText(
  lang: Lang,
  cancellationPolicyHours: number = DEFAULT_BUSINESS.cancellationPolicyHours,
  businessName: string = DEFAULT_BUSINESS.name,
): ResolvedSiteText {
  const app = appStrings(lang)
  const booking = bookingStrings(lang)
  return {
    kicker: app.kicker,
    hours: app.hours,
    yourDetails: booking.yourDetails,
    summary: booking.summary,
    fBarber: booking.fBarber,
    fWhen: booking.fWhen,
    fService: booking.fService,
    fTotal: booking.fTotal,
    name: booking.name,
    namePh: booking.namePh,
    phone: booking.phone,
    phonePh: booking.phonePh,
    policy: booking.policy
      .split('{hours}')
      .join(String(cancellationPolicyHours))
      .split('{businessName}')
      .join(businessName),
    bookedTitle: booking.bookedTitle,
    confirmSent: booking.confirmSent,
    addToCal: booking.addToCal,
  }
}

/** Overlay saved owner copy while treating missing/blank rows as the shipped localized copy. */
export function resolveSiteText(
  text: SiteText,
  lang: Lang,
  cancellationPolicyHours: number = DEFAULT_BUSINESS.cancellationPolicyHours,
  businessName: string = DEFAULT_BUSINESS.name,
): ResolvedSiteText {
  const defaults = defaultSiteText(lang, cancellationPolicyHours, businessName)
  const resolved: Record<SiteTextKey, string> = { ...defaults }
  for (const key of SITE_TEXT_KEYS) resolved[key] = textOrDefault(text[key], defaults[key])
  return resolved
}

/** The full homepage-chrome overlay the public site consumes. */
export interface SiteChrome {
  readonly text: SiteText
  /** Owner-managed business identity, calendar location, policy timing, and runtime SEO. */
  readonly business: BusinessSettings
  /** Active public domain facts used by metadata and machine discovery. */
  readonly facts: BusinessDiscoveryFacts
  /** Scale for the homepage editable text (kicker / hours / business address). */
  readonly homepageScale: SizePreset
  /** Owner-selected homepage logo replacement, bounded scale, and faithful image treatment. */
  readonly homepageLogo: HomepageLogo
  /** Scale for the "Om oss" section's editorial copy (eyebrow / heading / intro). */
  readonly aboutScale: SizePreset
}

/** The neutral default — empty text overlay + safe business fallbacks + 1.0× scales. */
export const DEFAULT_CHROME: SiteChrome = {
  text: {},
  business: DEFAULT_BUSINESS,
  facts: EMPTY_BUSINESS_FACTS,
  homepageScale: 'md',
  homepageLogo: { path: null, url: null, scale: 'md', style: 'classic' },
  aboutScale: 'md',
}

/** The `site_settings` keys the two scales are stored under. */
export const HOMEPAGE_SCALE_KEY = 'homepage_scale'
export const ABOUT_SCALE_KEY = 'about_scale'
export const HOMEPAGE_LOGO_PATH_KEY = 'homepage_logo_path'
export const HOMEPAGE_LOGO_SCALE_KEY = 'homepage_logo_scale'
export const HOMEPAGE_LOGO_STYLE_KEY = 'homepage_logo_style'

export const SITE_SETTING_KEYS = [
  HOMEPAGE_SCALE_KEY,
  ABOUT_SCALE_KEY,
  HOMEPAGE_LOGO_PATH_KEY,
  HOMEPAGE_LOGO_SCALE_KEY,
  HOMEPAGE_LOGO_STYLE_KEY,
  BUSINESS_SETTING_KEYS.name,
  BUSINESS_SETTING_KEYS.legalName,
  BUSINESS_SETTING_KEYS.organizationNumber,
  BUSINESS_SETTING_KEYS.email,
  BUSINESS_SETTING_KEYS.phoneDisplay,
  BUSINESS_SETTING_KEYS.phoneTel,
  BUSINESS_SETTING_KEYS.street,
  BUSINESS_SETTING_KEYS.postalCode,
  BUSINESS_SETTING_KEYS.city,
  BUSINESS_SETTING_KEYS.mapsHref,
  BUSINESS_SETTING_KEYS.cancellationPolicyHours,
  BUSINESS_SETTING_KEYS.seo.sv.title,
  BUSINESS_SETTING_KEYS.seo.sv.description,
  BUSINESS_SETTING_KEYS.seo.en.title,
  BUSINESS_SETTING_KEYS.seo.en.description,
] as const
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number]

export const DEFAULT_SITE_SETTINGS: Readonly<Record<SiteSettingKey, string>> = {
  [HOMEPAGE_SCALE_KEY]: 'md',
  [ABOUT_SCALE_KEY]: 'md',
  [HOMEPAGE_LOGO_PATH_KEY]: '',
  [HOMEPAGE_LOGO_SCALE_KEY]: 'md',
  [HOMEPAGE_LOGO_STYLE_KEY]: 'classic',
  [BUSINESS_SETTING_KEYS.name]: DEFAULT_BUSINESS.name,
  [BUSINESS_SETTING_KEYS.legalName]: DEFAULT_BUSINESS.legalName,
  [BUSINESS_SETTING_KEYS.organizationNumber]: DEFAULT_BUSINESS.organizationNumber,
  [BUSINESS_SETTING_KEYS.email]: DEFAULT_BUSINESS.email,
  [BUSINESS_SETTING_KEYS.phoneDisplay]: DEFAULT_BUSINESS.phoneDisplay,
  [BUSINESS_SETTING_KEYS.phoneTel]: DEFAULT_BUSINESS.phoneTel,
  [BUSINESS_SETTING_KEYS.street]: DEFAULT_BUSINESS.street,
  [BUSINESS_SETTING_KEYS.postalCode]: DEFAULT_BUSINESS.postalCode,
  [BUSINESS_SETTING_KEYS.city]: DEFAULT_BUSINESS.city,
  [BUSINESS_SETTING_KEYS.mapsHref]: DEFAULT_BUSINESS.mapsHref,
  [BUSINESS_SETTING_KEYS.cancellationPolicyHours]: String(DEFAULT_BUSINESS.cancellationPolicyHours),
  [BUSINESS_SETTING_KEYS.seo.sv.title]: DEFAULT_BUSINESS.seo.sv.title,
  [BUSINESS_SETTING_KEYS.seo.sv.description]: DEFAULT_BUSINESS.seo.sv.description,
  [BUSINESS_SETTING_KEYS.seo.en.title]: DEFAULT_BUSINESS.seo.en.title,
  [BUSINESS_SETTING_KEYS.seo.en.description]: DEFAULT_BUSINESS.seo.en.description,
}

/** A mutable map is convenient for the Site editor; callers receive a fresh copy every time. */
export function defaultSiteSettings(): ReadonlyMap<SiteSettingKey, string> {
  const settings = new Map<SiteSettingKey, string>()
  for (const key of SITE_SETTING_KEYS) settings.set(key, DEFAULT_SITE_SETTINGS[key])
  return settings
}
