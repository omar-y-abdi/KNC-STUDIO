import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, upsert, select, single } = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ from }),
}))

import { saveSiteSetting } from '../../src/admin/adapters/siteAdmin'

beforeEach(() => {
  from.mockReset()
  upsert.mockReset()
  select.mockReset()
  single.mockReset()
  from.mockReturnValue({ upsert })
  upsert.mockReturnValue({ select })
  select.mockReturnValue({ single })
})

describe('site setting writes', () => {
  it('returns the persisted cancellation value after database normalization', async () => {
    single.mockResolvedValue({
      data: { key: 'cancellation_policy_hours', value: '48' },
      error: null,
    })

    await expect(saveSiteSetting('cancellation_policy_hours', ' 48 ')).resolves.toEqual({
      ok: true,
      value: '48',
    })
    expect(from).toHaveBeenCalledWith('site_settings')
    expect(upsert).toHaveBeenCalledWith(
      { key: 'cancellation_policy_hours', value: ' 48 ' },
      { onConflict: 'key' },
    )
    expect(select).toHaveBeenCalledWith('key,value')
  })

  it('fails closed when returned setting shape is malformed', async () => {
    single.mockResolvedValue({ data: { key: 'cancellation_policy_hours' }, error: null })

    await expect(saveSiteSetting('cancellation_policy_hours', '48')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'malformed' },
    })
  })

  it('fails closed when the database returns another setting key', async () => {
    single.mockResolvedValue({
      data: { key: 'business_phone', value: '079-304 36 71' },
      error: null,
    })

    await expect(saveSiteSetting('cancellation_policy_hours', '48')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'malformed' },
    })
  })
})
