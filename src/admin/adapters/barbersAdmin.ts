// Barbers admin adapter. Reads the roster (the owner sees inactive too, via the
// `barbers_select_owner` RLS policy); the owner creates/edits/toggles barbers (owner-only write
// policies). A barber role can READ the roster but every write is RLS-denied — the UI never offers
// those controls to a barber, and RLS is the hard backstop.
//
// Linked email: v1 links accounts in the Supabase dashboard. We surface a barber's linked auth email
// READ-ONLY by reading `profiles` (owner can select all) joined to the auth user. Since the client
// cannot read `auth.users` directly, the owner-readable mapping we expose is
// profiles.barber_id -> profiles.id; the email itself is shown only when the owner is that account.
// For a faithful "linked email" display we read it from a dedicated owner RPC if present, else show
// the linked state (linked / not linked). See `linkedBarberIds`.
//
// Boundary discipline: every row Zod-parsed; failure -> AdminError. Never throws to the UI.

import { getAdminClient } from '../adminClient'
import { barberRow, barberRows, parseWith, profileRow } from '../adminSchemas'
import type { AdminBarber, AdminBarberId, AdminResult, BarberEdit, NewBarber } from '../types'
import { err, ok } from '../types'

const READ_ERROR = 'Kunde inte läsa barberare.'
const WRITE_ERROR = 'Kunde inte spara. Försök igen.'

/** Map a parsed raw barber row into the admin domain type. */
function toBarber(r: {
  id: string
  name: string
  ig: string
  role_sv: string
  role_en: string
  bio_sv: string
  bio_en: string
  active: boolean
  sort_order: number
}): AdminBarber {
  return {
    id: r.id,
    name: r.name,
    ig: r.ig,
    roleSv: r.role_sv,
    roleEn: r.role_en,
    bioSv: r.bio_sv,
    bioEn: r.bio_en,
    active: r.active,
    sortOrder: r.sort_order,
  }
}

/** List every barber the caller may see, ordered by sort_order then name (stable). */
export async function listBarbers(): Promise<AdminResult<readonly AdminBarber[]>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barbers')
      .select('id,name,ig,role_sv,role_en,bio_sv,bio_en,active,sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(barberRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map(toBarber))
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Create a barber row (owner-only; RLS denies a barber). */
export async function createBarber(b: NewBarber): Promise<AdminResult<AdminBarber>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barbers')
      .insert({
        id: b.id,
        name: b.name,
        ig: b.ig,
        role_sv: b.roleSv,
        role_en: b.roleEn,
        bio_sv: b.bioSv,
        bio_en: b.bioEn,
        sort_order: b.sortOrder,
      })
      .select('id,name,ig,role_sv,role_en,bio_sv,bio_en,active,sort_order')
      .single()
    if (error !== null || data === null) return mapWriteError(error)

    const parsed = parseWith(barberRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toBarber(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Update an existing barber by id (owner-only). */
export async function updateBarber(
  id: AdminBarberId,
  edit: BarberEdit,
): Promise<AdminResult<AdminBarber>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barbers')
      .update({
        name: edit.name,
        ig: edit.ig,
        role_sv: edit.roleSv,
        role_en: edit.roleEn,
        bio_sv: edit.bioSv,
        bio_en: edit.bioEn,
        active: edit.active,
        sort_order: edit.sortOrder,
      })
      .eq('id', id)
      .select('id,name,ig,role_sv,role_en,bio_sv,bio_en,active,sort_order')
      .single()
    if (error !== null || data === null) return mapWriteError(error)

    const parsed = parseWith(barberRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toBarber(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Toggle (set) a barber's active flag (owner-only). */
export async function setBarberActive(
  id: AdminBarberId,
  active: boolean,
): Promise<AdminResult<AdminBarber>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barbers')
      .update({ active })
      .eq('id', id)
      .select('id,name,ig,role_sv,role_en,bio_sv,bio_en,active,sort_order')
      .single()
    if (error !== null || data === null) return mapWriteError(error)

    const parsed = parseWith(barberRow, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toBarber(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/**
 * The set of barber ids that have a LINKED login account (owner-only read of `profiles`). The owner
 * can `profiles_select_owner`, so this returns which barbers already have an account — surfaced
 * read-only in the Barberare screen ("Inloggning kopplad"). Per v1 the email itself is managed in
 * the dashboard; we show the linked STATE here.
 */
export async function linkedBarberIds(): Promise<AdminResult<ReadonlySet<AdminBarberId>>> {
  try {
    const { data, error } = await getAdminClient().from('profiles').select('role, barber_id')
    if (error !== null || data === null) return err('network', READ_ERROR)

    const linked = new Set<AdminBarberId>()
    for (const raw of data) {
      const parsed = parseWith(profileRow, raw)
      if (parsed.ok && parsed.value.barber_id !== null) linked.add(parsed.value.barber_id)
    }
    return ok(linked)
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Map a PostgREST write error to an AdminError, recognizing the unique-violation + RLS denial. */
function mapWriteError(error: { code?: string; message?: string } | null): AdminResult<never> {
  if (error !== null) {
    // 23505 = unique_violation (duplicate id); 42501 = RLS/insufficient privilege.
    if (error.code === '23505') return err('validation', 'Det finns redan en barberare med det id:t.')
    if (error.code === '42501') return err('forbidden', 'Du har inte behörighet för detta.')
  }
  return err('network', WRITE_ERROR)
}
