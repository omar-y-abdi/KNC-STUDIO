import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  settleExternalAction,
  type ExternalAction,
  type ExternalActionService,
} from '../../supabase/functions/_shared/externalActions'

type RpcResult = Awaited<ReturnType<ExternalActionService['rpc']>>

const action: ExternalAction = {
  id: '00000000-0000-4000-8000-000000000011',
  dispatch_token: '00000000-0000-4000-8000-000000000012',
  action_type: 'storage_object_delete',
  bucket: 'gallery',
  path: 'salon/registered.webp',
}

/** A service-role client whose retention lookup answers from a queue, one result per call. */
function outboxClient(retentionResults: readonly RpcResult[]) {
  const pendingRetention = [...retentionResults]
  const remove = vi.fn(async () => ({ error: null }))
  const rpc = vi.fn(async (name: string): Promise<RpcResult> => {
    if (name === 'internal_cms_media_retained') {
      const next = pendingRetention.shift()
      if (next === undefined) throw new Error('unexpected retention lookup')
      return next
    }
    return { data: true, error: null }
  })
  const service = {
    rpc,
    storage: { from: () => ({ remove }) },
    auth: { admin: { updateUserById: vi.fn(), deleteUser: vi.fn() } },
  } as unknown as ExternalActionService
  const calls = (name: string) => rpc.mock.calls.filter(([called]) => called === name)
  return { service, remove, calls }
}

const lookupErrors = [
  { code: 'PGRST202', message: 'Could not find the function internal_cms_media_retained' },
  { code: '42883', message: 'function public.internal_cms_media_retained does not exist' },
  { code: '42501', message: 'permission denied' },
  { code: 'PGRST000', message: 'upstream timeout' },
] as const

describe('external action settlement when the CMS retention lookup fails', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(lookupErrors)(
    'fails the job for retry on lookup error $code without touching Storage',
    async (error) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const client = outboxClient([{ data: null, error }])

      const settlement = await settleExternalAction(action, client.service, {
        googleClientId: undefined,
        googleClientSecret: undefined,
      })

      expect(settlement).toEqual({ status: 'failed', code: 'external_action_failed' })
      expect(client.remove).not.toHaveBeenCalled()
      expect(client.calls('complete_external_action')).toHaveLength(0)
      expect(client.calls('block_external_action')).toHaveLength(0)
      expect(client.calls('fail_external_action')).toEqual([
        [
          'fail_external_action',
          {
            p_id: action.id,
            p_dispatch_token: action.dispatch_token,
            p_error_code: 'external_action_failed',
          },
        ],
      ])
    },
  )

  it('deletes and completes on the retry once the lookup answers "not retained"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const client = outboxClient([
      { data: null, error: lookupErrors[0] },
      { data: false, error: null },
    ])
    const runtime = { googleClientId: undefined, googleClientSecret: undefined }

    expect(await settleExternalAction(action, client.service, runtime)).toEqual({
      status: 'failed',
      code: 'external_action_failed',
    })
    expect(await settleExternalAction(action, client.service, runtime)).toEqual({
      status: 'completed',
    })

    expect(client.remove).toHaveBeenCalledTimes(1)
    expect(client.remove).toHaveBeenCalledWith(['salon/registered.webp'])
    expect(client.calls('fail_external_action')).toHaveLength(1)
    expect(client.calls('complete_external_action')).toHaveLength(1)
  })

  it('completes a retained object without deleting its bytes', async () => {
    const client = outboxClient([{ data: true, error: null }])

    const settlement = await settleExternalAction(action, client.service, {
      googleClientId: undefined,
      googleClientSecret: undefined,
    })

    expect(settlement).toEqual({ status: 'completed' })
    expect(client.remove).not.toHaveBeenCalled()
    expect(client.calls('fail_external_action')).toHaveLength(0)
    expect(client.calls('complete_external_action')).toHaveLength(1)
  })
})
