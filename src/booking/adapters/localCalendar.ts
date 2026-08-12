// The offline BookingPort adapter: no network. It reproduces the original mock's behavior —
// an .ics data URL, a Google Calendar template URL, and an Apple Maps directions URL — but with
// hardened, injection-safe construction (escaped ICS, fully `encodeURIComponent`-ed URLs).
//
// Effects (UID from a timestamp, DTSTAMP "now") live here at the edge and are injected into the
// pure `buildIcs`, so the ICS builder stays referentially transparent.

import { DEFAULT_BUSINESS } from '../../config'
import { barberIndex } from '../barbers'
import { parseDateIso } from '../calendar'
import type { Booking, BookingLinks, BookingResult } from '../domain'
import { buildIcs, formatIcsLocal } from '../ics'
import type { AvailabilityParams, BookingPort } from '../port'
import { packSlots } from '../slotPacking'
import type { BlockedInterval } from '../slotPacking'
import { formatBusinessAddress, type BusinessSettings } from '../../site/siteChrome'

/** Human-readable location line for calendar entries. */
function locationLine(business: BusinessSettings): string {
  return `${business.name}, ${formatBusinessAddress(business)}`
}

/** Event title: "<business> – <service> (<barber>)". */
function eventTitle(booking: Booking, business: BusinessSettings): string {
  return `${business.name} – ${booking.service.name} (${booking.barber.name})`
}

/** Event description: localised "Appointment with <barber> · <price> kr". */
function eventDescription(booking: Booking): string {
  const lead = booking.lang === 'sv' ? 'Bokning hos ' : 'Appointment with '
  return `${lead}${booking.barber.name} · ${booking.service.price} kr`
}

/** Build the Google Calendar "render template" URL with every dynamic part encoded. */
function googleCalHref(booking: Booking, business: BusinessSettings): string {
  const text = encodeURIComponent(eventTitle(booking, business))
  const dates = `${formatIcsLocal(booking.start)}/${formatIcsLocal(booking.end)}`
  const location = encodeURIComponent(locationLine(business))
  const details = encodeURIComponent(eventDescription(booking))
  // `dates` is a FLOATING wall-clock string; without `ctz` Google pins it in the USER's calendar
  // timezone, shifting the event for a non-Stockholm visitor. The slot wall-clock is salon time.
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&ctz=Europe%2FStockholm&location=${location}&details=${details}`
}

/** Build the `data:text/calendar` href from an escaped ICS payload. */
function icsHref(booking: Booking, uid: string, dtstamp: Date, business: BusinessSettings): string {
  const ics = buildIcs({
    uid,
    dtstamp,
    start: booking.start,
    end: booking.end,
    summary: eventTitle(booking, business),
    location: locationLine(business),
    description: eventDescription(booking),
  })
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`
}

/** Derive all calendar/map links for a booking (effects — UID + now — at this edge). */
export function buildLinks(
  booking: Booking,
  now: Date = new Date(),
  business: BusinessSettings = DEFAULT_BUSINESS,
): BookingLinks {
  const uid = `${now.getTime()}@bladeblendstudio`
  return {
    icsHref: icsHref(booking, uid, now, business),
    gcalHref: googleCalHref(booking, business),
    mapsHref: business.mapsHref,
  }
}

/** Day-of-month from a `YYYY-MM-DD` string (the seed the deterministic mock block needs), or 0 if
 * malformed. */
function dayOfMonth(dateIso: string): number {
  return parseDateIso(dateIso)?.day ?? 0
}

/** The mock's working window: 09:00–18:00 in minutes since midnight (matches the demo baseline). */
const MOCK_OPEN_MIN = 540
const MOCK_CLOSE_MIN = 1080

/** Candidate lengths (minutes) for the mock's single deterministic booking. */
const MOCK_BLOCK_LENGTHS = [45, 60, 90] as const

/**
 * ONE deterministic "existing booking" for the demo, derived purely from (day-of-month, barber index)
 * so the offline grid shows tight packing right after it — and reproduces byte-for-byte in the visual
 * baseline. An unknown barber (index < 0) yields no block (a clean, fully-open grid). The single
 * interval always sits inside the working window (start 540..870, length ≤ 90 → end ≤ 960).
 */
function mockBlocked(day: number, barberIdx: number): readonly BlockedInterval[] {
  if (barberIdx < 0) return []
  const startStep = (day * 5 + barberIdx * 7) % 12 // 0..11 → a 30-min-grid start across the morning
  const start = MOCK_OPEN_MIN + startStep * 30 // 540..870
  const len = MOCK_BLOCK_LENGTHS[(day + barberIdx) % 3] ?? 45 // 45 | 60 | 90
  return [[start, start + len]]
}

/**
 * Local-only BookingPort: always succeeds, producing the calendar/map links (the .ics + Google
 * Cal + maps links the original mock produced, now hardened).
 *
 * `availability` returns the AVAILABLE start times via the shared `packSlots` util — a fixed 15-min
 * grid over the 09:00–18:00 window, offering each start where the service fits (ends by close, overlaps
 * no booking/block) around one deterministic mock booking derived from (day-of-month, barber index),
 * so the offline/demo/visual baseline is stable and reproducible.
 */
export const localCalendarAdapter: BookingPort = {
  submit(booking: Booking, business: BusinessSettings = DEFAULT_BUSINESS): Promise<BookingResult> {
    const links = buildLinks(booking, new Date(), business)
    const result: BookingResult = { ok: true, booking, links }
    return Promise.resolve(result)
  },
  availability(params: AvailabilityParams): Promise<readonly string[]> {
    const times = packSlots({
      openMin: MOCK_OPEN_MIN,
      closeMin: MOCK_CLOSE_MIN,
      durationMin: params.durationMin,
      blocked: mockBlocked(dayOfMonth(params.dateIso), barberIndex(params.barberId)),
      // The mock has no clock — pass a future-safe cutoff so the grid stays deterministic (no past
      // filtering); the real backend does the now-filter server-side.
      nowMin: -1,
    })
    return Promise.resolve(times)
  },
}
