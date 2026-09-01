import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, rpc, insert, update, remove, select, single, eq } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ from, rpc }),
}))

import {
  createService,
  deleteService,
  reorderService,
  updateService,
} from '../../src/admin/adapters/servicesAdmin'

const SERVICE_ROW = {
  id: '41000000-0000-4000-8000-000000000001',
  barber_id: 'hassan',
  name: 'Klippning',
  price: 199.99,
  duration_min: 45,
  active: true,
  sort_order: 2,
  available_weekdays: [0, 1, 2, 3, 4, 5, 6],
}

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
  insert.mockReset()
  update.mockReset()
  remove.mockReset()
  select.mockReset()
  single.mockReset()
  eq.mockReset()

  from.mockReturnValue({ insert, update, delete: remove })
  insert.mockReturnValue({ select })
  update.mockReturnValue({ eq })
  remove.mockReturnValue({ eq })
  eq.mockReturnValue({ select })
  select.mockReturnValue({ single })
  single.mockResolvedValue({ data: SERVICE_ROW, error: null })
})

describe('services admin ordering boundary', () => {
  it('creates through the authorized append RPC instead of choosing sort_order in the browser', async () => {
    rpc.mockResolvedValue({ data: { ok: true, row: SERVICE_ROW }, error: null })

    const result = await createService('hassan', {
      name: 'Klippning',
      price: 199.99,
      durationMin: 45,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    })

    expect(result).toMatchObject({ ok: true, value: { sortOrder: 2, price: 199.99 } })
    expect(rpc).toHaveBeenCalledWith('admin_create_service', {
      p_barber_id: 'hassan',
      p_name: 'Klippning',
      p_price: 199.99,
      p_duration_min: 45,
      p_active: true,
      p_available_weekdays: [0, 1, 2, 3, 4, 5, 6],
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('never sends sort_order through an ordinary service edit', async () => {
    const result = await updateService(SERVICE_ROW.id, {
      name: 'Klippning',
      price: 199.99,
      durationMin: 45,
      active: true,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    })

    expect(result).toMatchObject({ ok: true })
    expect(update).toHaveBeenCalledWith({
      name: 'Klippning',
      price: 199.99,
      duration_min: 45,
      active: true,
      available_weekdays: [0, 1, 2, 3, 4, 5, 6],
    })
  })

  it('deletes through the authorized compaction RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })

    const result = await deleteService(SERVICE_ROW.id)

    expect(result).toEqual({ ok: true, value: { id: SERVICE_ROW.id } })
    expect(rpc).toHaveBeenCalledWith('admin_delete_service', { p_id: SERVICE_ROW.id })
    expect(from).not.toHaveBeenCalled()
  })

  it('reorders through the authorized per-barber RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        services: [
          { ...SERVICE_ROW, sort_order: 1 },
          { ...SERVICE_ROW, id: '41000000-0000-4000-8000-000000000002', sort_order: 0 },
        ],
      },
      error: null,
    })

    const result = await reorderService('hassan', SERVICE_ROW.id, -1)

    expect(result).toMatchObject({ ok: true, value: [{ sortOrder: 1 }, { sortOrder: 0 }] })
    expect(rpc).toHaveBeenCalledWith('admin_reorder_service', {
      p_barber_id: 'hassan',
      p_service_id: SERVICE_ROW.id,
      p_direction: -1,
    })
    expect(from).not.toHaveBeenCalled()
  })
})
