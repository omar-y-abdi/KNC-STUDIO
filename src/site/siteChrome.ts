// Shared model for owner-editable public-site copy, business identity, runtime SEO, and sizing:
// bilingual homepage text, every non-button booking-dialog string, and two font-size presets.
//
// Font size is a BOUNDED preset (never a free px value): four gentle multipliers the client clamps
// onto each adjustable element's base size, so no choice can overflow or break the layout.

import type { BookingStrings, Lang } from '../i18n/index'
import { appStrings, bookingStrings } from '../i18n/index'
import { DEFAULT_BUSINESS } from '../config'

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
  /** Scale for the homepage editable text (kicker / hours / business address). */
  readonly homepageScale: SizePreset
  /** Scale for the "Om oss" section's editorial copy (eyebrow / heading / intro). */
  readonly aboutScale: SizePreset
}

/** The neutral default — empty text overlay + safe business fallbacks + 1.0× scales. */
export const DEFAULT_CHROME: SiteChrome = {
  text: {},
  business: DEFAULT_BUSINESS,
  homepageScale: 'md',
  aboutScale: 'md',
}

/** The `site_settings` keys the two scales are stored under. */
export const HOMEPAGE_SCALE_KEY = 'homepage_scale'
export const ABOUT_SCALE_KEY = 'about_scale'

/** Owner-managed `site_settings` keys for business identity, links, and runtime SEO. */
export const BUSINESS_SETTING_KEYS = {
  name: 'business_name',
  email: 'business_email',
  phoneDisplay: 'business_phone_display',
  phoneTel: 'business_phone_tel',
  street: 'business_street',
  postalCode: 'business_postal_code',
  city: 'business_city',
  mapsHref: 'business_maps_href',
  cancellationPolicyHours: 'cancellation_policy_hours',
  seo: {
    sv: { title: 'seo_title_sv', description: 'seo_description_sv' },
    en: { title: 'seo_title_en', description: 'seo_description_en' },
  },
} as const

export const SITE_SETTING_KEYS = [
  HOMEPAGE_SCALE_KEY,
  ABOUT_SCALE_KEY,
  BUSINESS_SETTING_KEYS.name,
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

export interface SeoSettings {
  readonly title: string
  readonly description: string
}

/** The complete public identity resolved from owner settings with safe shipped fallbacks. */
export interface BusinessSettings {
  readonly name: string
  readonly email: string
  readonly phoneDisplay: string
  readonly phoneTel: string
  readonly street: string
  readonly postalCode: string
  readonly city: string
  readonly mapsHref: string
  readonly cancellationPolicyHours: number
  readonly seo: Readonly<Record<Lang, SeoSettings>>
}

export const DEFAULT_SITE_SETTINGS: Readonly<Record<SiteSettingKey, string>> = {
  [HOMEPAGE_SCALE_KEY]: 'md',
  [ABOUT_SCALE_KEY]: 'md',
  [BUSINESS_SETTING_KEYS.name]: DEFAULT_BUSINESS.name,
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

function settingText(settings: ReadonlyMap<string, string>, key: SiteSettingKey): string {
  return textOrDefault(settings.get(key), DEFAULT_SITE_SETTINGS[key])
}

function validEmail(value: string, fallback: string): string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : fallback
}

function validTelephone(value: string, fallback: string): string {
  return /^[+0-9][0-9(). -]{2,39}$/.test(value) ? value : fallback
}

function validHttpUrl(value: string, fallback: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : fallback
  } catch {
    return fallback
  }
}

/** Values outside this range are malformed settings, never policy values the public site consumes. */
export function parseCancellationPolicyHours(value: string | null | undefined): number {
  if (value === null || value === undefined || !/^\d{1,3}$/.test(value)) {
    return DEFAULT_BUSINESS.cancellationPolicyHours
  }
  const hours = Number(value)
  return hours >= 1 && hours <= 168 ? hours : DEFAULT_BUSINESS.cancellationPolicyHours
}

/** Resolve every business identity setting; malformed sensitive link values safely fall back. */
export function resolveBusinessSettings(settings: ReadonlyMap<string, string>): BusinessSettings {
  const phoneTel = validTelephone(
    settingText(settings, BUSINESS_SETTING_KEYS.phoneTel),
    DEFAULT_BUSINESS.phoneTel,
  )
  const mapsHref = validHttpUrl(
    settingText(settings, BUSINESS_SETTING_KEYS.mapsHref),
    DEFAULT_BUSINESS.mapsHref,
  )
  return {
    name: settingText(settings, BUSINESS_SETTING_KEYS.name),
    email: validEmail(settingText(settings, BUSINESS_SETTING_KEYS.email), DEFAULT_BUSINESS.email),
    phoneDisplay: settingText(settings, BUSINESS_SETTING_KEYS.phoneDisplay),
    phoneTel,
    street: settingText(settings, BUSINESS_SETTING_KEYS.street),
    postalCode: settingText(settings, BUSINESS_SETTING_KEYS.postalCode),
    city: settingText(settings, BUSINESS_SETTING_KEYS.city),
    mapsHref,
    cancellationPolicyHours: parseCancellationPolicyHours(
      settings.get(BUSINESS_SETTING_KEYS.cancellationPolicyHours),
    ),
    seo: {
      sv: {
        title: settingText(settings, BUSINESS_SETTING_KEYS.seo.sv.title),
        description: settingText(settings, BUSINESS_SETTING_KEYS.seo.sv.description),
      },
      en: {
        title: settingText(settings, BUSINESS_SETTING_KEYS.seo.en.title),
        description: settingText(settings, BUSINESS_SETTING_KEYS.seo.en.description),
      },
    },
  }
}

/** The single address format the public shell and calendar entries share. */
export function formatBusinessAddress(business: BusinessSettings): string {
  return `${business.street}, ${business.postalCode} ${business.city}`
}
