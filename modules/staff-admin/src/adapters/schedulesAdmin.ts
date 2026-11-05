// Schedules admin adapter. Reads a barber's 7 weekday rows and writes the complete week through the
// transactional `admin_save_barber_week` RPC. Direct authenticated writes to `barber_schedules` are
// revoked by the transactional availability migration; the RPC authorizes owner/own-barber scope,
// validates all seven rows, and detects conflicts before applying the whole replacement.
//
// availableSlotsFor exposes the same anon-callable `available_slots` RPC the public booking flow
// uses ("what customers see"); the database definer RPC remains the live availability authority and
// the integration tests assert schedule edits through it.
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { availableSlotsResponse, parseWith, saveWeekResponse, scheduleRows } from '../adminSchemas'
import { toWeekSchedule } from '../time'
import type {
  AdminBarberId,
  AdminResult,
  AvailabilityMutationOutcome,
  WeekSchedule,
} from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa schemat.'
const WRITE_ERROR = 'Kunde inte spara schemat. Försök igen.'
const SLOTS_ERROR = 'Kunde inte hämta lediga tider.'

/** Read a barber's week, normalized to the fixed 7-entry `WeekSchedule` (missing days -> defaults). */
export async function readWeek(barberId: AdminBarberId): Promise<AdminResult<WeekSchedule>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_schedules')
      .select('barber_id,weekday,working,start_min,end_min')
      .eq('barber_id', barberId)
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(scheduleRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)

    const days = parsed.value.map((r) => ({
      weekday: r.weekday,
      working: r.working,
      startMin: r.start_min,
      endMin: r.end_min,
    }))
    return ok(toWeekSchedule(days))
  } catch {
    return err('network', READ_ERROR)
  }
}

/**
 * Persist the whole week through the transactional RPC. All seven rows are supplied so stored state
 * exactly matches the editor; the server authorizes and validates the replacement atomically.
 */
export async function saveWeek(
  barberId: AdminBarberId,
  week: WeekSchedule,
  allowExistingBookings = false,
): Promise<AvailabilityMutationOutcome<WeekSchedule>> {
  const rows = week.map((d) => ({
    barber_id: barberId,
    weekday: d.weekday,
    working: d.working,
    start_min: d.startMin,
    end_min: d.endMin,
  }))
  try {
    const { data, error } = await getAdminClient().rpc('admin_save_barber_week', {
      p_barber_id: barberId,
      p_week: rows.map((row) => ({
        weekday: row.weekday,
        working: row.working,
        start_min: row.start_min,
        end_min: row.end_min,
      })),
      p_allow_existing_bookings: allowExistingBookings,
    })
    if (error !== null) return { kind: 'error', error: { kind: 'network', message: WRITE_ERROR } }
    const parsed = parseWith(saveWeekResponse, data)
    if (!parsed.ok) return { kind: 'error', error: { kind: 'malformed', message: WRITE_ERROR } }
    if (parsed.value.ok) return { kind: 'ok', value: week }
    if (parsed.value.error === 'booking_conflict') {
      return { kind: 'booking_conflict', bookingIds: parsed.value.booking_ids }
    }
    if (parsed.value.error === 'forbidden') {
      return {
        kind: 'error',
        error: { kind: 'forbidden', message: 'Du kan bara ändra ditt eget schema.' },
      }
    }
    return { kind: 'error', error: { kind: 'validation', message: WRITE_ERROR } }
  } catch {
    return { kind: 'error', error: { kind: 'network', message: WRITE_ERROR } }
  }
}

/**
 * Preview the bookable `HH:MM` slots for a barber on a date + duration (anon-callable RPC). Used by
 * the editor's "förhandsgranska lediga tider" and asserted by the integration test that availability
 * reflects a schedule/time-off edit.
 */
export async function availableSlotsFor(
  barberId: AdminBarberId,
  dateIso: string,
  durationMin: number,
): Promise<AdminResult<readonly string[]>> {
  try {
    const { data, error } = await getAdminClient().rpc('available_slots', {
      p_barber_id: barberId,
      p_date: dateIso,
      p_duration_min: durationMin,
    })
    if (error !== null) return err('network', SLOTS_ERROR)

    const parsed = parseWith(availableSlotsResponse, data)
    if (!parsed.ok) return err('malformed', SLOTS_ERROR)
    return ok(parsed.value)
  } catch {
    return err('network', SLOTS_ERROR)
  }
}
