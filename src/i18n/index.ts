// Typed string tables. `Lang` is a closed union; every BookingStrings/AppStrings key is
// required, so a missing translation is a compile error (no index-signature widening).

export type Lang = 'sv' | 'en'

/** Strings used by the booking flow (ported verbatim from the source `BF_STR`). */
export interface BookingStrings {
  chooseBarber: string
  chooseDate: string
  chooseTime: string
  chooseService: string
  pickDayForService: string
  pickServiceForTime: string
  /** Shown in the time column while real availability is loading from the backend. */
  loadingTimes: string
  legendChosen: string
  legendClosed: string
  yourDetails: string
  summary: string
  fBarber: string
  fWhen: string
  fService: string
  fTotal: string
  name: string
  namePh: string
  phone: string
  email: string
  confirmVia: string
  sms: string
  emailM: string
  book: string
  policy: string
  bookedTitle: string
  addToCal: string
  calApple: string
  calGoogle: string
  directions: string
  newBooking: string
  grpWedSat: string
  grpMonTue: string
  grpStudent: string
  grpKids: string
  noteStudent: string
  sHairBeard: string
  sHair: string
  sBeard: string
  sHairStudent: string
  sKids: string
  min: string
  errName: string
  errPhone: string
  errEmail: string
  errSubmit: string
}

/** Strings used by the site shell (ported verbatim from the source `APP_T`, plus a11y labels). */
export interface AppStrings {
  findUs: string
  book: string
  kicker: string
  hours: string
  addr: string
  ariaTheme: string
  ariaBackHome: string
  ariaCall: string
  /** Underlined hero links added under the "Boka tid" button. */
  aboutLink: string
  cancelLink: string
}

/**
 * A placeholder stylist bio for the About section. `handle` is the IG handle (echoed from
 * `BARBERS`, kept here so the copy reads naturally per language); `bio` is on-brand placeholder
 * prose. Keyed by `BarberId` in `AboutStrings.stylists`.
 */
export interface StylistCopy {
  readonly role: string
  readonly bio: string
}

/** Strings for the "Om oss" / About section (all placeholder copy — no real bios/photos exist). */
export interface AboutStrings {
  /** Section eyebrow + heading + intro paragraph. */
  eyebrow: string
  heading: string
  intro: string
  /** Salon photo gallery. */
  galleryTitle: string
  galleryAlt: string
  /** Stylists block. */
  stylistsTitle: string
  stylists: Readonly<Record<'hassan' | 'victor' | 'salman', StylistCopy>>
  stylistAvatarAlt: string
  /** Customer-cuts gallery. */
  cutsTitle: string
  cutsAlt: string
  /** Reviews block + form. */
  reviewsTitle: string
  reviewName: string
  reviewNamePh: string
  reviewRating: string
  reviewText: string
  reviewTextPh: string
  reviewSubmit: string
  reviewThanks: string
  reviewErrName: string
  reviewErrText: string
  reviewErrRating: string
  /** `aria-label` for a rendered star rating, e.g. "Betyg: 4 av 5". `{n}` is replaced. */
  ratingValueLabel: string
  /** `aria-label` for a star in the keyboard selector, e.g. "4 stjärnor". `{n}` is replaced. */
  ratingStarLabel: string
  ratingGroupLabel: string
}

/** Strings for the "Avbokning" / cancellation dialog flow (mock — nothing persists). */
export interface CancelStrings {
  title: string
  /** Step 1 — choose method + enter contact. */
  methodLabel: string
  sms: string
  emailM: string
  phone: string
  phonePh: string
  email: string
  emailPh: string
  lookupBtn: string
  lookingUp: string
  errPhone: string
  errEmail: string
  errLookup: string
  /** Step 2 — the looked-up booking + confirm/abort. */
  foundLead: string
  fBarber: string
  fWhen: string
  fService: string
  confirmQuestion: string
  confirmBtn: string
  abortBtn: string
  cancelling: string
  errCancel: string
  /** Step 3 — cancelled confirmation. */
  doneTitle: string
  doneVia: string
  doneBtn: string
  ariaClose: string
}

/** Weekday / month / weekday-header label tables, indexed by `Date.getDay()` / month index. */
export interface CalendarLabels {
  weekdays: readonly string[]
  months: readonly string[]
  headers: readonly string[]
}

import { aboutSv, appSv, bookingSv, cancelSv, labelsSv } from './sv'
import { aboutEn, appEn, bookingEn, cancelEn, labelsEn } from './en'

const BOOKING: Readonly<Record<Lang, BookingStrings>> = { sv: bookingSv, en: bookingEn }
const APP: Readonly<Record<Lang, AppStrings>> = { sv: appSv, en: appEn }
const LABELS: Readonly<Record<Lang, CalendarLabels>> = { sv: labelsSv, en: labelsEn }
const ABOUT: Readonly<Record<Lang, AboutStrings>> = { sv: aboutSv, en: aboutEn }
const CANCEL: Readonly<Record<Lang, CancelStrings>> = { sv: cancelSv, en: cancelEn }

export const bookingStrings = (lang: Lang): BookingStrings => BOOKING[lang]
export const appStrings = (lang: Lang): AppStrings => APP[lang]
export const calendarLabels = (lang: Lang): CalendarLabels => LABELS[lang]
export const aboutStrings = (lang: Lang): AboutStrings => ABOUT[lang]
export const cancelStrings = (lang: Lang): CancelStrings => CANCEL[lang]
