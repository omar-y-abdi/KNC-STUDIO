// calendar-oauth-callback and the admin log. Google sends the barber's browser here without a JWT
// and the function stores the token with the service role, so it says itself who connected: the
// one staff account of the barber id in the signed state, once, after the token is stored, and
// never for a token that was not stored. A failed entry changes no answer.

import type * as CalendarModule from '../../supabase/functions/_shared/calendar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminActionRecord } from '../../supabase/functions/_shared/adminAudit'

const api = vi.hoisted(() => ({
  exchange: vi.fn(),
  profile: vi.fn(),
  rpc: vi.fn(),
  state: vi.fn(),
  token: vi.fn(),
  where: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: api.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          api.where(table, column, value)
          return query
        },
        maybeSingle: table === 'profiles' ? api.profile : api.token,
      }
      return query
    },
  }),
}))
vi.mock('../../supabase/functions/_shared/calendar', async (original) => ({
  ...(await original<typeof CalendarModule>()),
  verifyState: api.state,
  exchangeCode: api.exchange,
}))

const STAFF = '77777777-7777-4777-8777-777777777771'
const SITE = 'https://bladeblendstudio.se'
const AUDIT = 'internal_record_admin_action'
const STORE = 'calendar_store_token'
const BACKFILL = 'calendar_backfill_source'

/** A column the admin log helper accepts for a calendar link: a name the table does not have is a
 *  compile error here, as it is in the function. */
type LinkColumn = Extract<
  AdminActionRecord,
  { table: 'barber_calendar_tokens'; action: 'update' }
>['changedColumns'][number]
/** What `calendar_store_token` rewrites on a link it keeps, and on one it writes whole. */
const RENEWED: readonly LinkColumn[] = [
  'refresh_token',
  'calendar_id',
  'updated_at',
  'last_sync_error',
]
const REPLACED: readonly LinkColumn[] = [
  'refresh_token',
  'google_email',
  'calendar_id',
  'updated_at',
  'last_sync_error',
  'disconnect_requested_at',
]

/** The answers with the app origin in the signed state: a redirect back into the panel. */
const CONNECTED = [303, [['location', `${SITE}/admin?calendar=connected`]], '']
const FAILED = [303, [['location', `${SITE}/admin?calendar=error`]], '']

let handler: (request: Request) => Promise<Response>
/** What `calendar_store_token` and the admin log answer in the test at hand. */
let stored: () => unknown
let audited: () => unknown

const idToken = (email: string) =>
  `e30.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.signature`

beforeEach(async () => {
  vi.resetModules()
  stored = () => ({ data: { ok: true, cleanup_pending: false }, error: null })
  audited = () => ({ data: null, error: null })
  api.state.mockReset().mockResolvedValue({ barber_id: 'victor', iat: 1, return_to: SITE })
  api.exchange.mockReset().mockResolvedValue({
    refresh_token: 'refresh',
    id_token: idToken('victor@example.test'),
  })
  api.profile.mockReset().mockResolvedValue({ data: { id: STAFF }, error: null })
  api.token.mockReset().mockResolvedValue({ data: null, error: null })
  api.where.mockReset()
  api.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === STORE) return stored()
    if (name === AUDIT) return audited()
    if (name === BACKFILL) return { data: { calendar_id: 'primary', bookings: [] }, error: null }
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
  await vi.importActual('../../supabase/functions/calendar-oauth-callback/index.ts')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Let everything that can run without a further answer run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function callback(): Promise<Response> {
  return handler(
    new Request('https://edge.example.test/calendar-oauth-callback?code=unit&state=unit'),
  )
}

const auditCalls = () => api.rpc.mock.calls.filter(([name]) => name === AUDIT)
const rpcNames = () => api.rpc.mock.calls.map(([name]) => name)
const answer = async (response: Response) => [
  response.status,
  [...response.headers],
  await response.text(),
]
/** The admin log call for the barber's calendar link, under the barber's own account. */
const entry = (action: 'insert' | 'update', detail: { changed: readonly string[] } | null) => [
  AUDIT,
  {
    p_actor: STAFF,
    p_action: action,
    p_target_table: 'barber_calendar_tokens',
    p_target_id: 'victor',
    p_detail: detail,
  },
]

describe('calendar-oauth-callback admin log', () => {
  it("records a first connect as a new link under the barber's account, after the token is stored", async () => {
    expect(await answer(await callback())).toEqual(CONNECTED)

    expect(api.rpc.mock.calls).toEqual([
      [
        STORE,
        {
          p_barber_id: 'victor',
          p_refresh_token: 'refresh',
          p_google_email: 'victor@example.test',
          p_calendar_id: 'primary',
        },
      ],
      entry('insert', null),
      [BACKFILL, { p_barber_id: 'victor' }],
    ])
    // The account is the one the access check reads for the barber id of the signed state; the
    // admin log reads no account of its own.
    expect(api.where.mock.calls).toEqual([
      ['profiles', 'role', 'barber'],
      ['profiles', 'barber_id', 'victor'],
      ['profiles', 'account_enabled', true],
      ['barber_calendar_tokens', 'barber_id', 'victor'],
    ])
    expect(api.profile).toHaveBeenCalledOnce()
  })

  it('records a reconnect as a change of the columns the store rewrites on the row', async () => {
    api.token.mockResolvedValue({ data: { disconnect_requested_at: null }, error: null })

    expect(await answer(await callback())).toEqual(CONNECTED)

    expect(auditCalls()).toEqual([entry('update', { changed: REPLACED })])
    expect(rpcNames()).toEqual([STORE, AUDIT, BACKFILL])
  })

  it.each([
    [
      'is marked for disconnect',
      { disconnect_requested_at: '2026-11-10T09:00:00+00:00' },
      { ok: true, cleanup_pending: true },
      [STORE, AUDIT],
    ],
    [
      'has blocked jobs that wait for a new authorization',
      { disconnect_requested_at: null },
      { ok: true, cleanup_pending: false, repair_pending: true },
      [STORE, AUDIT, BACKFILL],
    ],
    // The store found a row that the function's own earlier read did not see.
    [
      'appeared after the function looked for one',
      null,
      { ok: true, cleanup_pending: false, repair_pending: true },
      [STORE, AUDIT, BACKFILL],
    ],
  ])(
    'records renewed access as a change that keeps the Google account when the link %s',
    async (_, link, storeAnswer, names) => {
      api.token.mockResolvedValue({ data: link, error: null })
      stored = () => ({ data: storeAnswer, error: null })

      expect(await answer(await callback())).toEqual(CONNECTED)

      expect(auditCalls()).toEqual([entry('update', { changed: RENEWED })])
      expect(rpcNames()).toEqual(names)
    },
  )

  it.each([
    ['the database refuses it', () => ({ data: null, error: { message: 'lock timeout' } })],
    [
      'another Google account holds the link',
      () => ({ data: { ok: false, error: 'account_mismatch' }, error: null }),
    ],
    ['its answer is not understood', () => ({ data: 'stored', error: null })],
    ['the request fails', () => Promise.reject(new TypeError('fetch failed'))],
  ])('records nothing when the token is not stored because %s', async (_, failure) => {
    stored = failure
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await answer(await callback())).toEqual(FAILED)

    expect(rpcNames()).toEqual([STORE])
  })

  it.each([
    ['is not there', { data: null, error: null }],
    ['cannot be read', { data: null, error: { code: '57014', message: 'statement timeout' } }],
  ])('stores and records nothing when the staff account of the barber id %s', async (_, read) => {
    api.profile.mockResolvedValue(read)

    expect(await answer(await callback())).toEqual(FAILED)

    expect(api.exchange).not.toHaveBeenCalled()
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it.each([[{}], [{ id: null }], [{ id: '' }]])(
    'guesses no actor and answers the same when the account row is %j',
    async (row) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      api.profile.mockResolvedValue({ data: row, error: null })

      expect(await answer(await callback())).toEqual(CONNECTED)

      expect(rpcNames()).toEqual([STORE, BACKFILL])
      expect(logged.mock.calls).toEqual([
        ['calendar-oauth-callback: admin log actor lookup failed:', 'no account id'],
      ])
    },
  )

  describe.each([
    ['redirects the barber back into the app', () => undefined, 303, [STORE, AUDIT, BACKFILL]],
    [
      'shows its own page',
      () => api.state.mockResolvedValue({ barber_id: 'victor', iat: 1 }),
      200,
      [STORE, AUDIT, BACKFILL],
    ],
    [
      'renews the access of a link that is marked for disconnect',
      () => {
        stored = () => ({ data: { ok: true, cleanup_pending: true }, error: null })
      },
      303,
      [STORE, AUDIT],
    ],
  ])('when the callback %s', (_path, arrange, status, names) => {
    it.each([
      [
        'refuses the entry',
        () => ({ data: null, error: { code: '22023', message: `actor ${STAFF} is unknown` } }),
        '22023',
      ],
      ['cannot be reached', () => Promise.reject(new TypeError('fetch failed')), 'TypeError'],
    ])('answers exactly the same when the admin log %s', async (_, failure, code) => {
      arrange()
      const expected = await answer(await callback())
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      api.rpc.mockClear()
      audited = failure

      const actual = await answer(await callback())

      expect(actual).toEqual(expected)
      expect(expected[0]).toBe(status)
      // What follows the entry still happens.
      expect(rpcNames()).toEqual(names)
      // The function and the error code: no id of the barber or of the account.
      expect(logged.mock.calls).toEqual([
        ['calendar-oauth-callback: admin log write failed:', code],
      ])
    })
  })

  it('goes on only once the admin log has answered', async () => {
    let release: (answer: unknown) => void = () => undefined
    audited = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const answered = vi.fn()

    const response = callback()
    void response.then(answered)
    await settle()

    // The entry is on its way and the function waits for it: nothing after it has started, and the
    // entry does not outlive the request.
    expect(rpcNames()).toEqual([STORE, AUDIT])
    expect(answered).not.toHaveBeenCalled()

    release({ data: null, error: null })
    expect(await answer(await response)).toEqual(CONNECTED)
    expect(rpcNames()).toEqual([STORE, AUDIT, BACKFILL])
  })

  it('answers exactly the same after 3 seconds when the admin log never answers', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    audited = () => new Promise(() => undefined)
    const answered = vi.fn()
    // Only the clock of the admin log bound is faked; the request and its answer run as they do.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const response = callback()
    void response.then(answered)
    await vi.advanceTimersByTimeAsync(2999)
    expect(answered).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()

    expect(await answer(await response)).toEqual(CONNECTED)
    // What follows the entry still happens.
    expect(rpcNames()).toEqual([STORE, AUDIT, BACKFILL])
    expect(logged.mock.calls).toEqual([
      ['calendar-oauth-callback: admin log write failed:', 'timeout'],
    ])
  })
})
