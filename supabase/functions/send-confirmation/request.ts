import { z } from 'zod'
import { parse } from '../_shared/http.ts'

export type BookingEmailEvent = 'booking_confirmed' | 'booking_cancelled' | 'booking_reminder'

export type RequestResult =
  | {
      readonly ok: true
      readonly id: string | null
      readonly event: BookingEmailEvent | null
      readonly deliveryId: string | null
    }
  | { readonly ok: false; readonly error: string }

const notObject = { message: 'payload must be an object' }

/** `queue_due_booking_email_deliveries` posts exactly `{ delivery_id }`. */
const deliverySchema = z.object({ delivery_id: z.string().min(1) }, notObject).strict()

/** The reminder sweep posts exactly `{ id, event: 'booking_reminder' }`; a bare `{ id }` is a confirmation. */
const bookingSchema = z
  .object(
    {
      id: z.string({ message: 'id is required' }).min(1, 'id is required'),
      event: z
        .enum(['booking_confirmed', 'booking_cancelled', 'booking_reminder'], {
          message: 'invalid event',
        })
        .nullish(),
    },
    notObject,
  )
  .strict()

function carriesDelivery(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const id = (raw as Record<string, unknown>).delivery_id
  return typeof id === 'string' && id.length > 0
}

export function parseRequest(raw: unknown): RequestResult {
  if (carriesDelivery(raw)) {
    const delivery = parse(deliverySchema, raw)
    return delivery.ok
      ? { ok: true, id: null, event: null, deliveryId: delivery.data.delivery_id }
      : { ok: false, error: delivery.detail }
  }
  const booking = parse(bookingSchema, raw)
  return booking.ok
    ? {
        ok: true,
        id: booking.data.id,
        event: booking.data.event ?? 'booking_confirmed',
        deliveryId: null,
      }
    : { ok: false, error: booking.detail }
}
