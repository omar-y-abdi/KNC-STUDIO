import { describe, expect, it } from 'vitest'
import {
  discardFailedBookingEmailDeliveryResponse,
  emailSendLogEntryRow,
  failedBookingEmailDeliveryRow,
} from '../../src/admin/adminSchemas'

describe('failed booking email delivery admin contract', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    booking_id: '22222222-2222-4222-8222-222222222222',
    event: 'booking_confirmed',
    attempt_count: 1,
    failed_at: '2026-08-23T12:00:00.000Z',
    sent_kinds: ['barber'],
    customer_name: 'Ada Kund',
    customer_email: 'ada@example.com',
    customer_phone: '0701234567',
    booking_start_at: '2026-08-24T09:00:00+00:00',
    barber_name: 'Hassan',
    barber_email: null,
  }

  it.each(['send_failed_transient', 'send_failed_permanent'] as const)(
    'accepts %s returned by the delivery RPC',
    (last_error_code) => {
      expect(failedBookingEmailDeliveryRow.safeParse({ ...row, last_error_code }).success).toBe(
        true,
      )
    },
  )

  it('requires the customer and booking time the owner needs to follow up', () => {
    const complete = { ...row, last_error_code: null }
    expect(failedBookingEmailDeliveryRow.safeParse(complete).success).toBe(true)
    expect(
      failedBookingEmailDeliveryRow.safeParse({ ...complete, customer_name: undefined }).success,
    ).toBe(false)
  })

  it('accepts explicit owner discard results', () => {
    expect(discardFailedBookingEmailDeliveryResponse.safeParse({ ok: true }).success).toBe(true)
    expect(discardFailedBookingEmailDeliveryResponse.safeParse({ ok: false }).success).toBe(true)
  })
})

describe('email send log admin contract', () => {
  const entry = {
    id: '33333333-3333-4333-8333-333333333333',
    created_at: '2026-10-24T20:00:00.123456+00:00',
    last_attempt_at: '2026-10-24T20:00:00.123456+00:00',
    kind: 'customer_confirmation',
    recipient: 'ada@example.com',
    subject: 'Bokningsbekräftelse',
    status: 'sent',
    error_code: null,
    booking_id: null,
    attempt_count: 1,
  }

  it('accepts a sent entry and a failed entry with its reason', () => {
    expect(emailSendLogEntryRow.safeParse(entry).success).toBe(true)
    expect(
      emailSendLogEntryRow.safeParse({
        ...entry,
        status: 'failed',
        error_code: 'send_failed_permanent',
      }).success,
    ).toBe(true)
  })

  it('rejects a failed entry without a reason and an unknown kind', () => {
    expect(emailSendLogEntryRow.safeParse({ ...entry, status: 'failed' }).success).toBe(false)
    expect(
      emailSendLogEntryRow.safeParse({ ...entry, error_code: 'send_failed_transient' }).success,
    ).toBe(false)
    expect(emailSendLogEntryRow.safeParse({ ...entry, kind: 'newsletter' }).success).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid attempt count %s',
    (attempt_count) => {
      expect(emailSendLogEntryRow.safeParse({ ...entry, attempt_count }).success).toBe(false)
    },
  )
})
