// Typed string tables. `Lang` is a closed union; the Swedish tables define the keys, and every key
// is required, so a missing translation is a compile error (no index-signature widening).

export type Lang = 'sv' | 'en'

/** Strings used by the booking flow. */
export type BookingStrings = Record<keyof typeof bookingSv, string>

/** Strings used by the site shell (incl. a11y labels). */
export type AppStrings = Record<keyof typeof appSv, string>

export type PrivacyStrings = Record<keyof typeof privacySv, string>

/** Strings for the "Om oss" / About section. */
export type AboutStrings = Record<keyof typeof aboutSv, string>

/** Strings for the "Mina bokningar" / My-appointments self-service dialog flow. */
export type MyBookingsStrings = Record<keyof typeof myBookingsSv, string>

/** Weekday / month / weekday-header label tables, indexed by `Date.getDay()` / month index. */
export interface CalendarLabels {
  weekdays: readonly string[]
  months: readonly string[]
  headers: readonly string[]
}

import { aboutSv, appSv, bookingSv, labelsSv, myBookingsSv, privacySv } from './sv'
import { aboutEn, appEn, bookingEn, labelsEn, myBookingsEn, privacyEn } from './en'

const BOOKING: Readonly<Record<Lang, BookingStrings>> = { sv: bookingSv, en: bookingEn }
const APP: Readonly<Record<Lang, AppStrings>> = { sv: appSv, en: appEn }
const PRIVACY: Readonly<Record<Lang, PrivacyStrings>> = { sv: privacySv, en: privacyEn }
const LABELS: Readonly<Record<Lang, CalendarLabels>> = { sv: labelsSv, en: labelsEn }
const ABOUT: Readonly<Record<Lang, AboutStrings>> = { sv: aboutSv, en: aboutEn }
const MY_BOOKINGS: Readonly<Record<Lang, MyBookingsStrings>> = {
  sv: myBookingsSv,
  en: myBookingsEn,
}

export const bookingStrings = (lang: Lang): BookingStrings => BOOKING[lang]
export const appStrings = (lang: Lang): AppStrings => APP[lang]
export const privacyStrings = (lang: Lang): PrivacyStrings => PRIVACY[lang]
export const calendarLabels = (lang: Lang): CalendarLabels => LABELS[lang]
export const aboutStrings = (lang: Lang): AboutStrings => ABOUT[lang]
export const myBookingsStrings = (lang: Lang): MyBookingsStrings => MY_BOOKINGS[lang]
