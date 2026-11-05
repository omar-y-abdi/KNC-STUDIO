import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUserById: vi.fn(),
  generateLink: vi.fn(),
  createClient: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: api.createClient }))
let handler: (request: Request) => Promise<Response>
const token = 'a'.repeat(64)
const userId = '31000000-0000-0000-0000-000000000002'

beforeEach(async () => {
  vi.resetModules()
  api.rpc.mockReset().mockResolvedValue({ data: userId, error: null })
  api.getUserById.mockReset().mockResolvedValue({
    data: { user: { id: userId, email: 'staff@example.test', email_confirmed_at: null } },
    error: null,
  })
  api.generateLink.mockReset().mockResolvedValue({
    data: { user: { id: userId }, properties: { hashed_token: 'short-lived-auth-token' } },
    error: null,
  })
  api.createClient.mockReset().mockReturnValue({
    rpc: api.rpc,
    auth: { admin: { getUserById: api.getUserById, generateLink: api.generateLink } },
  })
  vi.stubGlobal('Deno', {
    env: {
      get: (name: string) =>
        ({ SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'unit-service' })[
          name
        ],
    },
    serve: (callback: typeof handler) => {
      handler = callback
    },
  })
  await vi.importActual('../../supabase/functions/redeem-staff-invite/index.ts')
})
afterEach(() => vi.unstubAllGlobals())

function redeem(body: unknown = { token }): Promise<Response> {
  return handler(
    new Request('https://edge.example.test/redeem-staff-invite', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
}

describe('durable staff invitation exchange', () => {
  it('consumes the hashed invitation before minting a short-lived Auth token', async () => {
    const response = await redeem()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true, token_hash: 'short-lived-auth-token' })
    expect(api.rpc).toHaveBeenCalledWith('consume_staff_invitation', {
      p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(api.rpc.mock.calls[0]?.[1].p_token_hash).not.toBe(token)
    expect(api.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      api.generateLink.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it.each([null, false])(
    'does not mint a token for unknown, used, revoked or disabled invitations (%s)',
    async (data) => {
      api.rpc.mockResolvedValue({ data, error: null })
      expect((await redeem()).status).toBe(400)
      expect(api.getUserById).not.toHaveBeenCalled()
      expect(api.generateLink).not.toHaveBeenCalled()
    },
  )

  it('fails closed on database failure', async () => {
    api.rpc.mockResolvedValue({ data: null, error: { message: 'failed' } })
    expect((await redeem()).status).toBe(503)
    expect(api.generateLink).not.toHaveBeenCalled()
  })

  it.each([{ token: 'x' }, { token, extra: true }, { token: null }])(
    'rejects malformed requests before lookup',
    async (body) => {
      expect((await redeem(body)).status).toBe(400)
      expect(api.rpc).not.toHaveBeenCalled()
    },
  )

  it('cannot activate an already confirmed account', async () => {
    api.getUserById.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: 'staff@example.test',
          email_confirmed_at: '2020-01-01T00:00:00Z',
        },
      },
      error: null,
    })
    expect((await redeem()).status).toBe(400)
    expect(api.generateLink).not.toHaveBeenCalled()
  })

  it('does not return a token generated for a different user', async () => {
    api.generateLink.mockResolvedValue({
      data: { user: { id: 'wrong-user' }, properties: { hashed_token: 'never-return-this' } },
      error: null,
    })
    const response = await redeem()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('never-return-this')
  })

  it('allows only one concurrent caller to mint an Auth token', async () => {
    let pending = true
    api.rpc.mockImplementation(async () => {
      const data = pending ? userId : null
      pending = false
      return { data, error: null }
    })
    const responses = await Promise.all([redeem(), redeem()])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
    expect(api.generateLink).toHaveBeenCalledTimes(1)
  })

  it('does not consume invitations on GET or preflight', async () => {
    expect(
      (await handler(new Request('https://edge.example.test', { method: 'GET' }))).status,
    ).toBe(405)
    expect(
      (await handler(new Request('https://edge.example.test', { method: 'OPTIONS' }))).status,
    ).toBe(200)
    expect(api.rpc).not.toHaveBeenCalled()
  })
})
