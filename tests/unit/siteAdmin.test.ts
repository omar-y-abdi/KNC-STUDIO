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
  it('returns database-normalized values to keep the editor consistent with persisted CMS data', async () => {
    single.mockResolvedValue({
      data: { key: 'business_postal_code', value: '411 34' },
      error: null,
    })

    await expect(saveSiteSetting('business_postal_code', '41134')).resolves.toEqual({
      ok: true,
      value: '411 34',
    })
    expect(from).toHaveBeenCalledWith('site_settings')
    expect(upsert).toHaveBeenCalledWith(
      { key: 'business_postal_code', value: '41134' },
      { onConflict: 'key' },
    )
    expect(select).toHaveBeenCalledWith('key,value')
  })

  it('fails closed when returned setting shape is malformed', async () => {
    single.mockResolvedValue({ data: { key: 'business_postal_code' }, error: null })

    await expect(saveSiteSetting('business_postal_code', '41134')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'malformed' },
    })
  })

  it('fails closed when the database returns another setting key', async () => {
    single.mockResolvedValue({
      data: { key: 'business_phone', value: '079-304 36 71' },
      error: null,
    })

    await expect(saveSiteSetting('business_postal_code', '41134')).resolves.toMatchObject({
      ok: false,
      error: { kind: 'malformed' },
    })
  })
})
