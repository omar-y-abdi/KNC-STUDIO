// The "backend-ready" seam for the BARBER ROSTER. A `BarbersPort` lists the ACTIVE barbers shown on
// the public site (the booking step-1 grid + the About stylist cards). The one offline implementation
// (the mock) returns the `BARBERS` constant; the Supabase implementation reads the `barbers` table
// (active rows, ordered) — so an owner's add/hide/edit in the admin panel appears on the live site.
//
// Roster rows carry the per-barber About copy too (role + bio, sv/en), because the public About
// stylist cards render them. They live on the SAME row in the DB (`barbers`), so one fetch serves
// both the booking grid (id/name/ig) and the About cards (role/bio). The mock leaves them blank
// here — the About section's own i18n constants are the fallback copy (see `aboutContentPort`).

import type { Barber } from './domain'

/**
 * Per-language stylist copy for one barber (the About card's role + bio). Optional because the mock
 * roster carries none — under the mock the About section falls back to its i18n `stylists` table.
 */
export interface BarberCopy {
  readonly roleSv: string
  readonly roleEn: string
  readonly bioSv: string
  readonly bioEn: string
}

/** A public roster entry: the booking-grid `Barber` plus its (optional) About copy + profile photo. */
export interface RosterBarber {
  readonly barber: Barber
  /** About copy from the DB row; `null` under the mock (i18n constants are the fallback). */
  readonly copy: BarberCopy | null
  /** Resolved public URL of the barber's profile photo, or `null` (→ the placeholder avatar). */
  readonly photoUrl: string | null
}

export interface BarbersPort {
  /**
   * The ACTIVE barbers, in display order. The booking grid + About cards render exactly these (N of
   * them, not necessarily 3). Resolves to the constant roster under the mock; reads `barbers`
   * (active, by `sort_order`) under Supabase.
   */
  listActive(): Promise<readonly RosterBarber[]>
}
