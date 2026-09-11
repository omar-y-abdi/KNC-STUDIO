// Wire-boundary parsing for the Supabase RPC responses. The PostgREST `data` is untyped JSON, so
// every response is validated with a small Zod schema before the adapter trusts a single field —
// the schemas ARE the contract (BACKEND_SPEC §4 / the verified prompt). A malformed/unexpected
// payload fails parsing and the adapter maps it to a domain error rather than crashing the UI.
//
// All times are ISO-8601 strings with an offset (e.g. `2031-09-09T10:30:00+00:00`); the adapters
// turn them into `Date`s. No effects here — pure schemas + Result-shaped parse helpers.

import { z } from 'zod'

// --- shared --------------------------------------------------------------------------------------

/** ISO-8601 timestamp WITH offset, exactly how PostgREST serializes `timestamptz`. */
const isoTimestamp = z.string().datetime({ offset: true })
const bookingDurationMin = z.number().finite().int().min(1).max(600)
const serviceDurationMin = z.number().finite().int().min(5).max(600)
const sortOrder = z.number().finite().int().min(0)

/**
 * A 1..5 rating. Modeled as a literal union so the INFERRED type is exactly `1 | 2 | 3 | 4 | 5`,
 * structurally identical to the domain `Rating` — a parsed value drops straight into a `Review`
 * with no cast and no widening to `number`.
 */
const ratingInt = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])

const canonicalWeekdays = z
  .array(z.number().int().min(0).max(6))
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

// --- create_booking ------------------------------------------------------------------------------
// The adapter only branches on `ok` — the confirmation links are built from the LOCAL booking, and
// the echoed row is never read. Validating only the discriminant means a drift in the echoed fields
// can never fail the parse AFTER the row was inserted (which would show an error for a booking that
// actually succeeded — the worst possible false negative).

const createBookingOk = z.object({ ok: z.literal(true) })

/** Booking error codes. The create_booking RPC produces `invalid_time` / `invalid_contact` /
 * `outside_hours` (off day, time-off, or outside working hours) / `slot_taken` / `invalid`; the
 * `submit-booking` edge-fn gateway adds `failed_challenge` (Turnstile) + `rate_limited` (IP/phone
 * backstop). All arrive as HTTP 200 `{ok:false,error}` so the adapter can map each to a message. */
const createBookingErr = z.object({
  ok: z.literal(false),
  error: z.enum([
    'invalid_time',
    'invalid_contact',
    'outside_hours',
    'slot_taken',
    'invalid',
    'failed_challenge',
    'rate_limited',
  ]),
})

export const createBookingResponse = z.discriminatedUnion('ok', [createBookingOk, createBookingErr])
export type CreateBookingResponse = z.infer<typeof createBookingResponse>

// --- customer booking access ---------------------------------------------------------------------
// Customer history and cancellation require possession of a short-lived, one-time email link. The
// browser exchanges that link for an opaque session token; the gateway hashes tokens before calling the
// service-role-only RPCs.

const customerAccessRequestOk = z.object({ ok: z.literal(true) })
const customerAccessRequestErr = z.object({
  ok: z.literal(false),
  error: z.enum(['failed_challenge', 'rate_limited']),
})
export const customerAccessRequestResponse = z.discriminatedUnion('ok', [
  customerAccessRequestOk,
  customerAccessRequestErr,
])

const customerSessionProof = z.string().regex(/^[0-9a-f]{64}$/)
/** Optional post-booking access is parsed separately so its failure never undoes booking success. */
export const bookingReceiptResponse = z.object({
  receipt_proof: customerSessionProof,
  booking: z.object({ id: z.string().uuid() }),
})
const customerAccessExchangeOk = z.object({
  ok: z.literal(true),
  session_proof: customerSessionProof,
})
const customerAccessExchangeErr = z.object({ ok: z.literal(false), error: z.literal('invalid') })
export const customerAccessExchangeResponse = z.discriminatedUnion('ok', [
  customerAccessExchangeOk,
  customerAccessExchangeErr,
])

// --- list_customer_bookings_with_access ----------------------------------------------------------

const myBookingRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  barber_name: z.string().optional(),
  service_name: z.string(),
  price: z.number().finite().min(0).max(100000),
  duration_min: bookingDurationMin,
  start_at: isoTimestamp,
})

const listCustomerBookingsOk = z.object({
  ok: z.literal(true),
  authority: z.literal('verified').default('verified'),
  session_proof: customerSessionProof,
  receipt_proof: customerSessionProof.optional(),
  name: z.string().optional(),
  phone: z.string().regex(/^07[0-9]{8}$/),
  email: z.string().email().optional(),
  bookings: z.array(myBookingRow),
})
const listDeviceBookingsOk = z.object({
  ok: z.literal(true),
  authority: z.literal('device'),
  session_proof: customerSessionProof,
  receipt_proof: customerSessionProof,
  bookings: z.array(myBookingRow),
})
const listCustomerBookingsErr = z.object({
  ok: z.literal(false),
  error: z.literal('access_denied'),
})
export const listCustomerBookingsResponse = z.union([
  listCustomerBookingsOk,
  listDeviceBookingsOk,
  listCustomerBookingsErr,
])
export type ListCustomerBookingsResponse = z.infer<typeof listCustomerBookingsResponse>

const customerBookingCancelOk = z.object({ ok: z.literal(true) })
const customerBookingCancelErr = z.object({
  ok: z.literal(false),
  error: z.enum(['access_denied', 'not_found']),
})
export const customerBookingCancelResponse = z.discriminatedUnion('ok', [
  customerBookingCancelOk,
  customerBookingCancelErr,
])

// --- create_review -------------------------------------------------------------------------------

const createReviewOk = z.object({
  ok: z.literal(true),
  review: z.object({
    id: z.string(),
    name: z.string(),
    rating: ratingInt,
    text: z.string(),
  }),
})
// `invalid` = bad rating/text/phone shape; `no_booking` = no eligible finished booking. Gateway-only
// challenge/rate-limit outcomes are part of the same HTTP-200 response union.
const createReviewErr = z.object({
  ok: z.literal(false),
  error: z.enum(['invalid', 'no_booking', 'failed_challenge', 'rate_limited', 'system']),
})

export const createReviewResponse = z.discriminatedUnion('ok', [createReviewOk, createReviewErr])
export type CreateReviewResponse = z.infer<typeof createReviewResponse>

// --- reviews list row (direct table select) ------------------------------------------------------
// A single published review row; rating guarded into 1..5 (malformed rows are dropped by the caller).

export const reviewRow = z.object({
  id: z.string(),
  name: z.string(),
  rating: ratingInt,
  text: z.string(),
})
export type ReviewRow = z.infer<typeof reviewRow>

// --- public booking catalog rows -----------------------------------------------------------------
// Server-filtered active barber/service rows returned by `public_booking_catalog()`.

export const publicBarberRow = z.object({
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
export type PublicBarberRow = z.infer<typeof publicBarberRow>

// One row of a barber's flat service menu; maps to `ServiceItem` (`dur = duration_min`).

export const publicServiceRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  name: z.string(),
  price: z.number().finite().min(0).max(100000),
  duration_min: serviceDurationMin,
  active: z.boolean(),
  sort_order: sortOrder,
  available_weekdays: canonicalWeekdays,
})
export type PublicServiceRow = z.infer<typeof publicServiceRow>

export const publicBookingCatalogResponse = z.object({
  barbers: z.array(publicBarberRow.extend({ photo_path: z.string().nullable() })),
  services: z.array(publicServiceRow),
})
export type PublicBookingCatalogResponse = z.infer<typeof publicBookingCatalogResponse>

// --- public site_content / site_settings rows (Task 2 §2) ----------------------------------------
// Editable homepage text (key,lang,value) + non-localized settings (key,value). anon may read both.

export const siteContentRow = z.object({
  key: z.string(),
  lang: z.enum(['sv', 'en']),
  value: z.string(),
})
export type SiteContentRow = z.infer<typeof siteContentRow>

export const siteSettingRow = z.object({
  key: z.string().min(1).max(40),
  value: z.string().max(500),
})
export type SiteSettingRow = z.infer<typeof siteSettingRow>

export const publicBusinessDiscoveryResponse = z.object({
  settings: z.record(z.string()),
  barbers: z.array(z.object({ id: z.string(), name: z.string() })),
  services: z.array(
    z.object({
      id: z.string(),
      barber_id: z.string(),
      price: z.number().finite().min(0).max(100000),
    }),
  ),
  schedules: z.array(
    z.object({
      barber_id: z.string(),
      weekday: z.number().int().min(0).max(6),
      start_min: z.number().int().min(0).max(1439),
      end_min: z.number().int().min(1).max(1440),
    }),
  ),
})
export type PublicBusinessDiscoveryResponse = z.infer<typeof publicBusinessDiscoveryResponse>

// --- public barber_photos row (Task 2 §3) --------------------------------------------------------
// One barber's profile-photo path (anon may read; the adapter resolves it to a public Storage URL).

export const barberPhotoRow = z.object({
  barber_id: z.string(),
  storage_path: z.string(),
})
export type BarberPhotoRow = z.infer<typeof barberPhotoRow>

// --- public about_content row (direct table select) ----------------------------------------------
// One editable (key,lang) copy cell. `key` is the closed set the public About binds; `lang` is sv/en.

export const aboutContentRow = z.object({
  key: z.enum([
    'eyebrow',
    'heading',
    'intro',
    'galleryTitle',
    'cutsTitle',
    'stylistsTitle',
    'reviewsTitle',
  ]),
  lang: z.enum(['sv', 'en']),
  value: z.string(),
})
export type AboutContentRow = z.infer<typeof aboutContentRow>

// --- public gallery_images row (direct table select) ---------------------------------------------
// A Storage-backed photo: its kind, the object path, and alt text. The adapter resolves the path to
// a public URL. `sort_order` drives display order.

export const galleryImageRow = z.object({
  id: z.string(),
  kind: z.enum(['salon', 'cuts']),
  storage_path: z.string(),
  alt: z.string(),
  sort_order: z.number(),
})
export type GalleryImageRow = z.infer<typeof galleryImageRow>

// --- available_slots RPC -------------------------------------------------------------------------
// `setof text` -> PostgREST returns an array of `HH:MM` strings (the AVAILABLE slots, schedule-aware).

export const availableSlotsResponse = z.array(z.string())
export type AvailableSlotsResponse = z.infer<typeof availableSlotsResponse>

// --- parse helper --------------------------------------------------------------------------------

/** Result-shaped parse (no throw): `{ ok:true, value }` or `{ ok:false, error }` with a message. */
export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** Validate `data` against `schema`, returning a Result instead of throwing. */
export function parseWith<T>(schema: z.ZodType<T>, data: unknown): Parsed<T> {
  const result = schema.safeParse(data)
  if (result.success) return { ok: true, value: result.data }
  const first = result.error.issues[0]
  return { ok: false, error: first ? first.message : 'Malformed response' }
}
