import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hashStaffInvitationToken } from '../../supabase/functions/_shared/staffInvitation'
const api = vi.hoisted(() => ({
  createClient: vi.fn(),
  store: vi.fn(),
  send: vi.fn(),
  prepare: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: api.createClient }))
vi.mock('../../supabase/functions/_shared/email.ts', () => ({
  loadEmailTemplate: async () => ({}),
  loadEmailBusiness: async () => ({}),
  prepareEmail: api.prepare,
  sendViaResend: api.send,
}))
let handler: (request: Request) => Promise<Response>
const userId = '75000000-0000-0000-0000-000000000001'
beforeEach(async () => {
  vi.resetModules()
  api.store.mockReset().mockResolvedValue({ error: null })
  api.insert.mockReset().mockResolvedValue({ error: null })
  api.send.mockReset().mockResolvedValue(undefined)
  api.prepare.mockReset().mockReturnValue({ message: 'prepared' })
  api.remove.mockReset().mockReturnValue({ eq: async () => ({ error: null }) })
  api.createClient.mockReset().mockReturnValue({
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
      admin: {
        generateLink: async () => ({
          data: {
            user: { id: userId },
            properties: { hashed_token: 'expiring-token-not-to-be-mailed' },
          },
          error: null,
        }),
        deleteUser: async () => ({ error: null }),
      },
    },
    from: (table: string) => {
      if (table === 'staff_invitations') return { upsert: api.store }
      return {
        insert: api.insert,
        delete: api.remove,
        select: () => ({
          eq: (column: string) => ({
            single: async () => ({
              data:
                table === 'barbers'
                  ? { id: 'test-barber' }
                  : { role: 'owner', account_enabled: true },
              error: null,
            }),
            maybeSingle: async () => ({ data: column === 'barber_id' ? null : {}, error: null }),
          }),
        }),
      }
    },
  })
  vi.stubGlobal('Deno', {
    env: { get: () => 'unit-config' },
    serve: (callback: typeof handler) => {
      handler = callback
    },
  })
  await vi.importActual('../../supabase/functions/admin-create-barber/index.ts')
})
afterEach(() => vi.unstubAllGlobals())

function invite(): Promise<Response> {
  return handler(
    new Request('https://edge.example.test', {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token' },
      body: JSON.stringify({ email: 'staff@example.test', barber_id: 'test-barber', lang: 'sv' }),
    }),
  )
}

it('mails a fresh capability only after persisting its digest, never the expiring Auth token', async () => {
  const response = await invite()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  const href = api.prepare.mock.calls[0]?.[1].ctaHref as string
  const token = new URL(href).hash.slice('#staff_invite='.length)
  expect(token).toMatch(/^[a-f0-9]{64}$/)
  expect(href).not.toContain('expiring-token-not-to-be-mailed')
  expect(api.store).toHaveBeenCalledWith(
    {
      user_id: userId,
      token_hash: await hashStaffInvitationToken(token),
      created_at: expect.any(String),
    },
    { onConflict: 'user_id' },
  )
  expect(api.store.mock.invocationCallOrder[0]).toBeLessThan(
    api.send.mock.invocationCallOrder[0] ?? 0,
  )
})

it('does not mail an invitation that was not persisted', async () => {
  api.store.mockResolvedValue({ error: { code: 'storage_failed' } })
  expect((await invite()).status).toBe(502)
  expect(api.send).not.toHaveBeenCalled()
  expect(api.remove).toHaveBeenCalled()
})
