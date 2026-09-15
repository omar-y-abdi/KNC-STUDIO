import { describe, expect, it, vi } from 'vitest'
import { executeExternalAction } from '../../supabase/functions/_shared/externalActions'

const action = { id: '00000000-0000-4000-8000-000000000001', dispatch_token: '00000000-0000-4000-8000-000000000002', action_type: 'storage_object_delete' as const, bucket: 'gallery' as const, path: 'salon/test.webp' }
function fixture(data: unknown, error: { code?: string; message: string } | null = null) {
  const remove = vi.fn(async () => ({ error: null }))
  const rpc = vi.fn(async () => ({ data, error }))
  return { remove, rpc, service: { rpc, storage: { from: () => ({ remove }) } } }
}
describe('parallel CMS media retention', () => {
  it('acknowledges logical removal but keeps an immutable registered file', async () => {
    const f = fixture(true)
    await executeExternalAction(action, f.service, {})
    expect(f.rpc).toHaveBeenCalledWith('internal_cms_media_retained', { p_bucket: 'gallery', p_path: 'salon/test.webp' })
    expect(f.remove).not.toHaveBeenCalled()
  })
  it('keeps the original physical cleanup for an unretained object', async () => {
    const f = fixture(false)
    await executeExternalAction(action, f.service, {})
    expect(f.remove).toHaveBeenCalledWith(['salon/test.webp'])
  })
  it('does not destroy a file when the retention lookup fails or is malformed', async () => {
    for (const f of [fixture(null), fixture(null, { code: '42501', message: 'Lookup denied' })]) {
      await expect(executeExternalAction(action, f.service, {})).rejects.toThrow()
      expect(f.remove).not.toHaveBeenCalled()
    }
  })
  it('retains old cleanup behavior before the additive migration is installed', async () => {
    const f = fixture(null, { code: 'PGRST202', message: 'Function not installed' })
    await executeExternalAction(action, f.service, {})
    expect(f.remove).toHaveBeenCalledTimes(1)
  })
})
