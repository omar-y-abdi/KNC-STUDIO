// Wire-boundary Zod schemas for the admin data layer — the SAME discipline as
// `backend/rpcSchemas.ts`: PostgREST/RPC `data` is untyped JSON, so every row and RPC response is
// validated before the adapter trusts a field. These schemas ARE the contract; a malformed payload
// fails parsing and the adapter maps it to an `AdminError` (never throws to the UI).
//
// Naming: schemas validate the RAW DB shape (snake_case columns). The adapters map a parsed raw row
// into the camelCase admin domain type (`types.ts`). We re-export `parseWith` from the backend so
// there is a single parse helper across the app.

import { z } from 'zod'
import { ISO_TIMESTAMP } from '../../shared/iso-timestamp'
import { EMAIL_SEND_FAILURE_CODES, EMAIL_SEND_KINDS } from '../../shared/email-send-log'

export { parseWith } from '../backend/rpcSchemas'

/** ISO-8601 timestamp WITH offset (how PostgREST serializes `timestamptz`). */
const isoTimestamp = z.string().regex(ISO_TIMESTAMP, 'Invalid datetime')

/** `YYYY-MM-DD` date (PostgREST serializes a `date` column as this). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const bookingDurationMin = z.number().finite().int().min(1).max(600)
const serviceDurationMin = z.number().finite().int().min(5).max(600)
const sortOrder = z.number().finite().refine(Number.isInteger).min(0)

const lang = z.enum(['sv', 'en'])
const weekday = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
])

const canonicalWeekdays = z
  .array(weekday)
  .min(1)
  .superRefine((weekdays, context) => {
    for (let index = 1; index < weekdays.length; index += 1) {
      const previous = weekdays[index - 1]
      const current = weekdays[index]
      if (previous !== undefined && current !== undefined && previous >= current) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected sorted, unique weekdays',
        })
        return
      }
    }
  })

// --- profiles (self-read) ------------------------------------------------------------------------

export const profileRow = z.object({
  role: z.enum(['owner', 'barber']),
  barber_id: z.string().nullable(),
  must_change_password: z.boolean(),
  account_enabled: z.boolean(),
})

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
export const barberRows = z.array(barberRow)

// --- barber_schedules ----------------------------------------------------------------------------

const scheduleRow = z.object({
  barber_id: z.string(),
  // Literal union so the inferred `weekday` is exactly `0|1|…|6` (structurally `Weekday`), letting
  // the adapter map a parsed row straight into a `DaySchedule` with no cast (cf. `ratingInt`).
  weekday,
  working: z.boolean(),
  start_min: z.number().int().min(0).max(1440),
  end_min: z.number().int().min(0).max(1440),
})
export const scheduleRows = z.array(scheduleRow)

const availabilityMutationConflict = z.object({
  ok: z.literal(false),
  error: z.literal('booking_conflict'),
  booking_ids: z.array(z.guid()),
})
const availabilityMutationDenied = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'not_found', 'invalid', 'duplicate']),
})
export const saveWeekResponse = z.union([
  z.object({ ok: z.literal(true) }),
  availabilityMutationConflict,
  availabilityMutationDenied,
])

// --- barber_time_off -----------------------------------------------------------------------------

const timeOffRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  start_date: isoDate,
  end_date: isoDate,
  reason: z.string(),
})
export const timeOffRows = z.array(timeOffRow)
export const addTimeOffResponse = z.union([
  z.object({ ok: z.literal(true), row: timeOffRow }),
  availabilityMutationConflict,
  availabilityMutationDenied,
])

// --- barber_slot_blocks --------------------------------------------------------------------------

const slotBlockRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  block_date: isoDate,
  start_min: z.number().int().min(0).max(1440),
  end_min: z.number().int().min(0).max(1440),
})
export const slotBlockRows = z.array(slotBlockRow)
export const addSlotBlockResponse = z.union([
  z.object({ ok: z.literal(true), row: slotBlockRow }),
  availabilityMutationConflict,
  availabilityMutationDenied,
])

// --- barber_recurring_breaks --------------------------------------------------------------------

const recurringBreakRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  weekday,
  start_min: z.number().int().min(540).max(1065),
  end_min: z.number().int().min(555).max(1080),
})
export const recurringBreakRows = z.array(recurringBreakRow)
export const addRecurringBreakResponse = z.union([
  z.object({ ok: z.literal(true), row: recurringBreakRow }),
  availabilityMutationConflict,
  availabilityMutationDenied,
])
export const deleteRecurringBreakResponse = z.union([
  z.object({ ok: z.literal(true) }),
  availabilityMutationDenied,
])

// --- services (admin CRUD) -----------------------------------------------------------------------
// A per-barber service-menu row (owner=all, barber=own). Maps to `AdminService` in types.ts.

export const serviceRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  name: z.string(),
  price: z.number().finite().min(0).max(100000),
  duration_min: serviceDurationMin,
  active: z.boolean(),
  sort_order: sortOrder,
  available_weekdays: canonicalWeekdays,
})
export type ServiceRow = z.infer<typeof serviceRow>
export const serviceRows = z.array(serviceRow)

const serviceMutationError = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'not_found', 'invalid', 'duplicate']),
})
export const createServiceResponse = z.union([
  z.object({ ok: z.literal(true), row: serviceRow }),
  serviceMutationError,
])
export const deleteServiceResponse = z.union([
  z.object({ ok: z.literal(true) }),
  serviceMutationError,
])
export const reorderServiceResponse = z.union([
  z.object({ ok: z.literal(true), services: serviceRows }),
  serviceMutationError,
])

// --- site_settings (Task 2 §2) ----------------------------------------------------

const siteSettingRow = z.object({
  key: z.string().min(1).max(40),
  value: z.string().max(500),
})
export const siteSettingRows = z.array(siteSettingRow)

export const failedBookingEmailDeliveryRow = z.object({
  id: z.guid(),
  booking_id: z.guid(),
  event: z.enum(['booking_confirmed', 'booking_cancelled']),
  attempt_count: z.number().refine(Number.isInteger).nonnegative(),
  last_error_code: z
    .enum([
      'not_configured',
      'send_failed',
      'send_failed_transient',
      'send_failed_permanent',
      'message_build_failed',
    ])
    .nullable(),
  failed_at: isoTimestamp.nullable(),
  sent_kinds: z.array(z.enum(['customer', 'barber'])),
  customer_name: z.string().min(1),
  customer_email: z.string().nullable(),
  customer_phone: z.string().nullable(),
  booking_start_at: isoTimestamp,
  barber_name: z.string().min(1),
  barber_email: z.string().nullable(),
})
export const failedBookingEmailDeliveryRows = z.array(failedBookingEmailDeliveryRow)
export const retryFailedBookingEmailDeliveryResponse = z.object({ ok: z.boolean() })
export const discardFailedBookingEmailDeliveryResponse = z.object({ ok: z.boolean() })

/** One `admin_list_email_send_log` entry; a failed row always carries its reason. */
export const emailSendLogEntryRow = z
  .object({
    id: z.string().uuid(),
    created_at: isoTimestamp,
    last_attempt_at: isoTimestamp,
    kind: z.enum(EMAIL_SEND_KINDS),
    recipient: z.string().min(1),
    subject: z.string().min(1),
    status: z.enum(['sent', 'failed']),
    error_code: z.enum(EMAIL_SEND_FAILURE_CODES).nullable(),
    booking_id: z.string().uuid().nullable(),
    attempt_count: z.number().int().positive(),
  })
  .refine((row) => (row.status === 'failed') === (row.error_code !== null))
export const emailSendLogPage = z.object({
  entries: z.array(emailSendLogEntryRow),
  has_more: z.boolean(),
})
/** `admin_get_email_send_log_entry`: null once the 30-day purge removed the copy. */
export const emailSendLogCopy = z
  .object({
    id: z.string().uuid(),
    subject: z.string(),
    html: z.string(),
    text_body: z.string(),
  })
  .nullable()

// --- barber_photos (Task 2 §3) -------------------------------------------------------------------

export const barberPhotoRowT = z.object({
  barber_id: z.string(),
  storage_path: z.string(),
})

export const uploadBarberPhotoResponse = z
  .object({
    ok: z.literal(true),
    kind: z.literal('barber_photo'),
    row: barberPhotoRowT,
    path: z.string().min(1),
    publicUrl: z.string().url(),
  })
  .refine((response) => response.path === response.row.storage_path)

export const imageDeleteResponse = z.object({
  ok: z.literal(true),
  pending: z.boolean(),
})

// --- bookings (admin read) -----------------------------------------------------------------------
// The full RLS-readable booking row (owner=all, barber=own). Contact is real PII the panel shows to
// the owning barber; nullable phone/email per the method.

const adminBookingRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  service_name: z.string(),
  price: z.number().finite().min(0).max(100000),
  duration_min: bookingDurationMin,
  start_at: isoTimestamp,
  end_at: isoTimestamp,
  customer_name: z.string(),
  method: z.enum(['phone', 'email', 'walkin']),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  lang,
  status: z.enum(['confirmed', 'cancelled']),
})
export const adminBookingRows = z.array(adminBookingRow)

// --- admin_create_booking RPC (Task 2 §4) --------------------------------------------------------
// {ok:true, booking:{...}} | typed authorization/availability/validation error.

const adminCreateOk = z.object({ ok: z.literal(true) })
const adminCreateErr = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'invalid', 'slot_taken', 'outside_hours']),
})
export const adminCreateBookingResponse = z.discriminatedUnion('ok', [
  adminCreateOk,
  adminCreateErr,
])

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
  deleted_bookings: z.number().refine(Number.isInteger).nonnegative(),
  auth_cleanup_pending: z.boolean(),
})
const deleteBarberHasBookings = z.object({
  ok: z.literal(false),
  error: z.literal('has_bookings'),
  count: z.number().refine(Number.isInteger).nonnegative(),
  past: z.number().refine(Number.isInteger).nonnegative(),
  upcoming: z.number().refine(Number.isInteger).nonnegative(),
})
const deleteBarberDenied = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'not_found']),
})
const deleteBarberHasUpcoming = z.object({
  ok: z.literal(false),
  error: z.literal('has_upcoming'),
  count: z.number().refine(Number.isInteger).nonnegative(),
  past: z.number().refine(Number.isInteger).nonnegative(),
  upcoming: z.number().refine(Number.isInteger).positive(),
})
const deleteBarberExternalCleanup = z.object({
  ok: z.literal(false),
  error: z.literal('external_cleanup_pending'),
  calendar_events: z.number().refine(Number.isInteger).nonnegative(),
})
const deleteBarberDeliveryPending = z.object({
  ok: z.literal(false),
  error: z.literal('delivery_pending'),
})
export const adminDeleteBarberResponse = z.union([
  deleteBarberOk,
  deleteBarberHasBookings,
  deleteBarberHasUpcoming,
  deleteBarberExternalCleanup,
  deleteBarberDeliveryPending,
  deleteBarberDenied,
])

// --- admin_delete_bookings RPC -------------------------------------------------------------------
// Bulk hard delete of bookings by id (owner any barber; a barber only their own). Intended for
// past/cancelled rows: REFUSES (`has_upcoming`) if any id is still a live upcoming appointment, and
// rejects an empty selection (`empty`). Reports how many rows were deleted.
// {ok:true, count:n} | {ok:false, error:'empty'|'forbidden'|'has_upcoming'|'delivery_pending'}
const deleteBookingsOk = z.object({
  ok: z.literal(true),
  count: z.number().refine(Number.isInteger).nonnegative(),
})
const deleteBookingsErr = z.object({
  ok: z.literal(false),
  error: z.enum(['empty', 'forbidden', 'has_upcoming', 'delivery_pending']),
})
export const adminDeleteBookingsResponse = z.discriminatedUnion('ok', [
  deleteBookingsOk,
  deleteBookingsErr,
])

// --- admin_purge_history RPC ---------------------------------------------------------------------
// Owner-only: delete ALL past/cancelled history in one shot, reporting the row count removed.
// {ok:true, count:n} | {ok:false, error:'forbidden'|'delivery_pending'}
const purgeHistoryOk = z.object({
  ok: z.literal(true),
  count: z.number().refine(Number.isInteger).nonnegative(),
})
const purgeHistoryErr = z.object({
  ok: z.literal(false),
  error: z.enum(['forbidden', 'delivery_pending']),
})
export const adminPurgeHistoryResponse = z.discriminatedUnion('ok', [
  purgeHistoryOk,
  purgeHistoryErr,
])

// --- available_slots RPC -------------------------------------------------------------------------
// `setof text` -> PostgREST returns an array of `HH:MM` strings.

export const availableSlotsResponse = z.array(z.string())
