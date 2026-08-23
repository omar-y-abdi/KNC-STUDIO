// Admin integration — the BARBER role (ADMIN_SPEC §7 + the §8 security guarantee). Signs the shared
// admin client in as the seeded barber (linked to `hassan`) and drives the REAL admin adapters:
//   * reads OWN schedule, edits it, adds + removes OWN time-off — all succeed.
//   * reads OWN bookings only (a booking for ANOTHER barber is never visible).
//   * CANNOT touch another barber's schedule/time-off/bookings — proven by READ-BACK via the
//     superuser (an RLS-filtered UPDATE/DELETE affects 0 rows and returns NO error, so we assert the
//     other barber's data is UNCHANGED rather than expecting an exception). An INSERT of another's
//     row is the one case that throws (WITH CHECK), asserted as a forbidden Result.
//
// The client is the browser path: anon key + signInWithPassword, so RLS sees role='barber'. The
// adapters call `getAdminClient()` (the same singleton), which this file signs in once in beforeAll.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getAdminClient } from '../../src/admin/adminClient'
import { readWeek, saveWeek } from '../../src/admin/adapters/schedulesAdmin'
import { addTimeOff, deleteTimeOff, listTimeOff } from '../../src/admin/adapters/timeOffAdmin'
import { listBookings, cancelBooking } from '../../src/admin/adapters/bookingsAdmin'
import { setDayHours } from '../../src/admin/time'
import type { WeekSchedule } from '../../src/admin/types'
import {
  BARBER_EMAIL,
  BARBER_LINK_ID,
  BARBER_PASSWORD,
  OTHER_BARBER_ID,
  adminBackendReady,
  bookingStatusRaw,
  countTimeOffRaw,
  insertBookingRaw,
  readAdminStackEnv,
  readScheduleRaw,
  restoreSeedState,
} from './_adminHelpers'

describe.skipIf(!adminBackendReady())('admin adapters — barber role (integration)', () => {
  beforeAll(async () => {
    // Sign the shared admin client in as the barber (the adapters use this same client).
    const { error } = await getAdminClient().auth.signInWithPassword({
      email: BARBER_EMAIL,
      password: BARBER_PASSWORD,
    })
    if (error !== null) throw new Error(`barber sign-in failed: ${error.message}`)
  })

  afterAll(async () => {
    await getAdminClient().auth.signOut()
  })

  beforeEach(async () => {
    const env = readAdminStackEnv()
    if (env) await restoreSeedState(env)
  })

  afterEach(async () => {
    const env = readAdminStackEnv()
    if (env) await restoreSeedState(env)
  })

  it('reads and edits OWN schedule (the linked barber)', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    const read = await readWeek(BARBER_LINK_ID)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    // Seed default: Monday (weekday 1) works 09:00–18:00.
    const monday = read.value[1]
    expect(monday.working).toBe(true)
    expect(monday.startMin).toBe(540)
    expect(monday.endMin).toBe(1080)

    // Edit Monday to 10:00–16:00 and save.
    const edited: WeekSchedule = setDayHours(read.value, 1, 600, 960)
    const saved = await saveWeek(BARBER_LINK_ID, edited)
    expect(saved.kind).toBe('ok')

    // Confirm it persisted (read back via the superuser, authority-independent).
    const raw = await readScheduleRaw(env, BARBER_LINK_ID)
    const rawMonday = raw.find((r) => r.weekday === 1)
    expect(rawMonday?.start_min).toBe(600)
    expect(rawMonday?.end_min).toBe(960)
  })

  it('adds and removes OWN time-off', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    const added = await addTimeOff(BARBER_LINK_ID, '2030-07-01', '2030-07-07', 'Semester')
    expect(added.kind).toBe('ok')
    if (added.kind !== 'ok') return
    expect(added.value.barberId).toBe(BARBER_LINK_ID)

    const list = await listTimeOff(BARBER_LINK_ID)
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect(list.value.some((t) => t.id === added.value.id)).toBe(true)

    const removed = await deleteTimeOff(added.value.id)
    expect(removed.ok).toBe(true)
    expect(await countTimeOffRaw(env, BARBER_LINK_ID)).toBe(0)
  })

  it('sees ONLY own bookings (never another barber’s)', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    // Insert one booking for the linked barber and one for another barber.
    const mineId = await insertBookingRaw(env, BARBER_LINK_ID, new Date(2030, 7, 12, 11, 15), 45)
    await insertBookingRaw(env, OTHER_BARBER_ID, new Date(2030, 7, 12, 12, 0), 45)

    const result = await listBookings()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Every visible booking belongs to the linked barber; the other barber's is invisible.
    expect(result.value.length).toBeGreaterThanOrEqual(1)
    expect(result.value.every((b) => b.barberId === BARBER_LINK_ID)).toBe(true)
    expect(result.value.some((b) => b.id === mineId)).toBe(true)
    expect(result.value.some((b) => b.barberId === OTHER_BARBER_ID)).toBe(false)
  })

  it('CANNOT edit another barber’s schedule — RLS filters the write to 0 rows (data unchanged)', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    // Baseline of the OTHER barber's Monday (seed default 540–1080).
    const before = await readScheduleRaw(env, OTHER_BARBER_ID)
    const beforeMon = before.find((r) => r.weekday === 1)
    expect(beforeMon?.start_min).toBe(540)
    expect(beforeMon?.end_min).toBe(1080)

    // Attempt to overwrite the OTHER barber's whole week to 08:00–20:00 via the adapter. The
    // schedules_*_own policy USING/CHECK is barber_id = current_barber_id(); the upsert's UPDATE leg
    // matches 0 rows for another barber, and its INSERT leg is rejected by WITH CHECK. supabase-js
    // surfaces the WITH CHECK violation as an error -> the adapter maps it to a forbidden Result.
    const malicious = before.map((r) => ({
      weekday: r.weekday as WeekSchedule[number]['weekday'],
      working: true,
      startMin: 480,
      endMin: 1200,
    })) as unknown as WeekSchedule
    const attempt = await saveWeek(OTHER_BARBER_ID, malicious)
    expect(attempt.kind).toBe('error')

    // THE assertion: the other barber's schedule is byte-for-byte unchanged.
    const after = await readScheduleRaw(env, OTHER_BARBER_ID)
    const afterMon = after.find((r) => r.weekday === 1)
    expect(afterMon?.start_min).toBe(540)
    expect(afterMon?.end_min).toBe(1080)
    expect(after.every((r) => r.start_min === 540 && r.end_min === 1080)).toBe(true)
  })

  it('CANNOT add time-off for another barber (WITH CHECK rejects the insert)', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    const attempt = await addTimeOff(OTHER_BARBER_ID, '2030-09-01', '2030-09-02', 'hack')
    expect(attempt.kind).toBe('error')
    if (attempt.kind !== 'error') return
    expect(attempt.error.kind).toBe('forbidden')

    // No row landed for the other barber.
    expect(await countTimeOffRaw(env, OTHER_BARBER_ID)).toBe(0)
  })

  it('CANNOT cancel another barber’s booking (RPC returns forbidden; booking stays confirmed)', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    const otherId = await insertBookingRaw(env, OTHER_BARBER_ID, new Date(2030, 9, 5, 10, 30), 45)
    const attempt = await cancelBooking(otherId)
    expect(attempt.ok).toBe(false)
    if (attempt.ok) return
    expect(attempt.error.kind).toBe('forbidden')

    // The booking is still confirmed (the cancel did not take effect).
    expect(await bookingStatusRaw(env, otherId)).toBe('confirmed')
  })

  it('CAN cancel OWN booking (owning barber path)', async () => {
    const env = readAdminStackEnv()
    if (env === null) return

    const mineId = await insertBookingRaw(env, BARBER_LINK_ID, new Date(2030, 9, 6, 14, 15), 45)
    const result = await cancelBooking(mineId)
    expect(result.ok).toBe(true)
    expect(await bookingStatusRaw(env, mineId)).toBe('cancelled')
  })
})
