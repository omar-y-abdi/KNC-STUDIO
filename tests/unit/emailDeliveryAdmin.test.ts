import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ rpc }),
}))

import { discardFailedBookingEmailDelivery } from '../../src/admin/adapters/emailTemplatesAdmin'

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
})
