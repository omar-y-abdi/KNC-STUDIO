import { describe, expect, it } from 'vitest'
import {
  discardFailedBookingEmailDeliveryResponse,
  failedBookingEmailDeliveryRow,
} from '../../src/admin/adminSchemas'

describe('failed booking email delivery admin contract', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    booking_id: '22222222-2222-4222-8222-222222222222',
    event: 'booking_confirmed',
    attempt_count: 1,
    failed_at: '2026-08-23T12:00:00.000Z',
  }

  it.each(['send_failed_transient', 'send_failed_permanent'] as const)(
    'accepts %s returned by the delivery RPC',
    (last_error_code) => {
      expect(failedBookingEmailDeliveryRow.safeParse({ ...row, last_error_code }).success).toBe(
        true,
      )
    },
  )

  it('accepts explicit owner discard results', () => {
    expect(discardFailedBookingEmailDeliveryResponse.safeParse({ ok: true }).success).toBe(true)
    expect(discardFailedBookingEmailDeliveryResponse.safeParse({ ok: false }).success).toBe(true)
  })
})
