// Walk-in slot-block adapter. A block row says "unavailable on this date between start_min and
// end_min" — the panel's day grid writes one row per 45-min slot (tap = block, tap again = unblock).
// RLS scopes a barber to their OWN rows; the owner may manage any barber's. Blocks are immutable
// (toggle = insert/delete), so the surface is exactly list/add/delete.
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { addSlotBlockResponse, parseWith, slotBlockRows } from '../adminSchemas'
import type { AdminBarberId, AdminResult, AvailabilityMutationOutcome, SlotBlock } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa blockerade tider.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'

const COLUMNS = 'id,barber_id,block_date,start_min,end_min'

/** Map a parsed raw block row to the domain type. */
function toSlotBlock(r: {
  id: string
  barber_id: string
  block_date: string
  start_min: number
  end_min: number
}): SlotBlock {
  return {
    id: r.id,
    barberId: r.barber_id,
    date: r.block_date,
    startMin: r.start_min,
    endMin: r.end_min,
  }
}

/** List a barber's blocks for ONE date (the day grid fetches per selected day), earliest first. */
export async function listSlotBlocks(
  barberId: AdminBarberId,
  dateIso: string,
): Promise<AdminResult<readonly SlotBlock[]>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_slot_blocks')
      .select(COLUMNS)
      .eq('barber_id', barberId)
      .eq('block_date', dateIso)
      .order('start_min', { ascending: true })
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(slotBlockRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map(toSlotBlock))
  } catch {
    return err('network', READ_ERROR)
  }
}

/**
 * Block a window on a date (the day grid passes one 45-min slot). A duplicate tap trips the
 * exact-window unique constraint (23505) — surfaced as `validation` so the UI can just re-list.
 */
export async function addSlotBlock(
  barberId: AdminBarberId,
  dateIso: string,
  startMin: number,
  endMin: number,
  allowExistingBookings = false,
): Promise<AvailabilityMutationOutcome<SlotBlock>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_add_slot_block', {
      p_barber_id: barberId,
      p_block_date: dateIso,
      p_start_min: startMin,
      p_end_min: endMin,
      p_allow_existing_bookings: allowExistingBookings,
    })
    if (error !== null) {
      return { kind: 'error', error: { kind: 'network', message: WRITE_ERROR } }
    }
    const parsed = parseWith(addSlotBlockResponse, data)
    if (!parsed.ok) {
      return { kind: 'error', error: { kind: 'malformed', message: WRITE_ERROR } }
    }
    if (parsed.value.ok) return { kind: 'ok', value: toSlotBlock(parsed.value.row) }
    if (parsed.value.error === 'booking_conflict') {
      return { kind: 'booking_conflict', bookingIds: parsed.value.booking_ids }
    }
    if (parsed.value.error === 'forbidden') {
      return {
        kind: 'error',
        error: { kind: 'forbidden', message: 'Du kan bara blockera egna tider.' },
      }
    }
    if (parsed.value.error === 'duplicate') {
      return {
        kind: 'error',
        error: { kind: 'validation', message: 'Tiden är redan blockerad.' },
      }
    }
    return { kind: 'error', error: { kind: 'validation', message: WRITE_ERROR } }
  } catch {
    return { kind: 'error', error: { kind: 'network', message: WRITE_ERROR } }
  }
}

/** Unblock (delete by id). RLS scopes to allowed rows; deleting another's affects 0 rows. */
export async function deleteSlotBlock(id: string): Promise<AdminResult<true>> {
  try {
    const { error } = await getAdminClient().from('barber_slot_blocks').delete().eq('id', id)
    if (error !== null) {
      if (error.code === '42501') return err('forbidden', 'Du har inte behörighet för detta.')
      return err('network', WRITE_ERROR)
    }
    return ok(true)
  } catch {
    return err('network', WRITE_ERROR)
  }
}
