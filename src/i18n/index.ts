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
}

/** Weekday / month / weekday-header label tables, indexed by `Date.getDay()` / month index. */
export interface CalendarLabels {
  weekdays: readonly string[]
  months: readonly string[]
  headers: readonly string[]
}

import { appSv, bookingSv, labelsSv } from './sv'
import { appEn, bookingEn, labelsEn } from './en'

const BOOKING: Readonly<Record<Lang, BookingStrings>> = { sv: bookingSv, en: bookingEn }
const APP: Readonly<Record<Lang, AppStrings>> = { sv: appSv, en: appEn }
const LABELS: Readonly<Record<Lang, CalendarLabels>> = { sv: labelsSv, en: labelsEn }

export const bookingStrings = (lang: Lang): BookingStrings => BOOKING[lang]
export const appStrings = (lang: Lang): AppStrings => APP[lang]
export const calendarLabels = (lang: Lang): CalendarLabels => LABELS[lang]
