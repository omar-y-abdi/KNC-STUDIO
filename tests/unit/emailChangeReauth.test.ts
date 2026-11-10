import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  profile: vi.fn(),
  rpc: vi.fn(),
  generateLink: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  prepare: vi.fn(),
  send: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: api.createClient }))
vi.mock('../../supabase/functions/_shared/email.ts', () => ({
  loadEmailTemplate: async () => ({}),
  loadEmailBusiness: async () => ({}),
  prepareEmail: api.prepare,
  sendViaResend: api.send,
}))

const USER = '63000000-0000-4000-8000-000000000001'
const PASSWORD = ' Correct-Horse 42! '
/** The access token of the session the password check opens. */
const TEMPORARY = 'temporary-access-token'
let handler: (request: Request) => Promise<Response>
let config: Record<string, string>

beforeEach(async () => {
  vi.resetModules()
  api.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: USER, email: 'staff@example.test' } }, error: null })
  api.profile.mockReset().mockResolvedValue({ data: { account_enabled: true }, error: null })
  api.rpc.mockReset().mockResolvedValue({ data: true, error: null })
  api.generateLink
    .mockReset()
    .mockResolvedValue({ data: { properties: { hashed_token: 'a'.repeat(64) } }, error: null })
  api.signIn.mockReset().mockResolvedValue({
    data: { user: { id: USER }, session: { access_token: TEMPORARY } },
    error: null,
  })
  api.signOut.mockReset().mockResolvedValue({ data: null, error: null })
  api.prepare.mockReset().mockReturnValue({ message: 'prepared' })
  api.send.mockReset().mockResolvedValue(undefined)
  const service = {
    auth: { getUser: api.getUser, admin: { generateLink: api.generateLink } },
    from: () => ({ select: () => ({ eq: () => ({ single: api.profile }) }) }),
    rpc: api.rpc,
  }
  // No `auth.signOut`: it reports a refused revocation as success.
  const reauth = { auth: { signInWithPassword: api.signIn, admin: { signOut: api.signOut } } }
  api.createClient.mockReset().mockImplementation((_url: string, key: string) => {
    if (key === 'unit-service') return service
    if (key === 'unit-anon') return reauth
    throw new Error('Unexpected Supabase key')
  })
  config = {
    SUPABASE_URL: 'https://db.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'unit-service',
    SUPABASE_ANON_KEY: 'unit-anon',
    RESEND_API_KEY: 'unit-resend',
  }
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request')
    }),
  )
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => config[name] },
    serve: (callback: typeof handler) => {
      handler = callback
    },
  })
  // Deno entrypoints have a separate type-check gate; this exercises their HTTP boundary in Node.
  await vi.importActual('../../supabase/functions/send-email-change/index.ts')
})
afterEach(() => {
  vi.mocked(console.error).mockRestore()
  vi.unstubAllGlobals()
})

function change(
  body: unknown = { new_email: 'New@Example.test', current_password: PASSWORD, lang: 'en' },
  headers: Record<string, string> = { authorization: 'Bearer staff-token' },
): Promise<Response> {
  return handler(
    new Request('https://edge.example.test/send-email-change', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

const refusedSignIn = (status: number | undefined, code: string | undefined) => ({
  data: { user: null, session: null },
  error: { status, code, message: 'Auth refused the sign-in' },
})

async function expectPasswordKeptIn(response: Response): Promise<void> {
  const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
  expect(await response.clone().text()).not.toContain(PASSWORD.trim())
  expect(logged).not.toContain(PASSWORD.trim())
}

describe('email change requires the current password', () => {
  it('sends the link after the caller proved the password of their own account', async () => {
    const response = await change()
    expect(response.status).toBe(200)
    expect(await response.clone().json()).toEqual({ ok: true })
    expect(api.createClient).toHaveBeenCalledWith('https://db.example.test', 'unit-anon', {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // The address comes from the verified token; the password is passed on untrimmed.
    expect(api.signIn.mock.calls).toEqual([[{ email: 'staff@example.test', password: PASSWORD }]])
    // Only the check's own session is revoked.
    expect(api.signOut.mock.calls).toEqual([[TEMPORARY, 'local']])
    expect(api.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'email_change_new',
        email: 'staff@example.test',
        newEmail: 'new@example.test',
      }),
    )
    const order = [api.rpc, api.signIn, api.signOut, api.generateLink, api.send].map(
      (step) => step.mock.invocationCallOrder[0] ?? 0,
    )
    expect(order.every((at) => at > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    await expectPasswordKeptIn(response)
  })

  it('answers refused credentials as a wrong password and sends nothing', async () => {
    api.signIn.mockResolvedValue(refusedSignIn(400, 'invalid_credentials'))
    const response = await change()
    expect(response.status).toBe(200)
    expect(await response.clone().json()).toEqual({ ok: false, error: 'wrong_password' })
    expect(api.signOut).not.toHaveBeenCalled()
    expect(api.generateLink).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
    expect(vi.mocked(console.error)).not.toHaveBeenCalled()
    await expectPasswordKeptIn(response)
  })

  it.each(['user_banned', 'email_not_confirmed', 'captcha_failed', 'validation_failed', undefined])(
    'does not call another refusal of the sign-in (%s) a wrong password',
    async (code) => {
      api.signIn.mockResolvedValue(refusedSignIn(400, code))
      const response = await change()
      expect(response.status).toBe(503)
      expect(await response.clone().json()).toEqual({ ok: false, error: 'reauth_unavailable' })
      expect(api.generateLink).not.toHaveBeenCalled()
      expect(api.send).not.toHaveBeenCalled()
      expect(vi.mocked(console.error).mock.calls).toEqual([
        ['send-email-change reauth:', 400, code ?? 'unknown'],
      ])
      await expectPasswordKeptIn(response)
    },
  )

  it('spends the one-a-minute allowance of the account before it checks a password', async () => {
    api.signIn.mockResolvedValue(refusedSignIn(400, 'invalid_credentials'))
    await change()
    expect(api.rpc.mock.calls).toEqual([
      [
        'consume_auth_email_send',
        { p_kind: 'email_change', p_scope_hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      ],
    ])
    expect(api.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      api.signIn.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it.each([
    { data: false, error: null },
    { data: null, error: { code: 'XX000' } },
  ])('checks no password while the account is rate limited: %j', async (limited) => {
    api.rpc.mockResolvedValue(limited)
    const response = await change()
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ ok: false, error: 'rate_limited' })
    expect(api.signIn).not.toHaveBeenCalled()
    expect(api.generateLink).not.toHaveBeenCalled()
  })

  it.each([429, 500, 503, 0, undefined])(
    'sends nothing when Auth cannot check the password (status %s)',
    async (status) => {
      api.signIn.mockResolvedValue(refusedSignIn(status, 'unexpected_failure'))
      const response = await change()
      expect(response.status).toBe(503)
      expect(await response.clone().json()).toEqual({ ok: false, error: 'reauth_unavailable' })
      expect(api.generateLink).not.toHaveBeenCalled()
      await expectPasswordKeptIn(response)
    },
  )

  // 401, 403 and 404 are the answers `auth.signOut` would have reported as success.
  it.each([401, 403, 404, 500, undefined])(
    'sends nothing when revoking the temporary session is refused (status %s)',
    async (status) => {
      api.signOut.mockResolvedValue({ data: null, error: { status, message: 'refused' } })
      const response = await change()
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ ok: false, error: 'reauth_unavailable' })
      expect(api.signOut.mock.calls).toEqual([[TEMPORARY, 'local']])
      expect(api.generateLink).not.toHaveBeenCalled()
      expect(api.send).not.toHaveBeenCalled()
    },
  )

  it('sends nothing when the password signed in another account, and still revokes that session', async () => {
    api.signIn.mockResolvedValue({
      data: { user: { id: 'another-user' }, session: { access_token: TEMPORARY } },
      error: null,
    })
    const response = await change()
    expect(response.status).toBe(503)
    expect(api.signOut.mock.calls).toEqual([[TEMPORARY, 'local']])
    expect(api.generateLink).not.toHaveBeenCalled()
  })

  it.each([
    { new_email: 'new@example.test', lang: 'en' },
    { new_email: 'new@example.test', current_password: '', lang: 'en' },
    { new_email: 'new@example.test', current_password: 'p'.repeat(73), lang: 'en' },
    { new_email: 'new@example.test', current_password: 12345678, lang: 'en' },
    { new_email: 'new@example.test', current_password: null, lang: 'en' },
    { new_email: 'new@example.test', current_password: PASSWORD, lang: 'en', extra: true },
  ])('rejects a request without a usable current password: %j', async (body) => {
    const response = await change(body)
    expect(response.status).toBe(400)
    expect(await response.clone().json()).toEqual({ ok: false, error: 'invalid_payload' })
    expect(api.rpc).not.toHaveBeenCalled()
    expect(api.signIn).not.toHaveBeenCalled()
    expect(api.generateLink).not.toHaveBeenCalled()
    await expectPasswordKeptIn(response)
  })

  it('keeps every earlier gate ahead of the password check', async () => {
    const anonymous = await change(undefined, {})
    expect(anonymous.status).toBe(401)
    api.profile.mockResolvedValueOnce({ data: { account_enabled: false }, error: null })
    expect((await change()).status).toBe(403)
    const same = await change({
      new_email: 'STAFF@example.test',
      current_password: PASSWORD,
      lang: 'sv',
    })
    expect(same.status).toBe(400)
    expect(await same.json()).toEqual({ ok: false, error: 'same_email' })
    const invalid = await change({ new_email: 'nobody', current_password: PASSWORD, lang: 'sv' })
    expect(await invalid.json()).toEqual({ ok: false, error: 'invalid_email' })
    expect(api.rpc).not.toHaveBeenCalled()
    expect(api.signIn).not.toHaveBeenCalled()
  })

  it('is not configured without the key the password check signs in with', async () => {
    delete config['SUPABASE_ANON_KEY']
    const response = await change()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'not_configured' })
    expect(api.createClient).not.toHaveBeenCalled()
  })

  it('lets the panel read a refused password and a sent link alike', async () => {
    const headers = { authorization: 'Bearer staff-token', origin: 'https://bladeblendstudio.se' }
    const sent = await change(undefined, headers)
    api.rpc.mockResolvedValue({ data: true, error: null })
    api.signIn.mockResolvedValue(refusedSignIn(400, 'invalid_credentials'))
    const refused = await change(undefined, headers)
    for (const response of [sent, refused]) {
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://bladeblendstudio.se',
      )
      expect(response.headers.get('vary')).toBe('Origin')
    }
  })
})
