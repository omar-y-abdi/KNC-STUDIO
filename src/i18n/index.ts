// Typed string tables. `Lang` is a closed union; every BookingStrings/AppStrings key is
// required, so a missing translation is a compile error (no index-signature widening).

export type Lang = 'sv' | 'en'

/** Strings used by the booking flow. */
export interface BookingStrings {
  chooseBarber: string
  loadingBarbers: string
  noBarbers: string
  chooseDate: string
  chooseTime: string
  chooseService: string
  loadingServices: string
  noServices: string
  pickDayForService: string
  pickServiceForTime: string
  /** Shown in the time column while real availability is loading from the backend. */
  loadingTimes: string
  /** Shown in the time column when a barber+date+service is chosen but no bookable times remain
   * (barber off/on time-off, fully booked, or — for the backend — a read error; fail-closed). */
  noSlots: string
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
  phonePh: string
  email: string
  emailPh: string
  book: string
  policy: string
  bookedTitle: string
  /** Confirmation sentence template. `{email}` and legacy `{phone}` tokens are interpolated. */
  confirmSent: string
  addToCal: string
  calApple: string
  calGoogle: string
  directions: string
  newBooking: string
  min: string
  errName: string
  errPhone: string
  errEmail: string
  errSubmit: string
  /** Gateway rejection: too many booking attempts (per-IP/phone backstop). */
  errRateLimited: string
  /** Gateway rejection: the Turnstile human-verification challenge failed. */
  errChallenge: string
  ariaClose: string
}

/** Strings used by the site shell (incl. a11y labels). */
export interface AppStrings {
  findUs: string
  book: string
  /** Secondary hero action next to/under "Boka tid" — opens the Mina bokningar popup. */
  myBookings: string
  kicker: string
  hours: string
  addr: string
  ariaTheme: string
  ariaBackHome: string
  ariaCall: string
  /** Underlined hero links added under the "Boka tid" button. */
  aboutLink: string
  cancelLink: string
  lazyBookingLoading: string
  lazyBookingError: string
  lazyMyBookingsLoading: string
  lazyMyBookingsError: string
  lazyReload: string
}

/** Public browser-storage controls. No analytics or advertising category exists in this site. */
export interface PrivacyStrings {
  title: string
  lead: string
  privacyLink: string
  accept: string
  reject: string
  preferences: string
  save: string
  functionalTitle: string
  functionalLead: string
  necessary: string
  manage: string
  manageLabel: string
}

/** Strings for the "Om oss" / About section. */
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
  stylistAvatarAlt: string
  /** Customer-cuts gallery. */
  cutsTitle: string
  cutsAlt: string
  /** Reviews block + form. The reviewer proves a finished booking by phone; the displayed name is
   * derived server-side from that booking ("Förnamn E."), so the form asks for the phone, not a name. */
  reviewsTitle: string
  reviewsLoading: string
  reviewsEmpty: string
  reviewsUnavailable: string
  reviewPhone: string
  reviewPhonePh: string
  /** Helper line under the phone field explaining the gate + derived name. */
  reviewPhoneHint: string
  reviewRating: string
  reviewText: string
  reviewTextPh: string
  reviewSubmit: string
  reviewThanks: string
  reviewErrPhone: string
  reviewErrText: string
  reviewErrRating: string
  /** Shown when the phone has no finished, not-yet-reviewed confirmed booking. */
  reviewErrNoBooking: string
  reviewErrInvalid: string
  reviewErrChallenge: string
  reviewErrRateLimited: string
  reviewErrSubmit: string
  reviewErrUnavailable: string
  /** `aria-label` for a rendered star rating, e.g. "Betyg: 4 av 5". `{n}` is replaced. */
  ratingValueLabel: string
  /** `aria-label` for a star in the keyboard selector, e.g. "4 stjärnor". `{n}` is replaced. */
  ratingStarLabel: string
  ratingGroupLabel: string
}

/** Strings for the "Mina bokningar" / My-appointments self-service dialog flow. */
export interface MyBookingsStrings {
  title: string
  /** Lookup step - rotate and email the customer's permanent access link. */
  lookupLead: string
  email: string
  emailPh: string
  lookupBtn: string
  lookingUp: string
  errEmail: string
  accessSent: string
  errAccess: string
  /** Network/parse failure. */
  errSystem: string
  errChallenge: string
  errRateLimited: string
  /** List step. */
  upcomingTitle: string
  pastTitle: string
  upcomingEmpty: string
  /** Link back to the lookup step (check a different email). */
  changeEmail: string
  /** Expanded-row detail labels. */
  fBarber: string
  fService: string
  fDuration: string
  min: string
  /** Self-cancel (upcoming rows only). */
  cancelBtn: string
  cancelConfirmQ: string
  cancelConfirmYes: string
  cancelConfirmNo: string
  cancelling: string
  errCancel: string
  cancelledNote: string
  /** Localised time connector for a row label ("kl " / ""). */
  atSep: string
  ariaClose: string
  ariaExpandRow: string
  ariaExpandPast: string
}

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
