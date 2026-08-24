import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asBarberId } from '../../src/booking/domain'

const { contains, eq, from, order, select } = vi.hoisted(() => ({
  contains: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  order: vi.fn(),
  select: vi.fn(),
}))

vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => ({ from }),
}))

import { supabaseServicesAdapter } from '../../src/booking/adapters/supabaseServices'

beforeEach(() => {
  contains.mockReset()
  eq.mockReset()
  from.mockReset()
  order.mockReset()
  select.mockReset()
  from.mockReturnValue({ select })
  select.mockReturnValue({ eq })
  eq.mockReturnValue({ eq, contains })
  contains.mockReturnValue({ order })
  order.mockResolvedValue({ data: [], error: null })
})

describe('Supabase service menu', () => {
  it('fetches services for a selectable Sunday using the Sunday weekday filter', async () => {
    const sunday = '2040-03-18'
    expect(new Date(2040, 2, 18).getDay()).toBe(0)

    await expect(
      supabaseServicesAdapter.listForBarber(asBarberId('hassan'), sunday),
    ).resolves.toEqual([])

    expect(contains).toHaveBeenCalledWith('available_weekdays', [0])
  })
})
