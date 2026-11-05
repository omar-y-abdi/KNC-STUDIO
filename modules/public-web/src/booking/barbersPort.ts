// `BarbersPort` lists active barbers shown in booking + About. Production resolves the database
// catalog; unconfigured mode is empty, so an owner's add/hide/edit remains authoritative.
//
// Roster rows carry the per-barber About copy too (role + bio, sv/en), because the public About
// stylist cards render them. They live on the SAME row in the DB (`barbers`), so one fetch serves
// both the booking grid (id/name/ig) and the About cards (role/bio). The mock leaves them blank
// here — the About section's own i18n constants are the fallback copy (see `aboutContentPort`).

import type { Barber } from './domain'

/**
 * Per-language stylist copy for one barber (the About card's role + bio).
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
  /** About copy from the DB row; null only when a test adapter omits it. */
  readonly copy: BarberCopy | null
  /** Resolved public URL of the barber's profile photo, or `null` (→ the placeholder avatar). */
  readonly photoUrl: string | null
}

export interface BarbersPort {
  /**
   * The ACTIVE barbers, in display order. The booking grid + About cards render exactly these (N of
   * them, not necessarily 3). Reads database rows in production; unconfigured mode is empty.
   */
  listActive(): Promise<readonly RosterBarber[]>
}
