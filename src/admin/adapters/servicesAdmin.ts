// Services admin adapter. Reads/writes the per-barber `services` menu through RLS: the owner manages
// any barber's rows; a barber manages ONLY their own (RLS is the hard backstop — the UI only ever
// passes the acting barber's id). Mirrors `barbersAdmin` exactly (getAdminClient + Zod-parse every
// row/response; failure -> AdminError; never throws to the UI).

import { getAdminClient } from '../adminClient'
import { parseWith, serviceRow, serviceRows } from '../adminSchemas'
import type { AdminBarberId, AdminResult, AdminService, NewService, ServiceEdit } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa tjänster.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'

const COLUMNS = 'id,barber_id,name,price,duration_min,active,sort_order'

/** Map a parsed raw services row into the admin domain type. */
function toService(r: {
  id: string
  barber_id: string
  name: string
  price: number
  duration_min: number
  active: boolean
  sort_order: number
}): AdminService {
  return {
    id: r.id,
    barberId: r.barber_id,
    name: r.name,
    price: r.price,
    durationMin: r.duration_min,
    active: r.active,
    sortOrder: r.sort_order,
  }
}

/** List a barber's services (all, incl. inactive), ordered by sort_order. */
export async function listServices(
  barberId: AdminBarberId,
): Promise<AdminResult<readonly AdminService[]>> {
  try {
    const { data, error } = await getAdminClient()
      .from('services')
      .select(COLUMNS)
      .eq('barber_id', barberId)
      .order('sort_order', { ascending: true })
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(serviceRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map(toService))
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Create a service for a barber (owner any; barber only their own — RLS-enforced). */
export async function createService(
  barberId: AdminBarberId,
  s: NewService,
): Promise<AdminResult<AdminService>> {
  try {
    const { data, error } = await getAdminClient()
      .from('services')
      .insert({
        barber_id: barberId,
        name: s.name,
        price: s.price,
        duration_min: s.durationMin,
        sort_order: s.sortOrder,
      })
      .select(COLUMNS)
      .single()
    if (error !== null || data === null) return mapWriteError(error)

    const parsed = parseWith(serviceRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toService(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Update a service by id (name/price/duration/active/sort_order). */
export async function updateService(
  id: string,
  edit: ServiceEdit,
): Promise<AdminResult<AdminService>> {
  try {
    const { data, error } = await getAdminClient()
      .from('services')
      .update({
        name: edit.name,
        price: edit.price,
        duration_min: edit.durationMin,
        active: edit.active,
        sort_order: edit.sortOrder,
      })
      .eq('id', id)
      .select(COLUMNS)
      .single()
    if (error !== null || data === null) return mapWriteError(error)

    const parsed = parseWith(serviceRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toService(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Delete a service by id. */
export async function deleteService(id: string): Promise<AdminResult<{ id: string }>> {
  try {
    const { error } = await getAdminClient().from('services').delete().eq('id', id)
    if (error !== null) return mapWriteError(error)
    return ok({ id })
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Map a PostgREST write error to an AdminError (RLS denial + check-constraint violation). */
function mapWriteError(error: { code?: string; message?: string } | null): AdminResult<never> {
  if (error !== null) {
    if (error.code === '42501') return err('forbidden', 'Du har inte behörighet för detta.')
    // 23514 = check_violation (name length / price / duration out of range).
    if (error.code === '23514') return err('validation', 'Kontrollera namn, pris och längd.')
  }
  return err('network', WRITE_ERROR)
}
