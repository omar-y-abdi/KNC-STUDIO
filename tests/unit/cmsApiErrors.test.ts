import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, expect, it, vi } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { cmsApi } from '../../src/admin/cms/api'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ functions: { invoke } }),
}))
beforeEach(() => invoke.mockReset())

it.each([409, 422])('retains HTTP %s and the server explanation', async (status) => {
  const response = new Response(JSON.stringify({ message: 'Server explanation' }), { status })
  const error = new FunctionsHttpError(response)
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.validate(emptyDocument())).rejects.toMatchObject({
    message: 'Server explanation',
    context: { status },
  })
  expect(response.bodyUsed).toBe(false)
})

it('retains the HTTP error when the response is not JSON', async () => {
  const error = new FunctionsHttpError(new Response('Unavailable', { status: 503 }))
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.state()).rejects.toBe(error)
})

it('does not turn a network failure into a revision conflict', async () => {
  const error = new Error('Network unavailable')
  invoke.mockResolvedValue({ data: null, error })
  await expect(cmsApi.state()).rejects.toBe(error)
})
