import { beforeEach, describe, expect, it, vi } from 'vitest'

const { channel, removeChannel, resetChannel, rpc, triggerChange, triggerSubscribed } = vi.hoisted(
  () => {
    const callbacks: (() => void)[] = []
    let statusCallback: ((status: string) => void) | undefined
    const channel = {
      on: vi.fn((_event: string, _filter: unknown, callback: () => void) => {
        callbacks.push(callback)
        return channel
      }),
      subscribe: vi.fn((callback?: (status: string) => void) => {
        statusCallback = callback
        return channel
      }),
    }
    return {
      channel,
      removeChannel: vi.fn(),
      resetChannel: () => {
        callbacks.length = 0
        statusCallback = undefined
        channel.on.mockClear()
        channel.subscribe.mockClear()
        removeChannel.mockClear()
      },
      rpc: vi.fn(),
      triggerChange: () => callbacks.at(-1)?.(),
      triggerSubscribed: () => statusCallback?.('SUBSCRIBED'),
    }
  },
)

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
import {
  BOOKING_CATALOG_TTL_MS,
  cachedBookingCatalog,
  refreshBookingCatalog,
  subscribeBookingCatalog,
} from '../../src/booking/adapters/supabaseBookingCatalog'
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

  it('refreshes an idle-preloaded catalog after its freshness window expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    rpc.mockClear()
    rpc.mockResolvedValue({ data: { barbers: [], services: [] }, error: null })

    await refreshBookingCatalog()
    expect(rpc).toHaveBeenCalledTimes(1)

    await cachedBookingCatalog()
    expect(rpc).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(BOOKING_CATALOG_TTL_MS + 1)
    await cachedBookingCatalog()
    expect(rpc).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('revalidates an idle preload after the first real consumer subscription is live', async () => {
    rpc.mockReset()
    rpc
      .mockResolvedValueOnce({
        data: {
          barbers: [
            {
              id: 'db-barber',
              name: 'Preloaded Barber',
              ig: 'db',
              role_sv: 'Barberare',
              role_en: 'Barber',
              bio_sv: 'Bio',
              bio_en: 'Bio',
              active: true,
              sort_order: 0,
              photo_path: null,
            },
          ],
          services: [],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          barbers: [
            {
              id: 'db-barber',
              name: 'Edited Barber',
              ig: 'db',
              role_sv: 'Barberare',
              role_en: 'Barber',
              bio_sv: 'Bio',
              bio_en: 'Bio',
              active: true,
              sort_order: 0,
              photo_path: null,
            },
          ],
          services: [],
        },
        error: null,
      })

    await refreshBookingCatalog()
    expect((await cachedBookingCatalog()).barbers[0]?.barber.name).toBe('Preloaded Barber')

    const onCatalogChange = vi.fn()
    const unsubscribe = subscribeBookingCatalog(onCatalogChange)
    triggerSubscribed()

    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(onCatalogChange).toHaveBeenCalledOnce())
    expect((await cachedBookingCatalog()).barbers[0]?.barber.name).toBe('Edited Barber')

    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })

  it('refreshes consumers after catalog-owned service changes', async () => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: { barbers: [], services: [] }, error: null })
    await refreshBookingCatalog()
    rpc.mockClear()

    const onCatalogChange = vi.fn()
    const unsubscribe = subscribeBookingCatalog(onCatalogChange)

    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'services' },
      expect.any(Function),
    )

    triggerSubscribed()
    await vi.waitFor(() => expect(onCatalogChange).toHaveBeenCalledOnce())
    rpc.mockClear()
    triggerChange()
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(onCatalogChange).toHaveBeenCalledTimes(2))

    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
