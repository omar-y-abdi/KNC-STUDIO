// Walk-in slot-block adapter. A block row says "unavailable on this date between start_min and
// end_min" — the panel's day grid writes one row per 45-min slot (tap = block, tap again = unblock).
// RLS scopes a barber to their OWN rows; the owner may manage any barber's. Blocks are immutable
// (toggle = insert/delete), so the surface is exactly list/add/delete.
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { parseWith, slotBlockRow, slotBlockRows } from '../adminSchemas'
import type { AdminBarberId, AdminResult, SlotBlock } from '../types'
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
): Promise<AdminResult<SlotBlock>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_slot_blocks')
      .insert({ barber_id: barberId, block_date: dateIso, start_min: startMin, end_min: endMin })
      .select(COLUMNS)
      .single()
    if (error !== null || data === null) {
      if (error?.code === '42501') return err('forbidden', 'Du kan bara blockera egna tider.')
      if (error?.code === '23505') return err('validation', 'Tiden är redan blockerad.')
      return err('network', WRITE_ERROR)
    }
    const parsed = parseWith(slotBlockRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toSlotBlock(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
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
