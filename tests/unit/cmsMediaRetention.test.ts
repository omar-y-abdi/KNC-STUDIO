import { describe, expect, it, vi } from 'vitest'
import {
  executeExternalAction,
  type ExternalActionRuntime,
  type ExternalActionService,
} from '../../supabase/functions/_shared/externalActions'

const action = {
  id: '00000000-0000-4000-8000-000000000001',
  dispatch_token: '00000000-0000-4000-8000-000000000002',
  action_type: 'storage_object_delete' as const,
  bucket: 'gallery' as const,
  path: 'salon/test.webp',
}
const runtime: ExternalActionRuntime = { googleClientId: undefined, googleClientSecret: undefined }
const authAdminNotExpected = async (): Promise<never> => {
  throw new Error('Media cleanup must not call the Auth admin API')
}
function fixture(data: unknown, error: { code?: string; message: string } | null = null) {
  const remove = vi.fn(async () => ({ error: null }))
  const rpc = vi.fn(async () => ({ data, error }))
  const service: ExternalActionService = {
    rpc,
    storage: { from: () => ({ remove }) },
    auth: { admin: { updateUserById: authAdminNotExpected, deleteUser: authAdminNotExpected } },
  }
  return { remove, rpc, service }
}
describe('parallel CMS media retention', () => {
  it('acknowledges logical removal but keeps an immutable registered file', async () => {
    const f = fixture(true)
    await executeExternalAction(action, f.service, runtime)
    expect(f.rpc).toHaveBeenCalledWith('internal_cms_media_retained', {
      p_bucket: 'gallery',
      p_path: 'salon/test.webp',
    })
    expect(f.remove).not.toHaveBeenCalled()
  })
  it('keeps the original physical cleanup for an unretained object', async () => {
    const f = fixture(false)
    await executeExternalAction(action, f.service, runtime)
    expect(f.remove).toHaveBeenCalledWith(['salon/test.webp'])
  })
  it('does not destroy a file when the retention lookup fails or is malformed', async () => {
    for (const f of [fixture(null), fixture(null, { code: '42501', message: 'Lookup denied' })]) {
      await expect(executeExternalAction(action, f.service, runtime)).rejects.toThrow()
      expect(f.remove).not.toHaveBeenCalled()
    }
  })
  it('does not destroy a file when the retention function is missing', async () => {
    for (const code of ['PGRST202', '42883']) {
      const f = fixture(null, { code, message: 'Function not installed' })
      await expect(executeExternalAction(action, f.service, runtime)).rejects.toThrow()
      expect(f.remove).not.toHaveBeenCalled()
    }
  })
})
