// Pure ISO-8601 week-of-year math. NO timezone, NO `Date.now()`, NO ambient state — every result is
// deterministic from the (year, month, day) triple alone. `Date.UTC(...)` is used here purely as a
// proleptic-Gregorian day counter (a calendar), never as an instant that carries timezone meaning, so
// the output is identical in every process timezone. Callers that need salon-local weeks must resolve
// the Europe/Stockholm wall-clock Y/M/D FIRST (see `booking/stockholmTime`), then pass it in.
//
// The ISO week-numbering YEAR differs from the calendar year at the Dec/Jan boundary (e.g. 2027-01-01
// is week 53 of 2026, and 2020-12-31 is week 53 of 2020 while 2021-01-04 is week 1 of 2021), so BOTH
// fields are returned and callers group/sort on the composite `(isoWeekYear, isoWeek)` — never on the
// bare week number, which repeats across years.

const MS_PER_DAY = 86_400_000

/** An ISO-8601 week identity: the week-numbering year plus the 1–53 week index within it. */
export interface IsoWeek {
  readonly isoWeekYear: number
  readonly isoWeek: number
}

/**
 * The ISO-8601 week identity of a Gregorian calendar date (`month` is 1–12, `day` is 1–31).
 *
 * Standard "nearest-Thursday" algorithm: ISO week 1 is the week containing Jan 4 (equivalently, the
 * week holding the year's first Thursday) and weeks start on Monday. The Thursday of a date's week
 * fixes BOTH its week-numbering year and its week number, which is exactly why boundary dates borrow
 * their `isoWeekYear` from the adjacent calendar year.
 */
export function isoWeek(year: number, month: number, day: number): IsoWeek {
  // A throwaway UTC Date used ONLY as a calendar. `.setUTCDate` mutates this LOCAL value; the function
  // stays referentially transparent because nothing shared or ambient is touched.
  const date = new Date(Date.UTC(year, month - 1, day))
  // `getUTCDay()` is 0=Sun..6=Sat; treat Sunday as 7 so a Mon–Sun week maps onto its Thursday via
  // `+ 4 - dayOfWeek` (Mon→+3, Thu→0, Sun→-3).
  const dayOfWeek = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek)
  const isoWeekYear = date.getUTCFullYear()
  // Whole weeks from Jan 1 of the Thursday's year to that Thursday, then +1 for a 1-based week number.
  const yearStartMs = Date.UTC(isoWeekYear, 0, 1)
  const dayOfYear = (date.getTime() - yearStartMs) / MS_PER_DAY + 1
  return { isoWeekYear, isoWeek: Math.ceil(dayOfYear / 7) }
}

/**
 * A compact week label for the admin UI. `sv` → `"v. {n}"`, `en` → `"wk {n}"`. When the week's
 * numbering year differs from `currentIsoWeekYear` (a cross-year week — e.g. a week-53-of-2026 header
 * seen while "now" is 2027), the year is appended (`"v. 53 · 2026"`) so the label stays unambiguous.
 */
export function weekLabel(w: IsoWeek, currentIsoWeekYear: number, lang: 'sv' | 'en'): string {
  const base = `${lang === 'sv' ? 'v.' : 'wk'} ${w.isoWeek}`
  return w.isoWeekYear === currentIsoWeekYear ? base : `${base} · ${w.isoWeekYear}`
}
