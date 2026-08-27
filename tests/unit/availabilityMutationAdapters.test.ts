import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ rpc }),
}))

import { saveWeek } from '../../src/admin/adapters/schedulesAdmin'
import { addSlotBlock } from '../../src/admin/adapters/slotBlocksAdmin'
import { addTimeOff } from '../../src/admin/adapters/timeOffAdmin'
import {
  addRecurringBreak,
  deleteRecurringBreak,
} from '../../src/admin/adapters/recurringBreaksAdmin'
import { createManualBooking } from '../../src/admin/adapters/bookingsAdmin'
import { defaultWeek } from '../../src/admin/time'

beforeEach(() => rpc.mockReset())

describe('transactional availability adapters', () => {
  it('surfaces authoritative week conflicts and forwards explicit override', async () => {
    const bookingId = '4d3f88f7-5e08-4d03-abfa-9604816f5614'
    rpc.mockResolvedValue({
      data: { ok: false, error: 'booking_conflict', booking_ids: [bookingId] },
      error: null,
    })
    const week = defaultWeek()

    const result = await saveWeek('hassan', week, true)

    expect(result).toEqual({ kind: 'booking_conflict', bookingIds: [bookingId] })
    expect(rpc).toHaveBeenCalledWith(
      'admin_save_barber_week',
      expect.objectContaining({ p_allow_existing_bookings: true }),
    )
  })

  it('parses a transactional time-off insert', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        row: {
          id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
          barber_id: 'hassan',
          start_date: '2030-01-02',
          end_date: '2030-01-03',
          reason: 'Semester',
        },
      },
      error: null,
    })

    const result = await addTimeOff('hassan', '2030-01-02', '2030-01-03', 'Semester')

    expect(result).toMatchObject({ kind: 'ok', value: { barberId: 'hassan' } })
  })

  it('surfaces slot conflicts instead of writing around a customer booking', async () => {
    const bookingId = '4d3f88f7-5e08-4d03-abfa-9604816f5614'
    rpc.mockResolvedValue({
      data: { ok: false, error: 'booking_conflict', booking_ids: [bookingId] },
      error: null,
    })

    const result = await addSlotBlock('hassan', '2030-01-02', 600, 615)

    expect(result).toEqual({ kind: 'booking_conflict', bookingIds: [bookingId] })
  })

  it('saves a recurring break through its transactional RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        row: {
          id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
          barber_id: 'hassan',
          weekday: 1,
          start_min: 720,
          end_min: 780,
        },
      },
      error: null,
    })

    const result = await addRecurringBreak('hassan', 1, 720, 780)

    expect(result).toMatchObject({
      kind: 'ok',
      value: { barberId: 'hassan', weekday: 1, startMin: 720, endMin: 780 },
    })
    expect(rpc).toHaveBeenCalledWith(
      'admin_add_recurring_break',
      expect.objectContaining({
        p_weekday: 1,
        p_start_min: 720,
        p_end_min: 780,
        p_allow_existing_bookings: false,
      }),
    )
  })

  it('deletes a recurring break through its RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(deleteRecurringBreak('4d3f88f7-5e08-4d03-abfa-9604816f5614')).resolves.toEqual({
      ok: true,
      value: { id: '4d3f88f7-5e08-4d03-abfa-9604816f5614' },
    })
    expect(rpc).toHaveBeenCalledWith('admin_delete_recurring_break', {
      p_id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
    })
  })

  it('surfaces authoritative manual-reservation availability rejection', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'outside_hours' }, error: null })

    const result = await createManualBooking('hassan', {
      startAt: new Date(2030, 0, 2, 10, 0),
      durationMin: 45,
      serviceName: 'Klippning',
      price: 350,
      customerName: 'Kund',
      phone: null,
    })

    expect(result).toEqual({
      ok: false,
      error: { kind: 'validation', message: 'Tiden ligger utanför arbetstid eller är blockerad.' },
    })
  })
})
