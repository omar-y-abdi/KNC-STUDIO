// Pure demo-history builder for the offline Mina bokningar adapter. Given an injected "today", it
// produces a plausible spread of past + upcoming appointments from the SAME facts the booking flow
// uses (BARBERS, SLOTS, pricing) so the list looks real. No effects, no randomness — "today" is
// passed in, so under VITE_CLOCK=fixed the output is deterministic and unit-testable.
//
// Every array access is guarded (the project runs `noUncheckedIndexedAccess`); safe fallbacks are
// used rather than non-null assertions.

import { BARBERS, FALLBACK_BARBER } from '../booking/barbers'
import type { Barber, ServiceItem } from '../booking/domain'
import { pricing } from '../booking/pricing'
import { SLOTS } from '../booking/slots'
import { bookingStrings, myBookingsStrings } from '../i18n/index'
import type { Lang } from '../i18n/index'
import type { MyBooking } from './domain'
import { formatRowLabel } from './format'

/** Day offsets (from "today") for the demo history — 3 upcoming, 4 past. */
const UPCOMING_OFFSETS = [2, 9, 20] as const
const PAST_OFFSETS = [-6, -19, -41, -88] as const

/** Nudge onto an OPEN day (salon closed Sundays): forward for upcoming, backward for past, so the
 * sign — and thus the upcoming/past classification — is preserved. */
function openDay(today: Date, offsetDays: number): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  d.setDate(d.getDate() + offsetDays)
  const step = offsetDays >= 0 ? 1 : -1
  while (d.getDay() === 0) d.setDate(d.getDate() + step)
  return d
}

/** Deterministic modular pick with a safe fallback (handles the empty-array + negative-seed cases). */
function pickFrom<T>(arr: readonly T[], seed: number, fallback: T): T {
  if (arr.length === 0) return fallback
  const idx = ((seed % arr.length) + arr.length) % arr.length
  return arr[idx] ?? fallback
}

function buildOne(
  today: Date,
  offsetDays: number,
  seed: number,
  lang: Lang,
  sep: string,
): MyBooking {
  const day = openDay(today, offsetDays)
  const t = bookingStrings(lang)
  const items: readonly ServiceItem[] = pricing(day, t).flatMap((g) => g.items)
  const service = pickFrom<ServiceItem>(items, seed, {
    id: 'h',
    name: t.sHair,
    price: 350,
    dur: 45,
  })
  const barber: Barber = pickFrom(BARBERS, seed, FALLBACK_BARBER)
  const time = pickFrom(SLOTS, seed + 3, '12:00')
  const [hh, mm] = time.split(':').map(Number)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh ?? 12, mm ?? 0)
  return {
    id: `demo-${offsetDays}-${seed}`,
    barber,
    serviceName: service.name,
    price: service.price,
    durationMin: service.dur,
    start,
    whenLabel: formatRowLabel(lang, start, sep),
  }
}

/** A deterministic demo history (3 upcoming + 4 past) for the offline Mina bokningar adapter. */
export function buildDemoMyBookings(today: Date, lang: Lang): readonly MyBooking[] {
  const sep = myBookingsStrings(lang).atSep
  const upcoming = UPCOMING_OFFSETS.map((off, i) => buildOne(today, off, i + 1, lang, sep))
  const past = PAST_OFFSETS.map((off, i) => buildOne(today, off, i + 5, lang, sep))
  return [...upcoming, ...past]
}
