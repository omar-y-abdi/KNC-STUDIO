// calendar-disconnect and the admin log. The function marks the barber's calendar link for
// disconnect with the service role, so it says itself who asked: the signed-in barber, once, after
// the mark is set, and never for a request that marked nothing. A failed entry changes no answer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getUser: vi.fn(), profile: vi.fn(), rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: api.getUser },
    rpc: api.rpc,
    from: () => {
      const query = { select: () => query, eq: () => query, single: api.profile }
      return query
    },
  }),
}))

const STAFF = '77777777-7777-4777-8777-777777777771'
const AUDIT = 'internal_record_admin_action'
const PREPARE = 'prepare_calendar_disconnect'

let handler: (request: Request) => Promise<Response>
/** What `prepare_calendar_disconnect` and the admin log answer in the test at hand. */
let prepared: () => unknown
let audited: () => unknown

beforeEach(async () => {
  vi.resetModules()
  prepared = () => ({
    data: { ok: true, pending: true, calendar_events: 2, action_id: 'action-1' },
    error: null,
  })
  audited = () => ({ data: null, error: null })
  api.getUser.mockReset().mockResolvedValue({ data: { user: { id: STAFF } }, error: null })
  api.profile.mockReset().mockResolvedValue({
    data: { role: 'barber', barber_id: 'victor', account_enabled: true },
    error: null,
  })
  api.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === PREPARE) return prepared()
    if (name === AUDIT) return audited()
    throw new Error(`Unexpected RPC: ${name}`)
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request')
    }),
  )
  vi.stubGlobal('Deno', {
    env: { get: () => 'unit-config' },
    serve: (callback: typeof handler) => {
      handler = callback
    },
  })
  // Deno entrypoints have a separate type-check gate; this exercises their HTTP boundary in Node.
  await vi.importActual('../../supabase/functions/calendar-disconnect/index.ts')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Let everything that can run without a further answer run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
/** An answer that never comes. */
const never = (): Promise<never> => new Promise(() => undefined)
/** Only the clock of the admin log bound is faked; the request and its answer run as they do. */
const fakeTheBound = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

function disconnect(authorization = 'Bearer barber-token'): Promise<Response> {
  return handler(
    new Request('https://edge.example.test/calendar-disconnect', {
      method: 'POST',
      headers: { authorization, origin: 'https://bladeblendstudio.se' },
      body: '{}',
    }),
  )
}

const auditCalls = () => api.rpc.mock.calls.filter(([name]) => name === AUDIT)
const answer = async (response: Response) => [
  response.status,
  [...response.headers],
  await response.text(),
]

describe('calendar-disconnect admin log', () => {
  it('records the barber who marked the link for disconnect, after the mark is set', async () => {
    const response = await disconnect()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, pending: true })
    expect(api.rpc.mock.calls).toEqual([
      [PREPARE, { p_barber_id: 'victor' }],
      [
        AUDIT,
        {
          p_actor: STAFF,
          p_action: 'update',
          p_target_table: 'barber_calendar_tokens',
          p_target_id: 'victor',
          p_detail: { changed: ['disconnect_requested_at'] },
        },
      ],
    ])
    // The actor is the user of the caller's own verified token.
    expect(api.getUser.mock.calls).toEqual([['barber-token'], ['barber-token']])
  })

  it('records nothing when the barber has no calendar link to disconnect', async () => {
    prepared = () => ({ data: { ok: true, pending: false }, error: null })

    const response = await disconnect()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, pending: false })
    expect(auditCalls()).toEqual([])
    expect(api.getUser).toHaveBeenCalledOnce()
  })

  it.each([
    ['the database refuses it', () => ({ data: null, error: { message: 'lock timeout' } })],
    ['its answer is not understood', () => ({ data: { ok: false }, error: null })],
  ])('records nothing when the disconnect fails because %s', async (_, failure) => {
    prepared = failure
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await disconnect()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, error: 'disconnect_failed' })
    expect(auditCalls()).toEqual([])
  })

  it('records nothing for a caller who is refused', async () => {
    expect((await disconnect('')).status).toBe(401)

    api.profile.mockResolvedValue({
      data: { role: 'owner', barber_id: null, account_enabled: true },
      error: null,
    })
    expect((await disconnect()).status).toBe(403)

    expect(api.rpc).not.toHaveBeenCalled()
  })

  it.each([
    [
      'refuses the entry',
      () => ({ data: null, error: { code: '22023', message: `actor ${STAFF} is unknown` } }),
      '22023',
    ],
    ['cannot be reached', () => Promise.reject(new TypeError('fetch failed')), 'TypeError'],
  ])('answers exactly the same when the admin log %s', async (_, failure, code) => {
    const expected = await answer(await disconnect())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    audited = failure

    const actual = await answer(await disconnect())

    expect(actual).toEqual(expected)
    expect(expected[0]).toBe(200)
    expect(expected[2]).toBe('{"ok":true,"pending":true}')
    // The function and the error code: no id of the barber or of the account.
    expect(logged.mock.calls).toEqual([['calendar-disconnect: admin log write failed:', code]])
  })

  it.each([
    [
      'is not confirmed',
      () => ({ data: { user: null }, error: { name: 'AuthApiError', message: 'bad jwt' } }),
      'AuthApiError',
    ],
    ['has no user', () => ({ data: { user: null }, error: null }), 'no user'],
    ['cannot be read', () => Promise.reject(new TypeError('fetch failed')), 'TypeError'],
  ])(
    'guesses no actor and answers the same when the token %s the second time',
    async (_, second, code) => {
      const expected = await answer(await disconnect())
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      api.rpc.mockClear()
      // The caller gate reads the token first and passes; the read for the admin log fails.
      api.getUser
        .mockReset()
        .mockResolvedValueOnce({ data: { user: { id: STAFF } }, error: null })
        .mockImplementationOnce(second)

      const actual = await answer(await disconnect())

      expect(actual).toEqual(expected)
      expect(api.rpc.mock.calls.map(([name]) => name)).toEqual([PREPARE])
      expect(logged.mock.calls).toEqual([
        ['calendar-disconnect: admin log actor lookup failed:', code],
      ])
    },
  )

  it('answers only once the admin log has answered', async () => {
    let release: (answer: unknown) => void = () => undefined
    audited = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const answered = vi.fn()

    const response = disconnect()
    void response.then(answered)
    await settle()

    // The entry is on its way and the function waits for it: it does not outlive the request.
    expect(auditCalls()).toHaveLength(1)
    expect(answered).not.toHaveBeenCalled()

    release({ data: null, error: null })
    expect((await response).status).toBe(200)
  })

  it('answers exactly the same after 3 seconds when the admin log never answers', async () => {
    const expected = await answer(await disconnect())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    audited = never
    const answered = vi.fn()
    fakeTheBound()

    const response = disconnect()
    void response.then(answered)
    await vi.advanceTimersByTimeAsync(2999)
    expect(answered).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()

    expect(await answer(await response)).toEqual(expected)
    expect(logged.mock.calls).toEqual([['calendar-disconnect: admin log write failed:', 'timeout']])
  })

  it('guesses no actor and answers the same after 3 seconds when the token read never answers', async () => {
    const expected = await answer(await disconnect())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    api.rpc.mockClear()
    // The caller gate reads the token first and passes; the read for the admin log stalls.
    api.getUser
      .mockReset()
      .mockResolvedValueOnce({ data: { user: { id: STAFF } }, error: null })
      .mockImplementationOnce(never)
    const answered = vi.fn()
    fakeTheBound()

    const response = disconnect()
    void response.then(answered)
    await vi.advanceTimersByTimeAsync(2999)
    expect(answered).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()

    expect(await answer(await response)).toEqual(expected)
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual([PREPARE])
    expect(logged.mock.calls).toEqual([
      ['calendar-disconnect: admin log actor lookup failed:', 'timeout'],
    ])
  })
})
