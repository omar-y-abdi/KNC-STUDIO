// The ONE real BookingPort adapter: no network. It reproduces the source's current behavior —
// an .ics data URL, a Google Calendar template URL, and an Apple Maps directions URL — but with
// hardened, injection-safe construction (escaped ICS, fully `encodeURIComponent`-ed URLs).
//
// Effects (UID from a timestamp, DTSTAMP "now") live here at the edge and are injected into the
// pure `buildIcs`, so the ICS builder stays referentially transparent.

import { BUSINESS } from '../../config'
import { barberIndex } from '../barbers'
import type { Booking, BookingLinks, BookingResult } from '../domain'
import { buildIcs, formatIcsLocal } from '../ics'
import type { AvailabilityParams, BookingPort } from '../port'
import { SLOTS, slotTaken } from '../slots'

/** Apple Maps directions URL for the studio (matches the source `mapsHref` constant byte-for-byte). */
const MAPS_HREF = BUSINESS.mapsHref

/** Human-readable location line for calendar entries. */
function locationLine(): string {
  return `${BUSINESS.name}, ${BUSINESS.street}, ${BUSINESS.postalCode} ${BUSINESS.city}`
}

/** Event title (source: `'KNC Studio – ' + service.name + ' (' + barber + ')'`). */
function eventTitle(booking: Booking): string {
  return `${BUSINESS.name} – ${booking.service.name} (${booking.barber.name})`
}

/** Event description (source: localised "Appointment with <barber> · <price> kr"). */
function eventDescription(booking: Booking): string {
  const lead = booking.lang === 'sv' ? 'Bokning hos ' : 'Appointment with '
  return `${lead}${booking.barber.name} · ${booking.service.price} kr`
}

/** Build the Google Calendar "render template" URL with every dynamic part encoded. */
function googleCalHref(booking: Booking): string {
  const text = encodeURIComponent(eventTitle(booking))
  const dates = `${formatIcsLocal(booking.start)}/${formatIcsLocal(booking.end)}`
  const location = encodeURIComponent(locationLine())
  const details = encodeURIComponent(eventDescription(booking))
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&location=${location}&details=${details}`
}

/** Build the `data:text/calendar` href from an escaped ICS payload. */
function icsHref(booking: Booking, uid: string, dtstamp: Date): string {
  const ics = buildIcs({
    uid,
    dtstamp,
    start: booking.start,
    end: booking.end,
    summary: eventTitle(booking),
    location: locationLine(),
    description: eventDescription(booking),
  })
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`
}

/** Derive all calendar/map links for a booking (effects — UID + now — at this edge). */
export function buildLinks(booking: Booking, now: Date = new Date()): BookingLinks {
  const uid = `${now.getTime()}@kncstudio`
  return {
    icsHref: icsHref(booking, uid, now),
    gcalHref: googleCalHref(booking),
    mapsHref: MAPS_HREF,
  }
}

/** Day-of-month from a `YYYY-MM-DD` string (the only part `slotTaken` needs), or 0 if malformed. */
function dayOfMonth(dateIso: string): number {
  const day = Number(dateIso.split('-')[2])
  return Number.isFinite(day) ? day : 0
}

/**
 * Local-only BookingPort: always succeeds, producing the calendar/map links. This is the
 * exact current behavior of the mock (the .ics + Google Cal + maps links), now hardened.
 *
 * `availability` reproduces the ORIGINAL UI greying formula verbatim so the offline/demo/visual
 * baseline is unchanged: for the date + barber, it includes each `SLOTS[i]` whose
 * `slotTaken(dayOfMonth, barberIndex, i, durationMin)` is true. Under the mock the UI's
 * `takenTimes.includes(time)` check therefore matches the old inline `slotTaken(...)` exactly.
 */
export const localCalendarAdapter: BookingPort = {
  submit(booking: Booking): Promise<BookingResult> {
    const links = buildLinks(booking)
    const result: BookingResult = { ok: true, booking, links }
    return Promise.resolve(result)
  },
  availability(params: AvailabilityParams): Promise<readonly string[]> {
    const day = dayOfMonth(params.dateIso)
    const bi = barberIndex(params.barberId)
    const taken = SLOTS.filter((_time, i) => slotTaken(day, bi, i, params.durationMin))
    return Promise.resolve(taken)
  },
}
