import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokePublicBookingAction } = vi.hoisted(() => ({
  invokePublicBookingAction: vi.fn(),
}))

vi.mock('../../src/backend/publicBookingActions', () => ({ invokePublicBookingAction }))

import { supabaseCancellationAdapter } from '../../src/cancellation/adapters/supabaseCancellation'
import { supabaseMyBookingsAdapter } from '../../src/mybookings/adapters/supabaseMyBookings'
import type { CancelBooking } from '../../src/cancellation/domain'
import type { MyBooking } from '../../src/mybookings/domain'

const cancellationBooking: CancelBooking = {
  id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
  barber: { id: 'hassan', name: 'Hassan', ig: '' },
  serviceName: 'Klippning',
  price: 350,
  start: new Date('2040-03-14T12:30:00.000Z'),
  whenLabel: '14 mars, 13:30',
  contact: '0701234567',
}

const myBooking: MyBooking = {
  id: cancellationBooking.id,
  barber: cancellationBooking.barber,
  serviceName: cancellationBooking.serviceName,
  price: cancellationBooking.price,
  durationMin: 45,
  start: cancellationBooking.start,
  whenLabel: cancellationBooking.whenLabel,
}

describe('public booking action adapter errors', () => {
  beforeEach(() => invokePublicBookingAction.mockReset())

  it.each(['failed_challenge', 'rate_limited'] as const)(
    'preserves lookup/list gateway error %s',
    async (error) => {
      invokePublicBookingAction.mockResolvedValue({ data: { ok: false, error }, failed: false })

      await expect(
        supabaseCancellationAdapter.lookup({
          contact: '0701234567',
          lang: 'sv',
          turnstileToken: 'challenge',
        }),
      ).resolves.toEqual({ ok: false, error })
      await expect(
        supabaseMyBookingsAdapter.listByPhone({
          contact: '0701234567',
          lang: 'sv',
          turnstileToken: 'challenge',
        }),
      ).resolves.toEqual({ ok: false, error })
    },
  )

  it.each(['not_found', 'failed_challenge', 'rate_limited'] as const)(
    'preserves cancellation gateway error %s',
    async (error) => {
      invokePublicBookingAction.mockResolvedValue({ data: { ok: false, error }, failed: false })

      await expect(
        supabaseCancellationAdapter.cancel(cancellationBooking, 'challenge'),
      ).resolves.toEqual({ ok: false, error })
      await expect(
        supabaseMyBookingsAdapter.cancel(myBooking, '0701234567', 'challenge'),
      ).resolves.toEqual({ ok: false, error })
    },
  )
})
