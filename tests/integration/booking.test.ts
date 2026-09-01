// create_booking RPC contract ↔ live stack. The browser booking path now POSTs to the
// `submit-booking` edge function (Turnstile + rate-limit, then create_booking via service_role) — an
// HTTP gateway a `pg` connection cannot serve. So this suite tests the create_booking 9-arg RPC
// CONTRACT directly via pg (as service_role): valid future working-hours slot → ok; phone null →
// invalid_contact; bad barber → invalid; overlap → slot_taken; outside hours → outside_hours; and the
// persisted row (customer_name / phone / email-null) + the stored Stockholm instant. The availability
// READ path (the anon `available_slots` RPC, NOT behind the gateway) is still exercised through the
// real adapter. The gateway HTTP layer (Turnstile + rate-limit) is verified separately.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { supabaseBookingAdapter } from '../../src/booking/adapters/supabaseBooking'
import type { Barber } from '../../src/booking/domain'
import { asBarberId } from '../../src/booking/domain'
import type { CreateBookingArgs } from './_helpers'
import {
  backendReady,
  callCreateBooking,
  callCreateBookingWithLimits,
  fetchActiveServiceId,
  fetchPersistedBookingByPhone,
  fetchPersistedStartAtByPhone,
  readStackEnv,
  truncateAll,
  uniquePhone,
  withClient,
} from './_helpers'

const HASSAN: Barber = {
  id: asBarberId('hassan'),
  name: 'Hassan',
  ig: 'freebandzcuts',
}
const VICTOR: Barber = { id: asBarberId('victor'), name: 'Victor', ig: 'vic.barber1' }

// 13:30 Europe/Stockholm on 2040-03-14 (a working day, pre-DST → CET +01) = 12:30:00Z. Passing the
// absolute instant keeps the test tz-independent: create_booking re-derives the salon wall-clock
// (13:30) for the schedule gate, and the row stores exactly this instant.
const VALID_DATE_ISO = '2040-03-14'
const VALID_TIME = '13:30'
const VALID_START_UTC = '2040-03-14T12:30:00.000Z'
// 07:00 Stockholm (CET) — before the 09:00 opening, so the schedule gate rejects it.
const EARLY_START_UTC = '2040-03-14T06:00:00.000Z'
let haircutServiceId = ''

/** Default valid 45-min haircut args for `phone` at the valid working-hours slot. */
function validArgs(phone: string | null): CreateBookingArgs {
  return {
    barberId: HASSAN.id,
    serviceId: haircutServiceId,
    startAt: VALID_START_UTC,
    phone,
    email: phone === null ? 'integration@example.com' : `integration-${phone}@example.com`,
    lang: 'sv',
    customerName: 'Integration Tester',
  }
}

describe.skipIf(!backendReady())('create_booking RPC contract (integration)', () => {
  beforeAll(() => {
    // Guarded by skipIf, but assert presence so a misconfigured run fails loudly, not silently.
    expect(readStackEnv()).not.toBeNull()
  })

  beforeEach(async () => {
    const env = readStackEnv()
    if (env) {
      await truncateAll(env.dbUrl)
      haircutServiceId = await fetchActiveServiceId(env.dbUrl, HASSAN.id, 'Hårklippning')
    }
  })

  it('valid slot persists contact and DB-authoritative service fields', async () => {
    const env = readStackEnv()
    expect(env).not.toBeNull()
    if (!env) return

    const phone = uniquePhone()
    const result = await callCreateBooking(env.dbUrl, validArgs(phone))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.booking.method).toBe('email')

    // GENUINE persistence check: the RPC's ok payload omits customer_name/phone by design, so read the
    // row directly (superuser) to prove contact and server-derived service data persisted.
    const persisted = await fetchPersistedBookingByPhone(env.dbUrl, phone)
    expect(persisted).not.toBeNull()
    expect(persisted?.customerName).toBe('Integration Tester')
    expect(persisted?.phone).toBe(phone)
    expect(persisted?.email).toBe(`integration-${phone}@example.com`)
    expect(persisted?.serviceName).toBe('Hårklippning')
    expect(persisted?.price).toBe('350')
    expect(persisted?.durationMin).toBe(45)

    // The row stores exactly the instant we passed — 13:30 Stockholm (CET) = 12:30:00Z.
    const storedStartAt = await fetchPersistedStartAtByPhone(env.dbUrl, phone)
    expect(storedStartAt).toBe(VALID_START_UTC)
  })

  it('phone null → invalid_contact (the contact guard, defense in depth)', async () => {
    const env = readStackEnv()
    if (!env) return
    const result = await callCreateBooking(env.dbUrl, validArgs(null))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid_contact')
  })

  it('email null → invalid_contact', async () => {
    const env = readStackEnv()
    if (!env) return
    const result = await callCreateBooking(env.dbUrl, {
      ...validArgs(uniquePhone()),
      email: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid_contact')
  })

  it('inactive or foreign service id → invalid', async () => {
    const env = readStackEnv()
    if (!env) return
    const result = await callCreateBooking(env.dbUrl, {
      ...validArgs(uniquePhone()),
      serviceId: '00000000-0000-0000-0000-000000000000',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid')
  })

  it('unknown barber → invalid', async () => {
    const env = readStackEnv()
    if (!env) return
    const result = await callCreateBooking(env.dbUrl, {
      ...validArgs(uniquePhone()),
      barberId: 'nope',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('invalid')
  })

  it('a second booking that OVERLAPS the first (same barber, same time) → slot_taken', async () => {
    const env = readStackEnv()
    if (!env) return
    const first = await callCreateBooking(env.dbUrl, validArgs(uniquePhone()))
    expect(first.ok).toBe(true)

    const second = await callCreateBooking(env.dbUrl, validArgs(uniquePhone()))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toBe('slot_taken')
  })

  it('10 concurrent attempts for one slot persist exactly one booking', async () => {
    const env = readStackEnv()
    if (!env) return

    const attempts = Array.from({ length: 10 }, () =>
      callCreateBooking(env.dbUrl, validArgs(uniquePhone())),
    )
    const results = await Promise.all(attempts)

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok && result.error === 'slot_taken')).toHaveLength(9)

    const persisted = await withClient(env.dbUrl, async (client) => {
      const result = await client.query<{ count: string }>(
        `select count(*)::text as count
         from public.bookings
         where barber_id = $1 and start_at = $2::timestamptz and status = 'confirmed'`,
        [HASSAN.id, VALID_START_UTC],
      )
      return Number(result.rows[0]?.count ?? '0')
    })
    expect(persisted).toBe(1)
  })

  it('10 concurrent slots for one phone atomically respect the phone limit', async () => {
    const env = readStackEnv()
    if (!env) return

    const phone = uniquePhone()
    const starts = [
      '2040-03-14T08:00:00.000Z',
      '2040-03-14T08:45:00.000Z',
      '2040-03-14T09:30:00.000Z',
      '2040-03-14T10:15:00.000Z',
      '2040-03-14T11:00:00.000Z',
      '2040-03-14T11:45:00.000Z',
      '2040-03-14T12:30:00.000Z',
      '2040-03-14T13:15:00.000Z',
      '2040-03-14T14:00:00.000Z',
      '2040-03-14T14:45:00.000Z',
    ]
    const attempts = starts.map((startAt, index) =>
      callCreateBookingWithLimits(
        env.dbUrl,
        { ...validArgs(phone), startAt },
        index.toString(16).padStart(64, '0'),
        5,
      ),
    )
    const results = await Promise.all(attempts)

    expect(results.filter((result) => result.ok)).toHaveLength(5)
    expect(results.filter((result) => !result.ok && result.error === 'rate_limited')).toHaveLength(
      5,
    )
  })

  it('a slot outside the barber working hours → outside_hours (server-side schedule gate)', async () => {
    const env = readStackEnv()
    if (!env) return
    const phone = uniquePhone()
    const result = await callCreateBooking(env.dbUrl, {
      ...validArgs(phone),
      startAt: EARLY_START_UTC,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('outside_hours')

    // Nothing persisted for the rejected booking.
    const persisted = await fetchPersistedBookingByPhone(env.dbUrl, phone)
    expect(persisted).toBeNull()
  })

  // The availability READ path is the anon `available_slots` RPC (NOT behind the gateway), so it is
  // still driven through the real adapter — seeding the booking via the create_booking RPC above.
  it('availability drops the booked slot time from the available set after a booking', async () => {
    const env = readStackEnv()
    if (!env) return

    // availability() returns the AVAILABLE times (not TAKEN): the free slot is offered BEFORE the
    // booking and gone AFTER it.
    const before = await supabaseBookingAdapter.availability({
      barberId: HASSAN.id,
      dateIso: VALID_DATE_ISO,
      durationMin: 45,
      serviceId: haircutServiceId,
    })
    expect(before).toContain(VALID_TIME)

    const booked = await callCreateBooking(env.dbUrl, validArgs(uniquePhone()))
    expect(booked.ok).toBe(true)

    const after = await supabaseBookingAdapter.availability({
      barberId: HASSAN.id,
      dateIso: VALID_DATE_ISO,
      durationMin: 45,
      serviceId: haircutServiceId,
    })
    expect(after).not.toContain(VALID_TIME)
  })

  it('a different barber is NOT blocked by another barber’s booking at the same time', async () => {
    const env = readStackEnv()
    if (!env) return

    const booked = await callCreateBooking(env.dbUrl, validArgs(uniquePhone()))
    expect(booked.ok).toBe(true)

    const victorSlots = await supabaseBookingAdapter.availability({
      barberId: VICTOR.id,
      dateIso: VALID_DATE_ISO,
      durationMin: 45,
    })
    expect(victorSlots).toContain(VALID_TIME)
  })

  it('enforces service weekdays and recurring breaks in live availability and create_booking', async () => {
    const env = readStackEnv()
    if (!env) return

    const weekday = await withClient(env.dbUrl, async (client) => {
      const result = await client.query<{ weekday: number }>(
        `select extract(dow from $1::timestamptz at time zone 'Europe/Stockholm')::integer as weekday`,
        [VALID_START_UTC],
      )
      return result.rows[0]?.weekday
    })
    expect(weekday).toBeTypeOf('number')
    if (weekday === undefined) return

    const originalWeekdays = await withClient(env.dbUrl, async (client) => {
      const result = await client.query<{ available_weekdays: number[] }>(
        'select available_weekdays from public.services where id = $1::uuid',
        [haircutServiceId],
      )
      return result.rows[0]?.available_weekdays
    })
    expect(originalWeekdays).toBeDefined()
    if (originalWeekdays === undefined) return

    try {
      await withClient(env.dbUrl, async (client) => {
        await client.query(
          'update public.services set available_weekdays = array[$2]::smallint[] where id = $1::uuid',
          [haircutServiceId, weekday],
        )
      })

      const before = await supabaseBookingAdapter.availability({
        barberId: HASSAN.id,
        dateIso: VALID_DATE_ISO,
        durationMin: 45,
        serviceId: haircutServiceId,
      })
      expect(before).toContain(VALID_TIME)

      await withClient(env.dbUrl, async (client) => {
        await client.query(
          `insert into public.barber_recurring_breaks (barber_id, weekday, start_min, end_min)
           values ($1, $2, 810, 840)`,
          [HASSAN.id, weekday],
        )
      })

      const blocked = await supabaseBookingAdapter.availability({
        barberId: HASSAN.id,
        dateIso: VALID_DATE_ISO,
        durationMin: 45,
        serviceId: haircutServiceId,
      })
      expect(blocked).not.toContain(VALID_TIME)

      const breakRejected = await callCreateBooking(env.dbUrl, validArgs(uniquePhone()))
      expect(breakRejected.ok).toBe(false)
      if (!breakRejected.ok) expect(breakRejected.error).toBe('outside_hours')

      await withClient(env.dbUrl, async (client) => {
        await client.query(
          'update public.services set available_weekdays = array[$2]::smallint[] where id = $1::uuid',
          [haircutServiceId, (weekday + 1) % 7],
        )
      })

      const unavailableDay = await supabaseBookingAdapter.availability({
        barberId: HASSAN.id,
        dateIso: VALID_DATE_ISO,
        durationMin: 45,
        serviceId: haircutServiceId,
      })
      expect(unavailableDay).toEqual([])

      const weekdayRejected = await callCreateBooking(env.dbUrl, validArgs(uniquePhone()))
      expect(weekdayRejected.ok).toBe(false)
      if (!weekdayRejected.ok) expect(weekdayRejected.error).toBe('outside_hours')
    } finally {
      await withClient(env.dbUrl, async (client) => {
        await client.query(
          `delete from public.barber_recurring_breaks
           where barber_id = $1 and weekday = $2 and start_min = 810 and end_min = 840`,
          [HASSAN.id, weekday],
        )
        await client.query(
          'update public.services set available_weekdays = $2::smallint[] where id = $1::uuid',
          [haircutServiceId, originalWeekdays],
        )
      })
    }
  })
})
