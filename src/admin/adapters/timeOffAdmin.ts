// Time-off admin adapter. Lists / adds / deletes a barber's time-off blocks. RLS scopes a barber to
// their OWN rows (insert/delete with check barber_id = current_barber_id()); the owner may manage any
// barber's. The list is filtered to a barber id and ordered by start date.
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { parseWith, timeOffRow, timeOffRows } from '../adminSchemas'
import type { AdminBarberId, AdminResult, TimeOff } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa ledighet.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'

/** Map a parsed raw time-off row to the domain type. */
function toTimeOff(r: {
  id: string
  barber_id: string
  start_date: string
  end_date: string
  reason: string
}): TimeOff {
  return {
    id: r.id,
    barberId: r.barber_id,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason,
  }
}

/** List a barber's time-off, soonest first. */
export async function listTimeOff(
  barberId: AdminBarberId,
): Promise<AdminResult<readonly TimeOff[]>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_time_off')
      .select('id,barber_id,start_date,end_date,reason')
      .eq('barber_id', barberId)
      .order('start_date', { ascending: true })
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(timeOffRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map(toTimeOff))
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Add a time-off block (single day -> startDate === endDate). RLS denies another barber's row. */
export async function addTimeOff(
  barberId: AdminBarberId,
  startDate: string,
  endDate: string,
  reason: string,
): Promise<AdminResult<TimeOff>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_time_off')
      .insert({ barber_id: barberId, start_date: startDate, end_date: endDate, reason })
      .select('id,barber_id,start_date,end_date,reason')
      .single()
    if (error !== null || data === null) {
      if (error?.code === '42501') return err('forbidden', 'Du kan bara lägga till egen ledighet.')
      if (error?.code === '23514')
        return err('validation', 'Slutdatum måste vara efter startdatum.')
      return err('network', WRITE_ERROR)
    }
    const parsed = parseWith(timeOffRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toTimeOff(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Delete a time-off block by id (RLS scopes to allowed rows; deleting another's affects 0 rows). */
export async function deleteTimeOff(id: string): Promise<AdminResult<true>> {
  try {
    const { error } = await getAdminClient().from('barber_time_off').delete().eq('id', id)
    if (error !== null) {
      if (error.code === '42501') return err('forbidden', 'Du har inte behörighet för detta.')
      return err('network', WRITE_ERROR)
    }
    return ok(true)
  } catch {
    return err('network', WRITE_ERROR)
  }
}
