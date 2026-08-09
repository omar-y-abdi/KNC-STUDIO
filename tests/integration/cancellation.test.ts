// Cancellation adapter ↔ live stack. Seeds a confirmed FUTURE booking via the create_booking RPC
// (the booking path's HTTP gateway can't be served by a `pg` connection — see booking.test.ts), then
// drives `supabaseCancellationAdapter`: lookup(correct phone) finds it → cancel → re-lookup not_found;
// and lookup(WRONG phone) → not_found (the contact-proving security guarantee). Phone-only now: the
// lookup is 1-arg (no method), and cancel matches on the proven phone alone. Truncates first.

import { beforeEach, describe, expect, it } from 'vitest'
import { supabaseCancellationAdapter } from '../../src/cancellation/adapters/supabaseCancellation'
import { BARBERS } from '../../src/booking/barbers'
import type { Barber } from '../../src/booking/domain'
import { asBarberId } from '../../src/booking/domain'
import type { CreateBookingArgs } from './_helpers'
import {
  backendReady,
  callCreateBooking,
  fetchActiveServiceId,
  readStackEnv,
  truncateAll,
  uniquePhone,
} from './_helpers'

const HASSAN: Barber = BARBERS[0] ?? {
  id: asBarberId('hassan'),
  name: 'Hassan',
  ig: 'freebandzcuts',
}

// 13:30 Europe/Stockholm on 2040-03-14 (a working day, pre-DST CET) = 12:30:00Z — a valid future
// working-hours slot the create_booking schedule gate accepts.
const SEED_START_UTC = '2040-03-14T12:30:00.000Z'
let haircutServiceId = ''

/** Args for a future SMS booking for `phone` at the seed slot. */
function seedArgs(phone: string): CreateBookingArgs {
  return {
    barberId: HASSAN.id,
    serviceId: haircutServiceId,
    startAt: SEED_START_UTC,
    phone,
    email: `cancel-${phone}@example.com`,
    lang: 'sv',
    customerName: 'Cancel Tester',
  }
}

// The adapter labels the booking in SALON time (Europe/Stockholm), independent of the runner's tz:
// the seed instant 12:30Z is 13:30 CET.
const EXPECTED_WHEN_TIME = '13:30'

describe.skipIf(!backendReady())('supabaseCancellationAdapter (integration)', () => {
  beforeEach(async () => {
    const env = readStackEnv()
    if (env) {
      await truncateAll(env.dbUrl)
      haircutServiceId = await fetchActiveServiceId(env.dbUrl, HASSAN.id, 'Hårklippning')
    }
  })

  it('lookup(correct phone) finds the booking, cancel cancels it, re-lookup is not_found', async () => {
    const env = readStackEnv()
    if (!env) return

    const phone = uniquePhone()
    const created = await callCreateBooking(env.dbUrl, seedArgs(phone))
    expect(created.ok).toBe(true)

    const found = await supabaseCancellationAdapter.lookup({ contact: phone, lang: 'sv' })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.booking.barber.id).toBe(HASSAN.id)
    expect(found.booking.serviceName).toBe('Hårklippning')
    expect(found.booking.contact).toBe(phone)
    // whenLabel mirrors buildDemoBooking's "Weekday D Month, HH:MM" — in Stockholm wall-clock.
    expect(found.booking.whenLabel).toContain(EXPECTED_WHEN_TIME)

    const cancelled = await supabaseCancellationAdapter.cancel(found.booking)
    expect(cancelled.ok).toBe(true)

    // Idempotent: the booking is now cancelled → no longer found.
    const again = await supabaseCancellationAdapter.lookup({ contact: phone, lang: 'sv' })
    expect(again.ok).toBe(false)
  })

  it('lookup(WRONG phone) returns not_found (cannot find someone else’s booking)', async () => {
    const env = readStackEnv()
    if (!env) return

    const realPhone = uniquePhone()
    const created = await callCreateBooking(env.dbUrl, seedArgs(realPhone))
    expect(created.ok).toBe(true)

    // A different, non-matching phone must never surface the existing booking.
    const wrong = uniquePhone()
    const result = await supabaseCancellationAdapter.lookup({ contact: wrong, lang: 'sv' })
    expect(result.ok).toBe(false)
  })
})
