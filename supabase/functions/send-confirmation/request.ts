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

function text(raw: unknown, key: string): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = (raw as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function carriesDelivery(raw: unknown): boolean {
  return text(raw, 'delivery_id') !== undefined
}

/** A present but unusable `delivery_id` beside no `id` was always answered as a missing id. */
function lacksBothIdentities(raw: unknown): boolean {
  return (
    typeof raw === 'object' && raw !== null && 'delivery_id' in raw && text(raw, 'id') === undefined
  )
}

export function parseRequest(raw: unknown): RequestResult {
  if (carriesDelivery(raw)) {
    const delivery = parse(deliverySchema, raw)
    return delivery.ok
      ? { ok: true, id: null, event: null, deliveryId: delivery.data.delivery_id }
      : { ok: false, error: delivery.detail }
  }
  if (lacksBothIdentities(raw)) return { ok: false, error: 'id is required' }
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
