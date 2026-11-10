import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hashStaffInvitationToken } from '../../supabase/functions/_shared/staffInvitation'
const api = vi.hoisted(() => ({
  createClient: vi.fn(),
  store: vi.fn(),
  send: vi.fn(),
  prepare: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
  linkedProfile: vi.fn(),
  storedInvitation: vi.fn(),
  /** The profile of the auth user the invite link resolved to, read after a failed insert. */
  existingProfile: vi.fn(),
  deleteUser: vi.fn(),
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
  api.rpc.mockReset().mockResolvedValue({ data: null, error: null })
  api.linkedProfile.mockReset().mockResolvedValue({ data: null, error: null })
  api.storedInvitation.mockReset().mockResolvedValue({ data: { user_id: userId }, error: null })
  api.existingProfile.mockReset().mockResolvedValue({ data: null, error: null })
  api.deleteUser.mockReset().mockResolvedValue({ error: null })
  api.createClient.mockReset().mockReturnValue({
    rpc: api.rpc,
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
        getUserById: async () => ({
          data: { user: { id: userId, email: 'staff@example.test', email_confirmed_at: null } },
          error: null,
        }),
        deleteUser: api.deleteUser,
      },
    },
    from: (table: string) => {
      if (table === 'staff_invitations')
        return {
          upsert: api.store,
          select: () => ({ eq: () => ({ maybeSingle: api.storedInvitation }) }),
        }
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
            maybeSingle: async () =>
              column === 'barber_id' ? api.linkedProfile() : api.existingProfile(),
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
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** One real turn of the event loop, also while `setTimeout` is faked. */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
/** Polls until `reached`: hashing the invitation token takes an unknown number of turns. */
async function until(reached: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!reached() && Date.now() < deadline) await turn()
}
const never = (): Promise<never> => new Promise(() => undefined)
/** Fakes only the clock of the admin log bound; the request runs as it does. */
const fakeTheBound = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

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
  expect(api.rpc).not.toHaveBeenCalled()
})

const entry = (action: string, table: string, detail: { changed: string[] } | null = null) => [
  'internal_record_admin_action',
  {
    p_actor: 'owner',
    p_action: action,
    p_target_table: table,
    p_target_id: userId,
    p_detail: detail,
  },
]

it('records the new account and its invitation under the owner after the invite is delivered', async () => {
  const response = await invite()

  expect(response.status).toBe(200)
  expect(api.rpc.mock.calls).toEqual([
    entry('insert', 'profiles'),
    entry('insert', 'staff_invitations'),
  ])
  expect(api.send.mock.invocationCallOrder[0]).toBeLessThan(
    api.rpc.mock.invocationCallOrder[0] ?? 0,
  )
  // A new account has no earlier invitation to look for.
  expect(api.storedInvitation).not.toHaveBeenCalled()
})

it('records nothing when the mail fails and the new account is removed again', async () => {
  api.send.mockRejectedValue(new Error('mail provider down'))

  const response = await invite()

  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ ok: false, error: 'invite_send_failed' })
  expect(api.remove).toHaveBeenCalled()
  expect(api.rpc).not.toHaveBeenCalled()
})

it('records nothing when the profile could not be linked', async () => {
  api.insert.mockResolvedValue({ error: { message: 'duplicate key' } })

  const response = await invite()

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ ok: false, error: 'link_failed' })
  expect(api.rpc).not.toHaveBeenCalled()
})

// The invite link can resolve to an auth user that existed before, whose profile fails the insert:
// the cleanup after a failed insert must never remove such an account.

it('removes the account it created when the profile insert fails and no profile exists for it', async () => {
  api.insert.mockResolvedValue({ error: { message: 'duplicate key' } })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  const response = await invite()

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ ok: false, error: 'link_failed' })
  expect(api.existingProfile).toHaveBeenCalledOnce()
  expect(api.insert.mock.invocationCallOrder[0]).toBeLessThan(
    api.existingProfile.mock.invocationCallOrder[0] ?? 0,
  )
  expect(api.deleteUser.mock.calls).toEqual([[userId]])
  expect(api.existingProfile.mock.invocationCallOrder[0]).toBeLessThan(
    api.deleteUser.mock.invocationCallOrder[0] ?? 0,
  )
})

it('removes nothing and says the address is taken when the account already has a profile', async () => {
  api.insert.mockResolvedValue({ error: { message: 'duplicate key' } })
  api.existingProfile.mockResolvedValue({ data: { id: userId }, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  const response = await invite()

  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ ok: false, error: 'email_taken' })
  expect(api.deleteUser).not.toHaveBeenCalled()
  expect(api.remove).not.toHaveBeenCalled()
  expect(api.rpc).not.toHaveBeenCalled()
  expect(api.store).not.toHaveBeenCalled()
  expect(api.send).not.toHaveBeenCalled()
})

it.each([
  [
    'answers with an error',
    () => ({ data: null, error: { code: '57014', message: `statement timeout for ${userId}` } }),
    '57014',
  ],
  ['throws', () => Promise.reject(new TypeError('fetch failed')), 'TypeError'],
])('removes nothing when the read of the existing profile %s', async (_, failure, code) => {
  api.insert.mockResolvedValue({ error: { message: 'duplicate key' } })
  api.existingProfile.mockImplementation(failure)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  const response = await invite()

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ ok: false, error: 'link_failed' })
  expect(api.deleteUser).not.toHaveBeenCalled()
  expect(api.rpc).not.toHaveBeenCalled()
  expect(logged.mock.calls).toEqual([
    ['admin-create-barber: profiles insert failed:', 'duplicate key'],
    ['admin-create-barber: profile lookup failed:', code],
  ])
})

it('removes nothing when the read of the existing profile never answers, and answers after 3 seconds', async () => {
  api.insert.mockResolvedValue({ error: { message: 'duplicate key' } })
  api.existingProfile.mockImplementation(never)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const answered = vi.fn()
  fakeTheBound()

  const response = invite()
  void response.then(answered)
  await until(() => api.existingProfile.mock.calls.length >= 1)
  await vi.advanceTimersByTimeAsync(2999)
  expect(answered).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  vi.useRealTimers()

  expect((await response).status).toBe(500)
  expect(api.deleteUser).not.toHaveBeenCalled()
  expect(api.rpc).not.toHaveBeenCalled()
  expect(logged.mock.calls).toEqual([
    ['admin-create-barber: profiles insert failed:', 'duplicate key'],
    ['admin-create-barber: profile lookup failed:', 'timeout'],
  ])
})

it.each([
  [
    'refuses the entry',
    () => ({ data: null, error: { code: '22023', message: `actor for ${userId} is unknown` } }),
    '22023',
  ],
  [
    'cannot be reached',
    () => Promise.reject(new TypeError('fetch failed for staff@example.test')),
    'TypeError',
  ],
])('answers exactly the same when the admin log %s', async (_, failure, code) => {
  const expected = await invite()
  const expectedBody = await expected.text()
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  api.rpc.mockImplementation(failure)

  const response = await invite()

  expect(response.status).toBe(expected.status)
  expect(await response.text()).toBe(expectedBody)
  expect([...response.headers]).toEqual([...expected.headers])
  expect(expectedBody).toBe('{"ok":true}')
  expect(logged.mock.calls).toEqual([
    ['admin-create-barber: admin log write failed:', code],
    ['admin-create-barber: admin log write failed:', code],
  ])
})

it('records a re-sent invite as a changed invitation and no new account', async () => {
  api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })

  const response = await invite()

  expect(response.status).toBe(200)
  expect(api.insert).not.toHaveBeenCalled()
  expect(api.rpc.mock.calls).toEqual([
    entry('update', 'staff_invitations', { changed: ['token_hash', 'created_at'] }),
  ])
  // Read before the new digest is stored: afterwards a row always exists.
  expect(api.storedInvitation.mock.invocationCallOrder[0]).toBeLessThan(
    api.store.mock.invocationCallOrder[0] ?? 0,
  )
})

it('records a re-sent invite as a created invitation when none was stored', async () => {
  api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })
  api.storedInvitation.mockResolvedValue({ data: null, error: null })

  expect((await invite()).status).toBe(200)
  expect(api.rpc.mock.calls).toEqual([entry('insert', 'staff_invitations')])
})

it.each([
  [
    'answers with an error',
    () => ({ data: null, error: { code: 'PGRST301', message: `no access to ${userId}` } }),
    'PGRST301',
  ],
  ['throws', () => Promise.reject(new TypeError('fetch failed')), 'TypeError'],
])(
  'still re-sends the invite and guesses no entry when the earlier invitation read %s',
  async (_, failure, code) => {
    api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })
    api.storedInvitation.mockImplementation(failure)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await invite()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(api.send).toHaveBeenCalledOnce()
    expect(api.rpc).not.toHaveBeenCalled()
    expect(logged.mock.calls).toEqual([['admin-create-barber: invitation precheck failed:', code]])
  },
)

// A re-send whose mail fails has already replaced the stored invitation, so the change is recorded.
it.each([
  [
    'a changed invitation',
    { data: { user_id: userId }, error: null },
    entry('update', 'staff_invitations', { changed: ['token_hash', 'created_at'] }),
  ],
  [
    'a created invitation when none was stored',
    { data: null, error: null },
    entry('insert', 'staff_invitations'),
  ],
])(
  'records a re-sent invite whose mail fails as %s, and keeps the account',
  async (_, earlier, recorded) => {
    api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })
    api.storedInvitation.mockResolvedValue(earlier)
    api.send.mockRejectedValue(new Error('mail provider down'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await invite()

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ ok: false, error: 'invite_send_failed' })
    expect(api.remove).not.toHaveBeenCalled()
    expect(api.deleteUser).not.toHaveBeenCalled()
    expect(api.rpc.mock.calls).toEqual([recorded])
    expect(api.send.mock.invocationCallOrder[0]).toBeLessThan(
      api.rpc.mock.invocationCallOrder[0] ?? 0,
    )
  },
)

it('records nothing for a re-sent invite whose invitation could not be stored', async () => {
  api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })
  api.store.mockResolvedValue({ error: { code: 'storage_failed' } })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  const response = await invite()

  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ ok: false, error: 'invite_send_failed' })
  // The earlier invitation still stands, so nothing changed.
  expect(api.send).not.toHaveBeenCalled()
  expect(api.rpc).not.toHaveBeenCalled()
  expect(api.remove).not.toHaveBeenCalled()
})

it.each([
  [
    'refuses the entry',
    () => ({ data: null, error: { code: '22023', message: `actor for ${userId} is unknown` } }),
    '22023',
  ],
  ['cannot be reached', () => Promise.reject(new TypeError('fetch failed')), 'TypeError'],
])(
  'answers a re-sent invite whose mail fails exactly the same when the admin log %s',
  async (_, failure, code) => {
    api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })
    api.send.mockRejectedValue(new Error('mail provider down'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const expected = await invite()
    const expectedBody = await expected.text()
    logged.mockClear()
    api.rpc.mockImplementation(failure)

    const response = await invite()

    expect(response.status).toBe(expected.status)
    expect(await response.text()).toBe(expectedBody)
    expect([...response.headers]).toEqual([...expected.headers])
    expect(expectedBody).toBe('{"ok":false,"error":"invite_send_failed"}')
    expect(logged.mock.calls).toEqual([
      ['admin-create-barber: invite delivery failed:', 'mail provider down'],
      ['admin-create-barber: admin log write failed:', code],
    ])
  },
)

/** Holds each admin log answer until the test releases it, in call order. */
function heldAdminLog(): (() => void)[] {
  const releases: (() => void)[] = []
  api.rpc.mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(() => resolve({ data: null, error: null }))
      }),
  )
  return releases
}

it('answers a delivered invite only once both of its entries are written, one after the other', async () => {
  const releases = heldAdminLog()
  const answered = vi.fn()

  const response = invite()
  void response.then(answered)
  await until(() => api.rpc.mock.calls.length >= 1)
  await turn()

  expect(api.rpc.mock.calls).toEqual([entry('insert', 'profiles')])
  expect(answered).not.toHaveBeenCalled()

  releases[0]?.()
  await until(() => api.rpc.mock.calls.length >= 2)
  await turn()

  expect(api.rpc.mock.calls).toEqual([
    entry('insert', 'profiles'),
    entry('insert', 'staff_invitations'),
  ])
  expect(answered).not.toHaveBeenCalled()

  releases[1]?.()
  expect((await response).status).toBe(200)
})

it.each([
  ['delivered', () => undefined, 200],
  ['failed', () => api.send.mockRejectedValue(new Error('mail provider down')), 502],
])(
  'answers a re-sent invite whose mail is %s only once its entry is written',
  async (_, arrange, status) => {
    api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })
    arrange()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const releases = heldAdminLog()
    const answered = vi.fn()

    const response = invite()
    void response.then(answered)
    await until(() => api.rpc.mock.calls.length >= 1)
    await turn()

    expect(api.rpc).toHaveBeenCalledOnce()
    expect(answered).not.toHaveBeenCalled()

    releases[0]?.()
    expect((await response).status).toBe(status)
  },
)

it('answers a delivered invite exactly the same when the admin log never answers, 3 seconds an entry', async () => {
  const expected = await invite()
  const expectedBody = await expected.text()
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  api.rpc.mockClear()
  api.rpc.mockImplementation(never)
  const answered = vi.fn()
  fakeTheBound()

  const response = invite()
  void response.then(answered)
  await until(() => api.rpc.mock.calls.length >= 1)
  await vi.advanceTimersByTimeAsync(2999)
  expect(api.rpc).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  await until(() => api.rpc.mock.calls.length >= 2)
  await vi.advanceTimersByTimeAsync(2999)
  expect(answered).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  vi.useRealTimers()

  const actual = await response
  expect(actual.status).toBe(expected.status)
  expect(await actual.text()).toBe(expectedBody)
  expect([...actual.headers]).toEqual([...expected.headers])
  expect(expectedBody).toBe('{"ok":true}')
  expect(logged.mock.calls).toEqual([
    ['admin-create-barber: admin log write failed:', 'timeout'],
    ['admin-create-barber: admin log write failed:', 'timeout'],
  ])
})

it('still re-sends the invite and guesses no entry when the earlier invitation read never answers', async () => {
  api.linkedProfile.mockResolvedValue({ data: { id: userId }, error: null })
  api.storedInvitation.mockImplementation(never)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  fakeTheBound()

  const response = invite()
  await until(() => api.storedInvitation.mock.calls.length >= 1)
  await vi.advanceTimersByTimeAsync(2999)
  // The invite waits for that read, and no longer than 3 seconds.
  expect(api.store).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  vi.useRealTimers()

  const actual = await response
  expect(actual.status).toBe(200)
  expect(await actual.json()).toEqual({ ok: true })
  expect(api.send).toHaveBeenCalledOnce()
  expect(api.rpc).not.toHaveBeenCalled()
  expect(logged.mock.calls).toEqual([
    ['admin-create-barber: invitation precheck failed:', 'timeout'],
  ])
})
