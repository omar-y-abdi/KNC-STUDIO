import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ rpc }),
}))

import {
  discardFailedBookingEmailDelivery,
  getEmailSendLogCopy,
  listEmailSendLog,
  listFailedBookingEmailDeliveries,
  retryFailedBookingEmailDelivery,
} from '../../src/admin/adapters/emailDeliveryAdmin'

beforeEach(() => rpc.mockReset())

describe('failed email delivery admin actions', () => {
  it('discards a failed delivery through the owner-gated RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(discardFailedBookingEmailDelivery('delivery-id')).resolves.toEqual({
      ok: true,
      value: true,
    })
    expect(rpc).toHaveBeenCalledWith('admin_discard_failed_booking_email_delivery', {
      p_id: 'delivery-id',
    })
  })

  it('fails closed when the delivery is no longer failed', async () => {
    rpc.mockResolvedValue({ data: { ok: false }, error: null })

    await expect(discardFailedBookingEmailDelivery('delivery-id')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found' },
    })
  })

  it('lists failed deliveries through the owner-gated RPC', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          booking_id: '22222222-2222-4222-8222-222222222222',
          event: 'booking_confirmed',
          attempt_count: 5,
          last_error_code: 'send_failed_permanent',
          failed_at: '2026-10-24T10:00:00Z',
          sent_kinds: ['barber'],
          customer_name: 'Ada Kund',
          customer_email: 'ada@example.com',
          customer_phone: '0701234567',
          booking_start_at: '2026-10-25T09:00:00+00:00',
          barber_name: 'Hassan',
          barber_email: 'hassan@example.com',
        },
      ],
      error: null,
    })

    await expect(listFailedBookingEmailDeliveries()).resolves.toEqual({
      ok: true,
      value: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          bookingId: '22222222-2222-4222-8222-222222222222',
          event: 'booking_confirmed',
          attemptCount: 5,
          errorCode: 'send_failed_permanent',
          failedAt: '2026-10-24T10:00:00Z',
          sentKinds: ['barber'],
          customerName: 'Ada Kund',
          customerEmail: 'ada@example.com',
          customerPhone: '0701234567',
          bookingStartAt: '2026-10-25T09:00:00+00:00',
          barberName: 'Hassan',
          barberEmail: 'hassan@example.com',
        },
      ],
    })
    expect(rpc).toHaveBeenCalledWith('admin_list_failed_booking_email_deliveries')
  })

  it('retries a failed delivery and reports one that is gone', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await expect(retryFailedBookingEmailDelivery('delivery-id')).resolves.toEqual({
      ok: true,
      value: true,
    })
    expect(rpc).toHaveBeenCalledWith('admin_retry_failed_booking_email_delivery', {
      p_id: 'delivery-id',
    })

    rpc.mockResolvedValue({ data: { ok: false }, error: null })
    await expect(retryFailedBookingEmailDelivery('delivery-id')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found' },
    })
  })
})

describe('email send log admin reads', () => {
  const row = (id: string, created_at: string) => ({
    id,
    created_at,
    last_attempt_at: created_at,
    kind: 'auth_recovery',
    recipient: 'ada@example.com',
    subject: 'Återställ lösenord',
    status: 'failed',
    error_code: 'send_failed_transient',
    booking_id: null,
    attempt_count: 2,
  })

  it('pages from the last entry with its timestamp verbatim', async () => {
    rpc.mockResolvedValue({
      data: {
        entries: [
          row('44444444-4444-4444-8444-444444444441', '2026-10-24T20:00:00.654321+00:00'),
          row('44444444-4444-4444-8444-444444444442', '2026-10-24T19:00:00.123456+00:00'),
        ],
        has_more: true,
      },
      error: null,
    })

    const page = await listEmailSendLog({
      before: '2026-10-24T21:00:00.000001+00:00',
      beforeId: '44444444-4444-4444-8444-444444444440',
    })

    expect(rpc).toHaveBeenCalledWith('admin_list_email_send_log', {
      p_before: '2026-10-24T21:00:00.000001+00:00',
      p_before_id: '44444444-4444-4444-8444-444444444440',
      p_limit: 50,
    })
    expect(page).toMatchObject({
      ok: true,
      value: {
        next: {
          before: '2026-10-24T19:00:00.123456+00:00',
          beforeId: '44444444-4444-4444-8444-444444444442',
        },
      },
    })
    expect(page.ok && page.value.entries[0]?.outcome).toEqual({
      status: 'failed',
      errorCode: 'send_failed_transient',
    })
  })

  it('starts at the newest entry and stops when no more rows exist', async () => {
    rpc.mockResolvedValue({ data: { entries: [], has_more: false }, error: null })

    await expect(listEmailSendLog(null)).resolves.toEqual({
      ok: true,
      value: { entries: [], next: null },
    })
    expect(rpc).toHaveBeenCalledWith('admin_list_email_send_log', {
      p_before: null,
      p_before_id: null,
      p_limit: 50,
    })
  })

  it('reads one stored copy and reports a purged one as not found', async () => {
    rpc.mockResolvedValue({
      data: {
        id: '44444444-4444-4444-8444-444444444441',
        subject: 'Återställ lösenord',
        html: '<a href="[dold länk]">Välj nytt lösenord</a>',
        text_body: 'Välj nytt lösenord: [dold länk]',
      },
      error: null,
    })
    await expect(getEmailSendLogCopy('44444444-4444-4444-8444-444444444441')).resolves.toEqual({
      ok: true,
      value: {
        subject: 'Återställ lösenord',
        html: '<a href="[dold länk]">Välj nytt lösenord</a>',
        text: 'Välj nytt lösenord: [dold länk]',
      },
    })
    expect(rpc).toHaveBeenCalledWith('admin_get_email_send_log_entry', {
      p_id: '44444444-4444-4444-8444-444444444441',
    })

    rpc.mockResolvedValue({ data: null, error: null })
    await expect(getEmailSendLogCopy('44444444-4444-4444-8444-444444444441')).resolves.toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'Kopian har rensats (äldre än 30 dagar).' },
    })
  })
})
