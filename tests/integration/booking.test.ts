// Booking adapter ↔ live stack. Drives `supabaseBookingAdapter` (the real RLS path via the anon
// key) end to end: submit persists + returns links; an overlapping second booking is rejected; and
// `availability` reports the booked slot's time afterwards. Truncates `bookings`/`reviews` before
// each test (superuser) for a clean slate.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { supabaseBookingAdapter } from '../../src/booking/adapters/supabaseBooking'
import { BARBERS } from '../../src/booking/barbers'
import type { Barber, Booking, ServiceItem } from '../../src/booking/domain'
import { asBarberId } from '../../src/booking/domain'
import {
  backendReady,
  fetchPersistedBookingByPhone,
  fetchPersistedStartAtByPhone,
  readStackEnv,
  truncateAll,
  uniquePhone,
} from './_helpers'

const HASSAN: Barber = BARBERS[0] ?? { id: asBarberId('hassan'), name: 'Hassan', ig: 'freebandzcuts' }

/** A 45-min haircut (matches a real pricing item; only the fields the adapter sends matter). */
const HAIRCUT: ServiceItem = { id: 'h', name: 'Hårklippning', price: 350, dur: 45 }

/**
 * Build a Booking whose `start` is a BROWSER-LOCAL slot time on `dateIso` — exactly how BookingFlow
 * constructs it — so the same instant lines up with the adapter's availability window.
 */
function bookingAt(
  dateIso: string,
  time: string,
  opts: { barber?: Barber; service?: ServiceItem; phone?: string } = {},
): Booking {
  const barber = opts.barber ?? HASSAN
  const service = opts.service ?? HAIRCUT
  const [y, m, d] = dateIso.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const start = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0)
  const end = new Date(start.getTime() + service.dur * 60000)
  return {
    barber,
    service,
    start,
    end,
    confirmMethod: 'sms',
    customerName: 'Integration Tester',
    phone: opts.phone ?? '0701234567',
    email: '',
    lang: 'sv',
  }
}

describe.skipIf(!backendReady())('supabaseBookingAdapter (integration)', () => {
  beforeAll(() => {
    // Guarded by skipIf, but assert presence so a misconfigured run fails loudly, not silently.
    expect(readStackEnv()).not.toBeNull()
  })

  beforeEach(async () => {
    const env = readStackEnv()
    if (env) await truncateAll(env.dbUrl)
  })

  it('submit persists the booking (incl. customer_name) and returns calendar/map links', async () => {
    const env = readStackEnv()
    expect(env).not.toBeNull()
    if (!env) return

    const phone = uniquePhone()
    const result = await supabaseBookingAdapter.submit(
      bookingAt('2040-03-14', '13:30', { phone }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Links are built by the same builder the mock uses.
      expect(result.links.icsHref.startsWith('data:text/calendar')).toBe(true)
      expect(result.links.gcalHref.startsWith('https://calendar.google.com/')).toBe(true)
      expect(result.links.mapsHref.length).toBeGreaterThan(0)
    }

    // GENUINE persistence check: the RPC's ok payload omits customer_name/phone by design, so read
    // the row directly (superuser) to prove the 11th arg `p_customer_name` landed in the NOT-NULL
    // column AND the chosen channel's contact persisted (email null for an SMS booking).
    const persisted = await fetchPersistedBookingByPhone(env.dbUrl, phone)
    expect(persisted).not.toBeNull()
    expect(persisted?.customerName).toBe('Integration Tester')
    expect(persisted?.phone).toBe(phone)
    expect(persisted?.email).toBeNull()
  })

  it('rejects a second booking that OVERLAPS the first (same barber, same time)', async () => {
    const first = await supabaseBookingAdapter.submit(bookingAt('2040-03-14', '13:30'))
    expect(first.ok).toBe(true)

    // Same barber + same start → overlaps → the exclusion constraint fires → ok:false (no throw).
    const second = await supabaseBookingAdapter.submit(
      bookingAt('2040-03-14', '13:30', { phone: '0709999999' }),
    )
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe('submit')
  })

  it('availability reports the booked slot time after a booking', async () => {
    const dateIso = '2040-03-14'
    const time = '13:30'

    const before = await supabaseBookingAdapter.availability({
      barberId: HASSAN.id,
      dateIso,
      durationMin: HAIRCUT.dur,
    })
    expect(before).not.toContain(time)

    const booked = await supabaseBookingAdapter.submit(bookingAt(dateIso, time))
    expect(booked.ok).toBe(true)

    const after = await supabaseBookingAdapter.availability({
      barberId: HASSAN.id,
      dateIso,
      durationMin: HAIRCUT.dur,
    })
    expect(after).toContain(time)
  })

  it('a different barber is NOT blocked by another barber’s booking at the same time', async () => {
    const dateIso = '2040-03-14'
    const time = '13:30'
    const victor = BARBERS[1] ?? HASSAN

    await supabaseBookingAdapter.submit(bookingAt(dateIso, time, { barber: HASSAN }))
    const victorSlots = await supabaseBookingAdapter.availability({
      barberId: victor.id,
      dateIso,
      durationMin: HAIRCUT.dur,
    })
    expect(victorSlots).not.toContain(time)
  })

  // H2 — the adapter stores the Europe/Stockholm instant for the SELECTED wall-clock, not the
  // browser-local instant. `bookingAt('2040-03-14','13:30')` builds `start` from local components, so
  // its `.getHours()` reads back 13 in ANY runner tz; the adapter re-anchors that to Stockholm. The
  // stored instant must therefore be 12:30:00Z (13:30 CET, +01:00) — proven directly against the row.
  // (Cross-timezone correctness of the helper itself is covered tz-independently in the unit suite.)
  it('stores the Europe/Stockholm instant for the selected slot (tz-correct write)', async () => {
    const env = readStackEnv()
    expect(env).not.toBeNull()
    if (!env) return

    const phone = uniquePhone()
    const result = await supabaseBookingAdapter.submit(bookingAt('2040-03-14', '13:30', { phone }))
    expect(result.ok).toBe(true)

    const storedStartAt = await fetchPersistedStartAtByPhone(env.dbUrl, phone)
    // 2040-03-14 is before the last-Sunday-of-March DST switch, so Stockholm is CET (UTC+1).
    expect(storedStartAt).toBe('2040-03-14T12:30:00.000Z')
  })

  // H1 — create_booking now enforces working hours server-side. A booking OUTSIDE the barber's
  // 09:00–18:00 window (here 07:00 Stockholm, before opening) is rejected by the RPC; the adapter maps
  // the {ok:false,error:'outside_hours'} Result to a submit failure (no throw, no row written).
  it('rejects a booking outside the barber working hours (server-side schedule gate)', async () => {
    const env = readStackEnv()
    expect(env).not.toBeNull()
    if (!env) return

    const phone = uniquePhone()
    const result = await supabaseBookingAdapter.submit(
      bookingAt('2040-03-14', '07:00', { phone }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('submit')

    // Nothing persisted for the rejected booking.
    const persisted = await fetchPersistedBookingByPhone(env.dbUrl, phone)
    expect(persisted).toBeNull()
  })
})
