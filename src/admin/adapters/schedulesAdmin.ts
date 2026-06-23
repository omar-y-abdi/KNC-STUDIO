// Schedules admin adapter. Reads a barber's 7 weekday rows and writes them back via UPSERT
// (PK barber_id+weekday). RLS makes a barber able to write ONLY their own rows; the owner may write
// any barber's. The adapter writes the WHOLE week in one upsert so "samma tid alla dagar" and
// per-day edits both persist atomically (PostgREST batches the array).
//
// availableSlotsFor previews the bookable slots a saved schedule produces (the same anon-callable
// `available_slots` RPC the public booking flow uses) — so the editor can show "what customers see".
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import {
  availableSlotsResponse,
  parseWith,
  scheduleRows,
} from '../adminSchemas'
import { toWeekSchedule } from '../time'
import type { AdminBarberId, AdminResult, WeekSchedule } from '../types'
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
      weekday: r.weekday as WeekSchedule[number]['weekday'],
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
 * Persist the whole week (upsert on PK barber_id+weekday). All 7 rows are written so the stored state
 * exactly matches the editor. RLS rejects a write the caller is not allowed to make (42501 -> forbidden).
 */
export async function saveWeek(
  barberId: AdminBarberId,
  week: WeekSchedule,
): Promise<AdminResult<WeekSchedule>> {
  const rows = week.map((d) => ({
    barber_id: barberId,
    weekday: d.weekday,
    working: d.working,
    start_min: d.startMin,
    end_min: d.endMin,
  }))
  try {
    const { error } = await getAdminClient()
      .from('barber_schedules')
      .upsert(rows, { onConflict: 'barber_id,weekday' })
    if (error !== null) {
      if (error.code === '42501') return err('forbidden', 'Du kan bara ändra ditt eget schema.')
      return err('network', WRITE_ERROR)
    }
    return ok(week)
  } catch {
    return err('network', WRITE_ERROR)
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
