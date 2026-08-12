// Wire-boundary Zod schemas for the admin data layer — the SAME discipline as
// `backend/rpcSchemas.ts`: PostgREST/RPC `data` is untyped JSON, so every row and RPC response is
// validated before the adapter trusts a field. These schemas ARE the contract; a malformed payload
// fails parsing and the adapter maps it to an `AdminError` (never throws to the UI).
//
// Naming: schemas validate the RAW DB shape (snake_case columns). The adapters map a parsed raw row
// into the camelCase admin domain type (`types.ts`). We re-export `parseWith` from the backend so
// there is a single parse helper across the app.

import { z } from 'zod'

export { parseWith } from '../backend/rpcSchemas'
export type { Parsed } from '../backend/rpcSchemas'

/** ISO-8601 timestamp WITH offset (how PostgREST serializes `timestamptz`). */
const isoTimestamp = z.string().datetime({ offset: true })

/** `YYYY-MM-DD` date (PostgREST serializes a `date` column as this). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

const lang = z.enum(['sv', 'en'])

// --- profiles (self-read) ------------------------------------------------------------------------

export const profileRow = z.object({
  role: z.enum(['owner', 'barber']),
  barber_id: z.string().nullable(),
  must_change_password: z.boolean(),
})
export type ProfileRow = z.infer<typeof profileRow>

// --- barbers -------------------------------------------------------------------------------------

export const barberRow = z.object({
  id: z.string(),
  name: z.string(),
  ig: z.string(),
  role_sv: z.string(),
  role_en: z.string(),
  bio_sv: z.string(),
  bio_en: z.string(),
  active: z.boolean(),
  sort_order: z.number(),
})
export type BarberRow = z.infer<typeof barberRow>
export const barberRows = z.array(barberRow)

// --- barber_schedules ----------------------------------------------------------------------------

export const scheduleRow = z.object({
  barber_id: z.string(),
  // Literal union so the inferred `weekday` is exactly `0|1|…|6` (structurally `Weekday`), letting
  // the adapter map a parsed row straight into a `DaySchedule` with no cast (cf. `ratingInt`).
  weekday: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  working: z.boolean(),
  start_min: z.number().int().min(0).max(1440),
  end_min: z.number().int().min(0).max(1440),
})
export type ScheduleRow = z.infer<typeof scheduleRow>
export const scheduleRows = z.array(scheduleRow)

// --- barber_time_off -----------------------------------------------------------------------------

export const timeOffRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  start_date: isoDate,
  end_date: isoDate,
  reason: z.string(),
})
export type TimeOffRow = z.infer<typeof timeOffRow>
export const timeOffRows = z.array(timeOffRow)

// --- barber_slot_blocks --------------------------------------------------------------------------

export const slotBlockRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  block_date: isoDate,
  start_min: z.number().int().min(0).max(1440),
  end_min: z.number().int().min(0).max(1440),
})
export type SlotBlockRow = z.infer<typeof slotBlockRow>
export const slotBlockRows = z.array(slotBlockRow)

// --- services (admin CRUD) -----------------------------------------------------------------------
// A per-barber service-menu row (owner=all, barber=own). Maps to `AdminService` in types.ts.

export const serviceRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  name: z.string(),
  price: z.number(),
  duration_min: z.number(),
  active: z.boolean(),
  sort_order: z.number(),
})
export type ServiceRow = z.infer<typeof serviceRow>
export const serviceRows = z.array(serviceRow)

// --- site_content / site_settings (Task 2 §2) ----------------------------------------------------

export const siteContentRow = z.object({
  key: z.string(),
  lang,
  value: z.string(),
})
export type SiteContentRowT = z.infer<typeof siteContentRow>
export const siteContentRows = z.array(siteContentRow)

export const siteSettingRow = z.object({
  key: z.string(),
  value: z.string(),
})
export type SiteSettingRowT = z.infer<typeof siteSettingRow>
export const siteSettingRows = z.array(siteSettingRow)

// --- email_templates -----------------------------------------------------------------------------

export const emailTemplateName = z.enum([
  'customer_confirmation',
  'barber_confirmation',
  'customer_cancellation',
  'barber_cancellation',
  'customer_reminder',
  'auth_recovery',
  'auth_email_change',
  'auth_invite',
])

export const emailTemplateRow = z.object({
  template: emailTemplateName,
  lang,
  subject: z.string(),
  preheader: z.string(),
  title: z.string(),
  intro: z.string(),
  section_title: z.string().nullable(),
  note: z.string(),
  cta_label: z.string(),
  contact_lead: z.string().nullable(),
})
export type EmailTemplateRowT = z.infer<typeof emailTemplateRow>
export const emailTemplateRows = z.array(emailTemplateRow)

// --- barber_photos (Task 2 §3) -------------------------------------------------------------------

export const barberPhotoRowT = z.object({
  barber_id: z.string(),
  storage_path: z.string(),
})
export type BarberPhotoRowT = z.infer<typeof barberPhotoRowT>

// --- about_content -------------------------------------------------------------------------------

export const aboutRow = z.object({
  key: z.enum([
    'eyebrow',
    'heading',
    'intro',
    'galleryTitle',
    'cutsTitle',
    'stylistsTitle',
    'reviewsTitle',
  ]),
  lang,
  value: z.string(),
})
export type AboutContentRow = z.infer<typeof aboutRow>
export const aboutRows = z.array(aboutRow)

// --- gallery_images ------------------------------------------------------------------------------

export const galleryRow = z.object({
  id: z.string(),
  kind: z.enum(['salon', 'cuts']),
  storage_path: z.string(),
  alt: z.string(),
  sort_order: z.number(),
})
export type GalleryRow = z.infer<typeof galleryRow>
export const galleryRows = z.array(galleryRow)

// --- bookings (admin read) -----------------------------------------------------------------------
// The full RLS-readable booking row (owner=all, barber=own). Contact is real PII the panel shows to
// the owning barber; nullable phone/email per the method.

export const adminBookingRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  service_name: z.string(),
  price: z.number(),
  duration_min: z.number(),
  start_at: isoTimestamp,
  end_at: isoTimestamp,
  customer_name: z.string(),
  method: z.enum(['phone', 'email', 'walkin']),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  lang,
  status: z.enum(['confirmed', 'cancelled']),
})
export type AdminBookingRow = z.infer<typeof adminBookingRow>
export const adminBookingRows = z.array(adminBookingRow)

// --- admin_create_booking RPC (Task 2 §4) --------------------------------------------------------
// {ok:true, booking:{...}} | {ok:false, error:'forbidden'|'invalid'|'slot_taken'}

const adminCreateOk = z.object({ ok: z.literal(true) })
const adminCreateErr = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'invalid', 'slot_taken']),
})
export const adminCreateBookingResponse = z.discriminatedUnion('ok', [
  adminCreateOk,
  adminCreateErr,
])
export type AdminCreateBookingResponse = z.infer<typeof adminCreateBookingResponse>

// --- admin_cancel_booking RPC --------------------------------------------------------------------
// {ok:true, booking:{...}} | {ok:false, error:'forbidden'|'not_found'}

const cancelOk = z.object({
  ok: z.literal(true),
  booking: z.object({
    id: z.string(),
    barber_id: z.string(),
    service_name: z.string(),
    start_at: isoTimestamp,
    status: z.literal('cancelled'),
    cancelled_at: isoTimestamp,
  }),
})
const cancelErr = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'not_found']),
})
export const adminCancelResponse = z.discriminatedUnion('ok', [cancelOk, cancelErr])
export type AdminCancelResponse = z.infer<typeof adminCancelResponse>

// --- admin_delete_barber RPC ---------------------------------------------------------------------
// Owner-only hard delete. With `p_purge_bookings=false` the RPC REFUSES while the barber still has
// bookings and echoes the counts so the UI can confirm; `true` deletes the bookings too and reports
// how many. `ok` alone can't discriminate the two `ok:false` shapes, so this is a plain `z.union`
// (fail-closed: a `has_bookings` payload missing the counts matches no member and fails parsing).
//   {ok:true, deleted_bookings:n}
// | {ok:false, error:'has_bookings', count, past, upcoming}
// | {ok:false, error:'forbidden'|'not_found'}
const deleteBarberOk = z.object({
  ok: z.literal(true),
  deleted_bookings: z.number().int().nonnegative(),
})
const deleteBarberHasBookings = z.object({
  ok: z.literal(false),
  error: z.literal('has_bookings'),
  count: z.number().int().nonnegative(),
  past: z.number().int().nonnegative(),
  upcoming: z.number().int().nonnegative(),
})
const deleteBarberDenied = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'not_found']),
})
export const adminDeleteBarberResponse = z.union([
  deleteBarberOk,
  deleteBarberHasBookings,
  deleteBarberDenied,
])
export type AdminDeleteBarberResponse = z.infer<typeof adminDeleteBarberResponse>

// --- admin_delete_bookings RPC -------------------------------------------------------------------
// Bulk hard delete of bookings by id (owner any barber; a barber only their own). Intended for
// past/cancelled rows: REFUSES (`has_upcoming`) if any id is still a live upcoming appointment, and
// rejects an empty selection (`empty`). Reports how many rows were deleted.
// {ok:true, count:n} | {ok:false, error:'empty'|'forbidden'|'has_upcoming'}
const deleteBookingsOk = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
})
const deleteBookingsErr = z.object({
  ok: z.literal(false),
  error: z.enum(['empty', 'forbidden', 'has_upcoming']),
})
export const adminDeleteBookingsResponse = z.discriminatedUnion('ok', [
  deleteBookingsOk,
  deleteBookingsErr,
])
export type AdminDeleteBookingsResponse = z.infer<typeof adminDeleteBookingsResponse>

// --- admin_purge_history RPC ---------------------------------------------------------------------
// Owner-only: delete ALL past/cancelled history in one shot, reporting the row count removed.
// {ok:true, count:n} | {ok:false, error:'forbidden'}
const purgeHistoryOk = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
})
const purgeHistoryErr = z.object({
  ok: z.literal(false),
  error: z.literal('forbidden'),
})
export const adminPurgeHistoryResponse = z.discriminatedUnion('ok', [
  purgeHistoryOk,
  purgeHistoryErr,
])
export type AdminPurgeHistoryResponse = z.infer<typeof adminPurgeHistoryResponse>

// --- available_slots RPC -------------------------------------------------------------------------
// `setof text` -> PostgREST returns an array of `HH:MM` strings.

export const availableSlotsResponse = z.array(z.string())
