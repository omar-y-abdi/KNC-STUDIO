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

/**
 * A 1..5 rating. Modeled as a literal union so the INFERRED type is exactly `1 | 2 | 3 | 4 | 5`,
 * structurally identical to the domain `Rating` — a parsed value drops straight into a `Review`
 * with no cast and no widening to `number`.
 */
const ratingInt = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])

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

// --- lookup_booking / cancel_booking -------------------------------------------------------------
// Both return the SAME ok booking shape (echoing the proven contact) and the same not_found error.

const cancelBookingShape = z.object({
  id: z.string(),
  barber_id: z.string(),
  service_name: z.string(),
  price: z.number(),
  start_at: isoTimestamp,
  // Email was removed; lookup/cancel are phone-only, so the echoed method is always 'sms'.
  method: z.literal('sms'),
  contact: z.string(),
})

const bookingLookupOk = z.object({ ok: z.literal(true), booking: cancelBookingShape })
const bookingLookupErr = z.object({ ok: z.literal(false), error: z.literal('not_found') })

export const bookingLookupResponse = z.discriminatedUnion('ok', [bookingLookupOk, bookingLookupErr])
export type BookingLookupResponse = z.infer<typeof bookingLookupResponse>

// --- list_bookings_by_phone (Mina bokningar) -----------------------------------------------------
// The self-service history RPC. Enumerates EVERY confirmed booking for a proven phone (past +
// future), so the adapter can split them into the upcoming/past sections. Always `{ ok: true }`; an
// unknown phone returns an empty `bookings` array (the client treats empty as "not found"). Each row
// carries just the display fields the dialog renders (barber via roster, service · price, when).

const myBookingRow = z.object({
  id: z.string(),
  barber_id: z.string(),
  service_name: z.string(),
  price: z.number(),
  duration_min: z.number(),
  start_at: isoTimestamp,
})

export const listBookingsByPhoneResponse = z.object({
  ok: z.literal(true),
  bookings: z.array(myBookingRow),
})
export type ListBookingsByPhoneResponse = z.infer<typeof listBookingsByPhoneResponse>

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
// `invalid` = bad rating/text/phone shape; `no_booking` = the phone has no finished, not-yet-reviewed
// confirmed booking (the review gate — one review per finished haircut).
const createReviewErr = z.object({
  ok: z.literal(false),
  error: z.enum(['invalid', 'no_booking']),
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

// --- public barbers row (direct table select) ----------------------------------------------------
// The ACTIVE roster the public site reads (booking grid + About cards). Same column set the admin
// reads, but consumed read-only by anon via the `barbers` public-select RLS policy. `active` is
// included so a malformed/unexpected row can be dropped; the adapter filters active in the query.

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
