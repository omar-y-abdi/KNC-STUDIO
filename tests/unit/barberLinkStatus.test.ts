// Regression: linkedBarberIds must request every column required by profileRow. Returning a
// narrower PostgREST shape makes Zod reject each linked profile and the UI falsely shows
// "Ej kopplad" after reload even though the profile link exists.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, select } = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ from }),
}))

import { linkedBarberIds } from '../../src/admin/adapters/barbersAdmin'

beforeEach(() => {
  from.mockReset()
  select.mockReset()
  from.mockReturnValue({ select })
})

describe('linkedBarberIds', () => {
  it('keeps linked profiles after parsing the selected PostgREST shape', async () => {
    const profile: Record<string, unknown> = {
      role: 'barber',
      barber_id: 'k',
      must_change_password: true,
    }
    select.mockImplementation((columns: string) => {
      const selected = columns.split(',').map((column) => column.trim())
      return Promise.resolve({
        data: [Object.fromEntries(selected.map((column) => [column, profile[column]]))],
        error: null,
      })
    })

    const result = await linkedBarberIds()

    expect(from).toHaveBeenCalledWith('profiles')
    expect(select).toHaveBeenCalledWith('role, barber_id, must_change_password')
    expect(result).toEqual({ ok: true, value: new Set(['k']) })
  })
})
