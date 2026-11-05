// Services admin adapter. Reads/writes the per-barber `services` menu through RLS: the owner manages
// any barber's rows; a barber manages ONLY their own (RLS is the hard backstop — the UI only ever
// passes the acting barber's id). Mirrors `barbersAdmin` exactly (getAdminClient + Zod-parse every
// row/response; failure -> AdminError; never throws to the UI).

import { getAdminClient } from '../adminClient'
import {
  createServiceResponse,
  deleteServiceResponse,
  parseWith,
  reorderServiceResponse,
  serviceRow,
  serviceRows,
} from '../adminSchemas'
import type { AdminBarberId, AdminResult, AdminService, NewService, ServiceEdit } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa tjänster.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'

const COLUMNS = 'id,barber_id,name,price,duration_min,active,sort_order,available_weekdays'

/** Map a parsed raw services row into the admin domain type. */
function toService(r: {
  id: string
  barber_id: string
  name: string
  price: number
  duration_min: number
  active: boolean
  sort_order: number
  available_weekdays: AdminService['availableWeekdays']
}): AdminService {
  return {
    id: r.id,
    barberId: r.barber_id,
    name: r.name,
    price: r.price,
    durationMin: r.duration_min,
    active: r.active,
    sortOrder: r.sort_order,
    availableWeekdays: r.available_weekdays,
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

/** Create a service at the next per-barber position through the authorized ordering RPC. */
export async function createService(
  barberId: AdminBarberId,
  s: NewService,
): Promise<AdminResult<AdminService>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_create_service', {
      p_barber_id: barberId,
      p_name: s.name,
      p_price: s.price,
      p_duration_min: s.durationMin,
      p_active: true,
      p_available_weekdays: s.availableWeekdays,
    })
    if (error !== null) return mapWriteError(error)

    const parsed = parseWith(createServiceResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    if (!parsed.value.ok) return mapMutationError(parsed.value.error)
    return ok(toService(parsed.value.row))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Update a service by id, leaving its server-owned sort_order untouched. */
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
        available_weekdays: edit.availableWeekdays,
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

/** Delete a service by id and compact its barber's order in the authorized RPC transaction. */
export async function deleteService(id: string): Promise<AdminResult<{ id: string }>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_delete_service', { p_id: id })
    if (error !== null) return mapWriteError(error)
    const parsed = parseWith(deleteServiceResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    if (!parsed.value.ok) return mapMutationError(parsed.value.error)
    return ok({ id })
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Move one service by one position through the atomic per-barber ordering RPC. */
export async function reorderService(
  barberId: AdminBarberId,
  id: string,
  direction: -1 | 1,
): Promise<AdminResult<readonly AdminService[]>> {
  try {
    const { data, error } = await getAdminClient().rpc('admin_reorder_service', {
      p_barber_id: barberId,
      p_service_id: id,
      p_direction: direction,
    })
    if (error !== null) return mapWriteError(error)
    const parsed = parseWith(reorderServiceResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    if (!parsed.value.ok) return mapMutationError(parsed.value.error)
    return ok(parsed.value.services.map(toService))
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

function mapMutationError(
  error: 'forbidden' | 'not_found' | 'invalid' | 'duplicate',
): AdminResult<never> {
  if (error === 'forbidden') return err('forbidden', 'Du har inte behörighet för detta.')
  if (error === 'not_found') return err('not_found', 'Tjänsten finns inte.')
  if (error === 'duplicate') return err('validation', 'Tjänsteordningen kunde inte sparas.')
  return err('validation', 'Kontrollera namn, pris och längd.')
}
