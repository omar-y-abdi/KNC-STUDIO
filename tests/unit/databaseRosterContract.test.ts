import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoster } from '../../modules/public-web/src/booking/useRoster'
import { useServices } from '../../modules/public-web/src/booking/useServices'
import { mockBarbersAdapter } from '../../modules/public-web/src/booking/adapters/mockBarbers'
import { mockServicesAdapter } from '../../modules/public-web/src/booking/adapters/mockServices'
import { asBarberId } from '../../modules/public-web/src/booking/domain'
import { hooks, render as renderWithHooks, reset, useEffect } from './helpers/fakeHooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('../../modules/public-web/src/booking/adapters/barbersIndex', () => ({
  defaultBarbersPort: {},
  subscribeBookingCatalog: vi.fn(),
}))
vi.mock('../../modules/public-web/src/booking/adapters/servicesIndex', () => ({
  defaultServicesPort: {},
}))

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
      expect(render()).toMatchObject(
        kind === 'roster' ? { roster: [], status: 'loading' } : { services: [], status: 'loading' },
      )
      const cleanup = hooks.effects[0]?.()
      expect(list).toHaveBeenCalledOnce()
      pending.resolve?.(rows)
      await Promise.resolve()
      expect(render()).toEqual(
        kind === 'roster'
          ? { roster: rows, status: 'ready', retry: expect.any(Function) }
          : { services: rows, status: 'ready', retry: expect.any(Function) },
      )
      if (typeof cleanup === 'function') cleanup()
    },
  )

  it.each(['roster', 'services'] as const)(
    'reports a %s port failure as an error, never as a ready empty list',
    async (kind) => {
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
        kind === 'roster'
          ? { roster: [], status: 'error', retry: expect.any(Function) }
          : { services: [], status: 'error', retry: expect.any(Function) },
      )
    },
  )

  it.each(['roster', 'services'] as const)(
    'reads %s again on retry and leaves the error state',
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
      const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(rows)
      const render = () =>
        renderWithHooks(() =>
          kind === 'roster'
            ? useRoster({ listActive: list })
            : useServices(asBarberId('db'), '2040-03-18', { listForBarber: list }),
        )
      // Deps of the hook's last effect: Preact reruns the effect when they change.
      const effectDeps = (): unknown => (useEffect.mock.calls.at(-1) as readonly unknown[])[1]
      render()
      hooks.effects[0]?.()
      await Promise.resolve()
      await Promise.resolve()
      const failed = render()
      expect(failed.status).toBe('error')
      const depsWhenFailed = effectDeps()

      failed.retry()
      render()
      expect(effectDeps()).not.toEqual(depsWhenFailed)
      hooks.effects[0]?.()
      expect(render().status).toBe('loading')
      await Promise.resolve()
      expect(list).toHaveBeenCalledTimes(2)
      expect(render()).toMatchObject(
        kind === 'roster' ? { roster: rows, status: 'ready' } : { services: rows, status: 'ready' },
      )
    },
  )
})
