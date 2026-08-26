import { beforeEach, describe, expect, it, vi } from 'vitest'

const { channel, removeChannel, resetChannel, rpc, triggerChange } = vi.hoisted(() => {
  const callbacks: (() => void)[] = []
  const channel = {
    on: vi.fn((_event: string, _filter: unknown, callback: () => void) => {
      callbacks.push(callback)
      return channel
    }),
    subscribe: vi.fn(),
  }
  return {
    channel,
    removeChannel: vi.fn(),
    resetChannel: () => {
      callbacks.length = 0
      channel.on.mockClear()
      channel.subscribe.mockClear()
    },
    rpc: vi.fn(),
    triggerChange: () => callbacks.at(-1)?.(),
  }
})

vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => ({
    rpc,
    channel: () => channel,
    removeChannel,
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://img/${path}` } }),
      }),
    },
  }),
}))

import { supabaseBarbersAdapter } from '../../src/booking/adapters/supabaseBarbers'
import { supabaseServicesAdapter } from '../../src/booking/adapters/supabaseServices'
import { subscribeBookingCatalog } from '../../src/booking/adapters/supabaseBookingCatalog'
import { asBarberId } from '../../src/booking/domain'

describe('shared public booking catalog', () => {
  beforeEach(() => resetChannel())

  it('hydrates roster/photos/services through one cached RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        barbers: [
          {
            id: 'db-barber',
            name: 'Database Barber',
            ig: 'db',
            role_sv: 'Barberare',
            role_en: 'Barber',
            bio_sv: 'Bio',
            bio_en: 'Bio',
            active: true,
            sort_order: 0,
            photo_path: 'db.webp',
          },
        ],
        services: [
          {
            id: 'db-service',
            barber_id: 'db-barber',
            name: 'Database Service',
            price: 425,
            duration_min: 45,
            active: true,
            sort_order: 0,
            available_weekdays: [0],
          },
        ],
      },
      error: null,
    })

    const [barbers, services] = await Promise.all([
      supabaseBarbersAdapter.listActive(),
      supabaseServicesAdapter.listForBarber(asBarberId('db-barber'), '2040-03-18'),
    ])

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('public_booking_catalog')
    expect(barbers).toEqual([
      {
        barber: { id: 'db-barber', name: 'Database Barber', ig: 'db' },
        copy: { roleSv: 'Barberare', roleEn: 'Barber', bioSv: 'Bio', bioEn: 'Bio' },
        photoUrl: 'https://img/db.webp',
      },
    ])
    expect(services).toEqual([{ id: 'db-service', name: 'Database Service', price: 425, dur: 45 }])

    await expect(
      supabaseServicesAdapter.listForBarber(asBarberId('db-barber'), '2040-03-19'),
    ).resolves.toEqual([])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('refreshes date-filtered service consumers after catalog-owned service changes', () => {
    const onCatalogChange = vi.fn()
    const unsubscribe = subscribeBookingCatalog(onCatalogChange)

    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'services' },
      expect.any(Function),
    )
    triggerChange()
    expect(onCatalogChange).toHaveBeenCalledOnce()

    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
