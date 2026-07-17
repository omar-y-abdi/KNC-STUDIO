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
import { BARBERS } from '../../src/booking/barbers'
import type { Barber } from '../../src/booking/domain'
import { asBarberId } from '../../src/booking/domain'
import type { CreateBookingArgs } from './_helpers'
import {
  backendReady,
  callCreateBooking,
  fetchPersistedBookingByPhone,
  fetchPersistedStartAtByPhone,
  readStackEnv,
  truncateAll,
  uniquePhone,
} from './_helpers'

const HASSAN: Barber = BARBERS[0] ?? {
  id: asBarberId('hassan'),
  name: 'Hassan',
  ig: 'freebandzcuts',
}
const VICTOR: Barber = BARBERS[1] ?? HASSAN

// 13:30 Europe/Stockholm on 2040-03-14 (a working day, pre-DST → CET +01) = 12:30:00Z. Passing the
// absolute instant keeps the test tz-independent: create_booking re-derives the salon wall-clock
// (13:30) for the schedule gate, and the row stores exactly this instant.
const VALID_DATE_ISO = '2040-03-14'
const VALID_TIME = '13:30'
const VALID_START_UTC = '2040-03-14T12:30:00.000Z'
// 07:00 Stockholm (CET) — before the 09:00 opening, so the schedule gate rejects it.
const EARLY_START_UTC = '2040-03-14T06:00:00.000Z'

/** Default valid 45-min haircut args for `phone` at the valid working-hours slot. */
function validArgs(phone: string | null): CreateBookingArgs {
  return {
    barberId: HASSAN.id,
    serviceId: 'h',
    serviceName: 'Hårklippning',
    price: 350,
    durationMin: 45,
    startAt: VALID_START_UTC,
    phone,
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
    if (env) await truncateAll(env.dbUrl)
  })

  it('valid future working-hours slot → ok, persists customer_name/phone (email null) + Stockholm instant', async () => {
    const env = readStackEnv()
    expect(env).not.toBeNull()
    if (!env) return

    const phone = uniquePhone()
    const result = await callCreateBooking(env.dbUrl, validArgs(phone))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.booking.method).toBe('sms') // email removed: always sms now

    // GENUINE persistence check: the RPC's ok payload omits customer_name/phone by design, so read the
    // row directly (superuser) to prove `p_customer_name` landed in the NOT-NULL column AND the SMS
    // contact persisted (email null for every booking now).
    const persisted = await fetchPersistedBookingByPhone(env.dbUrl, phone)
    expect(persisted).not.toBeNull()
    expect(persisted?.customerName).toBe('Integration Tester')
    expect(persisted?.phone).toBe(phone)
    expect(persisted?.email).toBeNull()

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
    })
    expect(before).toContain(VALID_TIME)

    const booked = await callCreateBooking(env.dbUrl, validArgs(uniquePhone()))
    expect(booked.ok).toBe(true)

    const after = await supabaseBookingAdapter.availability({
      barberId: HASSAN.id,
      dateIso: VALID_DATE_ISO,
      durationMin: 45,
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
})
