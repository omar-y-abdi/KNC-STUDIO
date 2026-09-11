import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ok } from '../../src/admin/types'

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

// Reads and writes share a resource queue beyond a component's lifetime.
describe('admin operation ordering', () => {
  it('a returning read observes the first commit and a later write remains final', async () => {
    const { orderedAdminOperation } = await import('../../src/admin/orderedOperations')
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: string[] = []
    let persistedPrice = 100
    const first = orderedAdminOperation('test:service-a', async () => {
      events.push('first started')
      await gate
      persistedPrice = 200
      return ok(undefined)
    })
    const returningRead = orderedAdminOperation('test:service-a', async () => ok(persistedPrice))
    const second = orderedAdminOperation('test:service-a', async () => {
      events.push('second started')
      persistedPrice = 300
      return ok(undefined)
    })
    try {
      await Promise.resolve()
      expect(events).toEqual(['first started'])
      expect(persistedPrice).toBe(100)
    } finally {
      release()
    }
    await first
    expect(await returningRead).toEqual(ok(200))
    await second
    expect(persistedPrice).toBe(300)
    expect(events).toEqual(['first started', 'second started'])
  })

  it('a different barber can proceed while A is pending', async () => {
    const { orderedAdminOperation } = await import('../../src/admin/orderedOperations')
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = orderedAdminOperation('test:photo-a', async () => {
      await gate
      return ok(undefined)
    })
    try {
      expect(await orderedAdminOperation('test:photo-b', async () => ok('saved B'))).toEqual(
        ok('saved B'),
      )
    } finally {
      release()
      await first
    }
  })

  it('a rejected write releases the resource without hiding the rejection', async () => {
    const { orderedAdminOperation } = await import('../../src/admin/orderedOperations')
    const failed = orderedAdminOperation('test:rejected', async () => {
      throw new Error('write failed')
    })
    const next = orderedAdminOperation('test:rejected', async () => ok('reloaded'))
    await expect(failed).rejects.toThrow('write failed')
    await expect(next).resolves.toEqual(ok('reloaded'))
    await expect(
      orderedAdminOperation('test:rejected', async () => ok('saved later')),
    ).resolves.toEqual(ok('saved later'))
  })

  it('drops old queued intent at session end while a new session still reads after the in-flight commit', async () => {
    const { orderedAdminOperation, invalidateAdminOperations } =
      await import('../../src/admin/orderedOperations')
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let persisted = 'before'
    const first = orderedAdminOperation('test:session', async () => {
      await gate
      persisted = 'committed A'
      return ok(undefined)
    })
    const oldWrite = vi.fn(async () => {
      persisted = 'old A intent'
      return ok(undefined)
    })
    const queued = orderedAdminOperation('test:session', oldWrite)
    await Promise.resolve()
    try {
      invalidateAdminOperations()
      const readB = orderedAdminOperation('test:session', async () => ok(persisted))
      release()
      expect(await queued).toMatchObject({ ok: false, error: { kind: 'auth' } })
      expect(oldWrite).not.toHaveBeenCalled()
      expect(await readB).toEqual(ok('committed A'))
    } finally {
      release()
      await first
      await queued
    }
  })
})
