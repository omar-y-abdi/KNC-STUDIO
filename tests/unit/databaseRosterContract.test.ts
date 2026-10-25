import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoster } from '../../src/booking/useRoster'
import { useServices } from '../../src/booking/useServices'
import { mockBarbersAdapter } from '../../src/booking/adapters/mockBarbers'
import { mockServicesAdapter } from '../../src/booking/adapters/mockServices'
import { asBarberId } from '../../src/booking/domain'
import { hooks, render as renderWithHooks, reset } from './helpers/fakeHooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('../../src/booking/adapters/barbersIndex', () => ({
  defaultBarbersPort: {},
  subscribeBookingCatalog: vi.fn(),
}))
vi.mock('../../src/booking/adapters/servicesIndex', () => ({ defaultServicesPort: {} }))

beforeEach(reset)
afterEach(() => vi.unstubAllGlobals())

describe('database-owned public catalog', () => {
  it('exposes no invented roster or services in an unconfigured build', async () => {
    await expect(mockBarbersAdapter.listActive()).resolves.toEqual([])
    await expect(
      mockServicesAdapter.listForBarber(asBarberId('db'), '2040-03-18'),
    ).resolves.toEqual([])
  })

  it.each(['roster', 'services'] as const)(
    'starts %s empty and uses only port rows',
    async (kind) => {
      const rows =
        kind === 'roster'
          ? [
              {
                barber: { id: asBarberId('db'), name: 'Owner Barber', ig: '' },
                copy: null,
                photoUrl: null,
              },
            ]
          : [{ id: 'cut', name: 'Owner Service', price: 125.5, dur: 30 }]
      const pending: { resolve?: (rows: unknown) => void } = {}
      const list = vi.fn().mockImplementation(
        () =>
          new Promise((done) => {
            pending.resolve = done
          }),
      )
      const render = () =>
        renderWithHooks(() =>
          kind === 'roster'
            ? useRoster({ listActive: list })
            : useServices(asBarberId('db'), '2040-03-18', { listForBarber: list }),
        )
      expect(render()).toMatchObject(kind === 'roster' ? { roster: [] } : { services: [] })
      const cleanup = hooks.effects[0]?.()
      expect(list).toHaveBeenCalledOnce()
      pending.resolve?.(rows)
      await Promise.resolve()
      expect(render()).toEqual(
        kind === 'roster' ? { roster: rows, loading: false } : { services: rows, loading: false },
      )
      if (typeof cleanup === 'function') cleanup()
    },
  )

  it.each(['roster', 'services'] as const)('keeps %s empty on a port failure', async (kind) => {
    const list = vi.fn().mockRejectedValue(new Error('offline'))
    const render = () =>
      renderWithHooks(() =>
        kind === 'roster'
          ? useRoster({ listActive: list })
          : useServices(asBarberId('db'), '2040-03-18', { listForBarber: list }),
      )
    render()
    hooks.effects[0]?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(render()).toEqual(
      kind === 'roster' ? { roster: [], loading: false } : { services: [], loading: false },
    )
  })
})
