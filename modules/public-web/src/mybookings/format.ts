// Pure formatting + splitting for Mina bokningar. No effects — "now" is injected. Reuses the shared
// calendar label parts so a row reads in the site's own wording, with a localised time separator.

import { dayLabel, pad2 } from '../booking/calendar'
import type { Lang } from '../i18n/index'
import type { MyBooking, MyBookings } from './domain'

/**
 * "Weekday D Month <sep>HH:MM" for a booking row — e.g. SV "Måndag 13 juli kl 12:30", EN
 * "Monday 13 July 12:30". `sep` is the localised time connector ("kl " / "") from the string table,
 * so the label reads naturally per language while the date parts stay the shared localised ones.
 */
export function formatRowLabel(lang: Lang, date: Date, sep: string): string {
  return `${dayLabel(lang, date)} ${sep}${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * Whether a booking looks cancellable online from here: its start is more than `policyHours` after
 * `now`. The server decides with the same operator (strictly later), but on its own clock and its
 * current setting, so the two can disagree; the dialog uses this only as a courtesy, to hide the
 * cancel button and say why before the customer tries. Pure (injected `now`).
 */
export function onlineCancellationOpen(start: Date, now: Date, policyHours: number): boolean {
  return start.getTime() > now.getTime() + policyHours * 3_600_000
}

/**
 * Split a flat booking list into upcoming/past around `now`: upcoming soonest-first, past
 * most-recent-first. A booking counts as past once its start is at/before `now`. Pure (injected
 * `now`); it sorts the filtered copies, so the input is never mutated.
 */
export function splitByTime(all: readonly MyBooking[], now: Date): MyBookings {
  const nowMs = now.getTime()
  const byStartAsc = (a: MyBooking, b: MyBooking): number => a.start.getTime() - b.start.getTime()
  const byStartDesc = (a: MyBooking, b: MyBooking): number => b.start.getTime() - a.start.getTime()
  return {
    upcoming: all.filter((b) => b.start.getTime() > nowMs).sort(byStartAsc),
    past: all.filter((b) => b.start.getTime() <= nowMs).sort(byStartDesc),
  }
}
