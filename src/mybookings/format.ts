// Pure formatting + splitting for Mina bokningar. No effects — "now" is injected. Reuses the shared
// calendar label parts so a row reads in the site's own wording, with a localised time separator.

import { cap, monthLabel, pad2, weekdayLabel } from '../booking/calendar'
import type { Lang } from '../i18n/index'
import type { MyBooking, MyBookings } from './domain'

/**
 * "Weekday D Month <sep>HH:MM" for a booking row — e.g. SV "Måndag 13 juli kl 12:30", EN
 * "Monday 13 July 12:30". `sep` is the localised time connector ("kl " / "") from the string table,
 * so the label reads naturally per language while the date parts stay the shared localised ones.
 */
export function formatRowLabel(lang: Lang, date: Date, sep: string): string {
  return (
    cap(weekdayLabel(lang, date.getDay())) +
    ' ' +
    date.getDate() +
    ' ' +
    monthLabel(lang, date.getMonth()) +
    ' ' +
    sep +
    pad2(date.getHours()) +
    ':' +
    pad2(date.getMinutes())
  )
}

/**
 * Split a flat booking list into upcoming/past around `now`: upcoming soonest-first, past
 * most-recent-first. A booking counts as past once its start is at/before `now`. Pure (injected
 * `now`), and it copies the arrays before sorting so the input is never mutated.
 */
export function splitByTime(all: readonly MyBooking[], now: Date): MyBookings {
  const nowMs = now.getTime()
  const upcoming = all.filter((b) => b.start.getTime() > nowMs)
  const past = all.filter((b) => b.start.getTime() <= nowMs)
  const byStartAsc = (a: MyBooking, b: MyBooking): number => a.start.getTime() - b.start.getTime()
  const byStartDesc = (a: MyBooking, b: MyBooking): number => b.start.getTime() - a.start.getTime()
  return {
    upcoming: [...upcoming].sort(byStartAsc),
    past: [...past].sort(byStartDesc),
  }
}
