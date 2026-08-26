// Weekly break adapter. Direct writes are intentionally unavailable to browser clients; these RPCs
// serialize with booking creation and surface customer conflicts before an operator overrides them.

import { getAdminClient } from '../adminClient'
import {
  addRecurringBreakResponse,
  deleteRecurringBreakResponse,
  parseWith,
  recurringBreakRows,
} from '../adminSchemas'
import type {
  AdminBarberId,
  AdminResult,
  AvailabilityMutationOutcome,
  RecurringBreak,
  Weekday,
} from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa återkommande pauser.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'
const COLUMNS = 'id,barber_id,weekday,start_min,end_min'

function toRecurringBreak(r: {
  id: string
  barber_id: string
  weekday: Weekday
  start_min: number
  end_min: number
}): RecurringBreak {
  return {
    id: r.id,
    barberId: r.barber_id,
    weekday: r.weekday,
    startMin: r.start_min,
    endMin: r.end_min,
  }
}

export async function listRecurringBreaks(
  barberId: AdminBarberId,
): Promise<AdminResult<readonly RecurringBreak[]>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_recurring_breaks')
      .select(COLUMNS)
      .eq('barber_id', barberId)
      .order('weekday', { ascending: true })
      .order('start_min', { ascending: true })
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(recurringBreakRows, data)
    return parsed.ok ? ok(parsed.value.map(toRecurringBreak)) : err('malformed', READ_ERROR)
  } catch {
    return err('network', READ_ERROR)
  }
}

export async function addRecurringBreak(
  barberId: AdminBarberId,
  weekday: Weekday,
  startMin: number,
  endMin: number,
  allowExistingBookings = false,
): Promise<AvailabilityMutationOutcome<RecurringBreak>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_add_recurring_break', {
      p_barber_id: barberId,
      p_weekday: weekday,
      p_start_min: startMin,
      p_end_min: endMin,
      p_allow_existing_bookings: allowExistingBookings,
    })
    if (error !== null) return { kind: 'error', error: { kind: 'network', message: WRITE_ERROR } }

    const parsed = parseWith(addRecurringBreakResponse, data)
    if (!parsed.ok) return { kind: 'error', error: { kind: 'malformed', message: WRITE_ERROR } }
    if (parsed.value.ok) return { kind: 'ok', value: toRecurringBreak(parsed.value.row) }
    if (parsed.value.error === 'booking_conflict') {
      return { kind: 'booking_conflict', bookingIds: parsed.value.booking_ids }
    }
    if (parsed.value.error === 'forbidden') {
      return { kind: 'error', error: { kind: 'forbidden', message: 'Du saknar behörighet.' } }
    }
    return { kind: 'error', error: { kind: 'validation', message: WRITE_ERROR } }
  } catch {
    return { kind: 'error', error: { kind: 'network', message: WRITE_ERROR } }
  }
}

export async function deleteRecurringBreak(id: string): Promise<AdminResult<{ id: string }>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_delete_recurring_break', { p_id: id })
    if (error !== null) return err('network', WRITE_ERROR)

    const parsed = parseWith(deleteRecurringBreakResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    if (parsed.value.ok) return ok({ id })
    if (parsed.value.error === 'forbidden') return err('forbidden', 'Du saknar behörighet.')
    return err('not_found', 'Pausen finns inte längre.')
  } catch {
    return err('network', WRITE_ERROR)
  }
}
