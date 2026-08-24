import { describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => ({
    rpc,
    storage: {
      from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://img/${path}` } }) }),
    },
  }),
}))

import { supabaseBarbersAdapter } from '../../src/booking/adapters/supabaseBarbers'
import { supabaseServicesAdapter } from '../../src/booking/adapters/supabaseServices'
import { asBarberId } from '../../src/booking/domain'

describe('shared public booking catalog', () => {
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
          },
        ],
      },
      error: null,
    })

    const [barbers, services] = await Promise.all([
      supabaseBarbersAdapter.listActive(),
      supabaseServicesAdapter.listForBarber(asBarberId('db-barber')),
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
    expect(services).toEqual([
      { id: 'db-service', name: 'Database Service', price: 425, dur: 45 },
    ])
  })
})
