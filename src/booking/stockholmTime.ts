// Salon-timezone instant builder. The booking grid speaks Europe/Stockholm WALL-CLOCK ("13:30"),
// but the DB must store an absolute UTC instant — and `available_slots` (the read path) already
// interprets each slot label in Europe/Stockholm. This module is the WRITE-path mirror: given a
// Stockholm wall-clock (year, month, day, hour, minute), it returns the UTC instant that wall-clock
// denotes, independent of the BROWSER's own timezone. Without it, a non-Stockholm visitor would send
// an instant built in their local tz (e.g. New York), disagreeing with availability and storing the
// wrong real time.
//
// Pure + referentially transparent: no `Date.now()`, no ambient-tz read of "today" — only `Intl`'s
// DST-correct offset for the GIVEN date. DST-safe by construction (the offset is resolved for that
// exact date, so March CET=+01:00 and July CEST=+02:00 are handled without a hardcoded table).

const SALON_TZ = 'Europe/Stockholm'

/**
 * The Europe/Stockholm UTC offset, in milliseconds, in effect at a given UTC instant —
 * i.e. how far the Stockholm wall-clock is AHEAD of UTC at that moment (+1h CET / +2h CEST).
 * Derived from `Intl` so it follows the real DST calendar for any year.
 */
function stockholmOffsetMs(atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: SALON_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const part of dtf.formatToParts(new Date(atUtcMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  // Reading the instant AS Stockholm wall-clock, then treating those components as if they were UTC,
  // yields a millisecond value that is ahead of the real instant by exactly the Stockholm offset.
  const asIfUtc = Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  )
  return asIfUtc - atUtcMs
}

/**
 * The UTC instant (`Date`) for a Europe/Stockholm wall-clock date+time. `month` is 1-based
 * (1 = January) to match human/DB conventions, NOT JS's 0-based month.
 *
 * Algorithm: take the naive UTC reading of the wall-clock as a first guess, resolve the Stockholm
 * offset in effect AT that guess, then subtract it. One correction is exact for all of mainland
 * Europe's DST rules except the single ambiguous hour at the autumn fall-back; bookings are on a
 * fixed daytime grid (09:00–17:15) that never lands in that 02:00–03:00 window, so the result is
 * unambiguous for every real slot.
 */
export function stockholmInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offsetMs = stockholmOffsetMs(guessUtcMs)
  return new Date(guessUtcMs - offsetMs)
}

/**
 * Reinterpret a `Date`'s LOCAL wall-clock components as a Europe/Stockholm wall-clock, returning the
 * corresponding UTC instant as an ISO-8601 string. This is the adapter's wire transform: `BookingFlow`
 * builds `start = new Date(y, m, d, hh, mm)` from the SELECTED slot in the browser's local tz, so its
 * `.getHours()` etc. always read back the chosen "13:30" regardless of browser tz; we re-anchor those
 * same numbers to the salon timezone so the stored instant matches what `available_slots` reasoned about.
 */
export function localWallClockToStockholmIso(local: Date): string {
  return stockholmInstant(
    local.getFullYear(),
    local.getMonth() + 1,
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
  ).toISOString()
}
