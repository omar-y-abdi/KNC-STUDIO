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
const ratingInt = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

// --- create_booking ------------------------------------------------------------------------------
// ok echoes NO phone/email/customer_name (PII never leaves the DB on create).

const createBookingOk = z.object({
  ok: z.literal(true),
  booking: z.object({
    id: z.string(),
    barber_id: z.string(),
    service_id: z.string(),
    service_name: z.string(),
    price: z.number(),
    duration_min: z.number(),
    start_at: isoTimestamp,
    end_at: isoTimestamp,
    method: z.string(),
    lang: z.string(),
  }),
})

/** create_booking error codes (closed set from the RPC). */
const createBookingErr = z.object({
  ok: z.literal(false),
  error: z.enum(['invalid_time', 'invalid_contact', 'slot_taken', 'invalid']),
})

export const createBookingResponse = z.discriminatedUnion('ok', [createBookingOk, createBookingErr])
export type CreateBookingResponse = z.infer<typeof createBookingResponse>

// --- taken_slots ---------------------------------------------------------------------------------
// `returns table (...)` -> PostgREST gives an ARRAY of rows.

const takenSlotRow = z.object({ start_at: isoTimestamp, end_at: isoTimestamp })
export const takenSlotsResponse = z.array(takenSlotRow)
export type TakenSlotRow = z.infer<typeof takenSlotRow>

// --- lookup_booking / cancel_booking -------------------------------------------------------------
// Both return the SAME ok booking shape (echoing the proven contact) and the same not_found error.

const cancelBookingShape = z.object({
  id: z.string(),
  barber_id: z.string(),
  service_name: z.string(),
  price: z.number(),
  start_at: isoTimestamp,
  method: z.enum(['sms', 'email']),
  contact: z.string(),
})

const bookingLookupOk = z.object({ ok: z.literal(true), booking: cancelBookingShape })
const bookingLookupErr = z.object({ ok: z.literal(false), error: z.literal('not_found') })

export const bookingLookupResponse = z.discriminatedUnion('ok', [bookingLookupOk, bookingLookupErr])
export type BookingLookupResponse = z.infer<typeof bookingLookupResponse>

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
const createReviewErr = z.object({ ok: z.literal(false), error: z.literal('invalid') })

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

// --- parse helper --------------------------------------------------------------------------------

/** Result-shaped parse (no throw): `{ ok:true, value }` or `{ ok:false, error }` with a message. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

/** Validate `data` against `schema`, returning a Result instead of throwing. */
export function parseWith<T>(schema: z.ZodType<T>, data: unknown): Parsed<T> {
  const result = schema.safeParse(data)
  if (result.success) return { ok: true, value: result.data }
  const first = result.error.issues[0]
  return { ok: false, error: first ? first.message : 'Malformed response' }
}
