// Pure demo-appointment builder. Given an injected "today", produces a plausible upcoming booking
// from the SAME facts the booking flow uses (BARBERS, SLOTS, pricing, BUSINESS) so the cancellation
// confirm step looks like a real appointment. No effects, no randomness, no clock read — "today" is
// passed in, so under VITE_CLOCK=fixed the output is fully deterministic and unit-testable.
//
// Every array access is guarded (the project runs `noUncheckedIndexedAccess`); a safe fallback is
// used rather than a non-null assertion. `pricing()` always yields at least the kids group, and
// SLOTS/BARBERS are non-empty constants, so the fallbacks are unreachable in practice.

import { BARBERS } from '../booking/barbers'
import { formatWhenLabel } from '../booking/calendar'
import type { Barber } from '../booking/domain'
import { asBarberId } from '../booking/domain'
import { pricing } from '../booking/pricing'
import { SLOTS } from '../booking/slots'
import { bookingStrings } from '../i18n/index'
import type { Lang } from '../i18n/index'
import type { CancelBooking, CancelMethod } from './domain'

/** Fallback barber if the roster were ever empty (BARBERS is a non-empty constant). */
const FALLBACK_BARBER: Barber = { id: asBarberId('hassan'), name: 'Hassan', ig: 'freebandzcuts' }

/** First upcoming OPEN day at/after `today` (the salon is closed on Sundays, `getDay() === 0`). */
function nextOpenDay(today: Date): Date {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  // Demo appointment sits a couple of days out so it always reads as "upcoming".
  base.setDate(base.getDate() + 2)
  while (base.getDay() === 0) base.setDate(base.getDate() + 1)
  return base
}

/** Deterministically pick a barber from the day-of-month so the demo varies but is reproducible. */
function pickBarber(day: number): Barber {
  const idx = day % BARBERS.length
  return BARBERS[idx] ?? FALLBACK_BARBER
}

/** A mid-list slot time (`'12:00'`-ish), guarded against an empty SLOTS list. */
function pickTime(): string {
  const idx = Math.floor(SLOTS.length / 2)
  return SLOTS[idx] ?? '12:00'
}

/**
 * Build a plausible upcoming appointment for the demo cancellation lookup. The service is the first
 * item of the first pricing group for that weekday (always present — kids group is the floor).
 */
export function buildDemoBooking(
  today: Date,
  lang: Lang,
  method: CancelMethod,
  contact: string,
): CancelBooking {
  const day = nextOpenDay(today)
  const t = bookingStrings(lang)
  const groups = pricing(day, t)
  const firstGroup = groups[0]
  const firstService = firstGroup ? firstGroup.items[0] : undefined
  const serviceName = firstService ? firstService.name : t.sHair
  const price = firstService ? firstService.price : 350

  const time = pickTime()
  const [hh, mm] = time.split(':').map(Number)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh ?? 12, mm ?? 0)

  const whenLabel = formatWhenLabel(lang, start)

  return {
    id: `demo-${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`,
    barber: pickBarber(day.getDate()),
    serviceName,
    price,
    start,
    whenLabel,
    method,
    contact,
  }
}
