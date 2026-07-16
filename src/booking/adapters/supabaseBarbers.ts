// The real (Supabase) BarbersPort adapter. `listActive` reads the `barbers` table — ACTIVE rows
// only (the public `barbers_select_anon` RLS policy already restricts anon to active, but we filter
// explicitly too), ordered by `sort_order` then `name` for a stable display order. Each row maps to a
// `RosterBarber`: the booking-grid `Barber` (id/name/ig) PLUS its About copy (role/bio, sv/en) — both
// the booking step-1 grid and the About stylist cards are driven from this one fetch.
//
// Boundary discipline: every row is Zod-parsed (never trust the wire). A malformed row is DROPPED
// (rather than crashing the roster); a transport error resolves to an EMPTY roster, and the caller
// falls back to the constant `BARBERS` so the page still renders. The raw `barbers.id` string is
// narrowed to a `BarberId` exactly here, at the wire boundary.

import { getSupabase } from '../../backend/supabaseClient'
import { barberPhotoRow, parseWith, publicBarberRow } from '../../backend/rpcSchemas'
import type { PublicBarberRow } from '../../backend/rpcSchemas'
import { asBarberId } from '../domain'
import type { BarbersPort, RosterBarber } from '../barbersPort'

const PHOTO_BUCKET = 'barber-photos'

/** Map a parsed raw `barbers` row into a public roster entry (id narrowed here; photo attached later). */
function toRoster(r: PublicBarberRow, photoUrl: string | null): RosterBarber {
  return {
    barber: { id: asBarberId(r.id), name: r.name, ig: r.ig },
    copy: { roleSv: r.role_sv, roleEn: r.role_en, bioSv: r.bio_sv, bioEn: r.bio_en },
    photoUrl,
  }
}

/** barber_id -> resolved public photo URL, from `barber_photos`. Empty on any error (→ placeholders). */
async function loadPhotoUrls(): Promise<ReadonlyMap<string, string>> {
  const map = new Map<string, string>()
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase.from('barber_photos').select('barber_id,storage_path')
    if (error !== null || data === null) return map
    for (const raw of data) {
      const parsed = parseWith(barberPhotoRow, raw)
      if (parsed.ok) {
        const url = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(parsed.value.storage_path)
          .data.publicUrl
        map.set(parsed.value.barber_id, url)
      }
    }
  } catch {
    // Photos are optional — fall through with whatever resolved (possibly empty).
  }
  return map
}

export const supabaseBarbersAdapter: BarbersPort = {
  async listActive(): Promise<readonly RosterBarber[]> {
    try {
      const [rosterRes, photoUrls] = await Promise.all([
        getSupabase()
          .from('barbers')
          .select('id,name,ig,role_sv,role_en,bio_sv,bio_en,active,sort_order')
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        loadPhotoUrls(),
      ])
      if (rosterRes.error !== null || rosterRes.data === null) return []

      // Drop any malformed row rather than failing the whole roster.
      const roster: RosterBarber[] = []
      for (const raw of rosterRes.data) {
        const parsed = parseWith(publicBarberRow, raw)
        if (parsed.ok && parsed.value.active) {
          roster.push(toRoster(parsed.value, photoUrls.get(parsed.value.id) ?? null))
        }
      }
      return roster
    } catch {
      return []
    }
  },
}
