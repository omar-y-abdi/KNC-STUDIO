// Admin domain types. Kept SEPARATE from the booking domain on purpose:
//   - The owner manages an OPEN set of barber ids (add/remove), so an admin barber id is a plain
//     `AdminBarberId = string` brand — NOT the closed `booking/domain.ts` `BarberId` union (loosening
//     that union is ADMIN_SPEC §5, out of scope here).
//   - These mirror the verified DB row shapes (the Zod schemas in `adminSchemas.ts` are the wire
//     contract that produces them).
//
// Everything is immutable (`readonly`) and every fallible operation returns a `Result` (no throws
// reach the UI — same discipline as the booking adapters' `BookingResult`).

import type { Lang } from '../i18n/index'

/** An open-world barber id (owner can create arbitrary ids matching `^[a-z0-9-]+$`). */
export type AdminBarberId = string

/** The signed-in user's role + (for a barber) their linked barber id. */
export type AdminRole = 'owner' | 'barber'

/** Resolved profile of the signed-in user (from `profiles` via RLS self-read). */
export interface AdminProfile {
  readonly userId: string
  readonly email: string
  readonly role: AdminRole
  /** The barber this account acts as (null for an owner). */
  readonly barberId: AdminBarberId | null
}

/** A barber row as the admin manages it (the full roster row, incl. inactive for the owner). */
export interface AdminBarber {
  readonly id: AdminBarberId
  readonly name: string
  readonly ig: string
  readonly roleSv: string
  readonly roleEn: string
  readonly bioSv: string
  readonly bioEn: string
  readonly active: boolean
  readonly sortOrder: number
}

/** Fields the owner may set when creating a barber. */
export interface NewBarber {
  readonly id: AdminBarberId
  readonly name: string
  readonly ig: string
  readonly roleSv: string
  readonly roleEn: string
  readonly bioSv: string
  readonly bioEn: string
  readonly sortOrder: number
}

/** Fields the owner may edit on an existing barber (id is the immutable key). */
export interface BarberEdit {
  readonly name: string
  readonly ig: string
  readonly roleSv: string
  readonly roleEn: string
  readonly bioSv: string
  readonly bioEn: string
  readonly active: boolean
  readonly sortOrder: number
}

/** JS getDay() weekday: 0=Sun .. 6=Sat. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** One weekday's working state + hours (minutes-from-midnight), matching `barber_schedules`. */
export interface DaySchedule {
  readonly weekday: Weekday
  readonly working: boolean
  /** Minutes from 00:00 (09:00 = 540). */
  readonly startMin: number
  /** Minutes from 00:00 (18:00 = 1080). */
  readonly endMin: number
}

/**
 * The full week as a weekday-indexed list (index === weekday), the unit the editor operates on.
 * Normalized by `toWeekSchedule` to hold all 7 days in order; consumers guard index access
 * (`noUncheckedIndexedAccess`) rather than relying on a fixed-length tuple.
 */
export type WeekSchedule = readonly DaySchedule[]

/** A time-off block (inclusive date range), matching `barber_time_off`. */
export interface TimeOff {
  readonly id: string
  readonly barberId: AdminBarberId
  /** `YYYY-MM-DD`. */
  readonly startDate: string
  /** `YYYY-MM-DD` (inclusive; single day === startDate). */
  readonly endDate: string
  readonly reason: string
}

/** A booking as the admin panel shows it (the full RLS-readable row; owner=all, barber=own). */
export interface AdminBooking {
  readonly id: string
  readonly barberId: AdminBarberId
  readonly serviceName: string
  readonly price: number
  readonly durationMin: number
  /** Appointment start instant. */
  readonly startAt: Date
  /** Appointment end instant. */
  readonly endAt: Date
  readonly customerName: string
  readonly method: 'sms' | 'email'
  readonly phone: string | null
  readonly email: string | null
  readonly lang: Lang
  readonly status: 'confirmed' | 'cancelled'
}

/** One editable About-copy cell (a (key,lang) pair from `about_content`). */
export type AboutKey =
  'eyebrow' | 'heading' | 'intro' | 'galleryTitle' | 'cutsTitle' | 'stylistsTitle' | 'reviewsTitle'

export interface AboutRow {
  readonly key: AboutKey
  readonly lang: Lang
  readonly value: string
}

/** A gallery image row + its resolved public URL (for previews). */
export type GalleryKind = 'salon' | 'cuts'

export interface GalleryImage {
  readonly id: string
  readonly kind: GalleryKind
  readonly storagePath: string
  readonly alt: string
  readonly sortOrder: number
  /** Resolved public Storage URL (built from the path). */
  readonly url: string
}

// --- Result (no throws to the UI) ----------------------------------------------------------------

/** A small typed error: a stable `kind` for branching + a human message for the UI. */
export interface AdminError {
  readonly kind: 'auth' | 'forbidden' | 'not_found' | 'validation' | 'network' | 'malformed'
  readonly message: string
}

/** Result of any fallible admin operation. */
export type AdminResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AdminError }

/** Build an ok result. */
export function ok<T>(value: T): AdminResult<T> {
  return { ok: true, value }
}

/** Build an error result. */
export function err<T>(kind: AdminError['kind'], message: string): AdminResult<T> {
  return { ok: false, error: { kind, message } }
}
