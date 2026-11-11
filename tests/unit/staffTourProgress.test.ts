// The tutorial progress port against a mocked client: both RPCs, their arguments, every answer.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../modules/staff-admin/src/adminClient', () => ({
  getAdminClient: () => ({ rpc }),
}))

import {
  TOUR_PROGRESS_FAILED,
  tourProgressPort,
} from '../../modules/staff-admin/src/adapters/tourProgress'
import { TOUR_IDS, type TourId } from '../../modules/staff-admin/src/tour/tourModel'

beforeEach(() => {
  rpc.mockReset()
})

const progress = (seen: readonly TourId[], removed: boolean) => ({ seen: new Set(seen), removed })

describe('tour progress read', () => {
  it('reads the own row through own_staff_tour_progress; no row is fresh progress', async () => {
    rpc.mockResolvedValue({ data: [], error: null, status: 200 })

    await expect(tourProgressPort.read()).resolves.toEqual({
      ok: true,
      value: progress([], false),
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('own_staff_tour_progress')
  })

  it('gives the row its values', async () => {
    rpc.mockResolvedValue({
      data: [{ seen: ['overview', 'bookings'], removed: true }],
      error: null,
      status: 200,
    })

    await expect(tourProgressPort.read()).resolves.toEqual({
      ok: true,
      value: progress(['overview', 'bookings'], true),
    })
  })

  it('drops tour ids it does not know', async () => {
    rpc.mockResolvedValue({
      data: [{ seen: ['overview', 'gift-cards', 'profile', ''], removed: false }],
      error: null,
      status: 200,
    })

    await expect(tourProgressPort.read()).resolves.toEqual({
      ok: true,
      value: progress(['overview', 'profile'], false),
    })
  })

  it.each([
    ['a row without removed', [{ seen: [] }]],
    ['a removed flag that is not a boolean', [{ seen: [], removed: 'false' }]],
    ['a seen that is not an array', [{ seen: 'overview', removed: false }]],
    ['a seen entry that is not a string', [{ seen: [null], removed: false }]],
    [
      'two rows',
      [
        { seen: [], removed: false },
        { seen: [], removed: false },
      ],
    ],
    ['a bare object', { seen: [], removed: false }],
    ['null', null],
    ['a string', 'overview'],
  ])('%s gives the single error value', async (_label, data) => {
    rpc.mockResolvedValue({ data, error: null, status: 200 })

    await expect(tourProgressPort.read()).resolves.toBe(TOUR_PROGRESS_FAILED)
  })

  it.each([
    ['a missing function', { code: 'PGRST202', message: 'Could not find the function' }, 404],
    ['an expired session', { code: 'PGRST301', message: 'JWT expired' }, 401],
    ['a refusal', { code: '42501', message: 'permission denied' }, 403],
  ])('a client error (%s) gives the single error value', async (_label, error, status) => {
    rpc.mockResolvedValue({ data: null, error, status })

    await expect(tourProgressPort.read()).resolves.toBe(TOUR_PROGRESS_FAILED)
  })

  it('a thrown client gives the single error value', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(tourProgressPort.read()).resolves.toBe(TOUR_PROGRESS_FAILED)
  })
})

describe('tour progress write', () => {
  it('sends seen in TOUR_IDS order and removed to set_own_staff_tour_progress', async () => {
    rpc.mockResolvedValue({ data: null, error: null, status: 204 })

    await expect(
      tourProgressPort.write(progress(['profile', 'services', 'overview'], false)),
    ).resolves.toEqual({ ok: true, value: undefined })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('set_own_staff_tour_progress', {
      p_seen: ['overview', 'services', 'profile'],
      p_removed: false,
    })
  })

  it('sends every tour and removed true unchanged', async () => {
    rpc.mockResolvedValue({ data: null, error: null, status: 204 })

    await tourProgressPort.write(progress([...TOUR_IDS].reverse(), true))

    expect(rpc).toHaveBeenCalledWith('set_own_staff_tour_progress', {
      p_seen: ['overview', 'schedule', 'bookings', 'services', 'profile'],
      p_removed: true,
    })
  })

  it('sends an empty seen for fresh progress', async () => {
    rpc.mockResolvedValue({ data: null, error: null, status: 204 })

    await tourProgressPort.write(progress([], false))

    expect(rpc).toHaveBeenCalledWith('set_own_staff_tour_progress', {
      p_seen: [],
      p_removed: false,
    })
  })

  it('a client error gives the single error value', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'violates check constraint' },
      status: 400,
    })

    await expect(tourProgressPort.write(progress(['overview'], false))).resolves.toBe(
      TOUR_PROGRESS_FAILED,
    )
  })

  it('a thrown client gives the single error value', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(tourProgressPort.write(progress(['overview'], false))).resolves.toBe(
      TOUR_PROGRESS_FAILED,
    )
  })
})

describe('the single error value', () => {
  it('is an AdminResult failure', () => {
    expect(TOUR_PROGRESS_FAILED).toEqual({
      ok: false,
      error: { kind: 'network', message: 'Tutorialen kunde inte läsas eller sparas.' },
    })
  })
})
