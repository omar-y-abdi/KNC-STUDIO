import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeExternalAction,
  parseExternalAction,
  type ExternalActionService,
} from '../../supabase/functions/_shared/externalActions'
import type { ExternalActionError } from '../../supabase/functions/_shared/externalActions'

const ACTION_ID = '41000000-0000-4000-8000-000000000001'
const DISPATCH_TOKEN = '41000000-0000-4000-8000-000000000002'
const BOOKING_ID = '41000000-0000-4000-8000-000000000003'
const USER_ID = '41000000-0000-4000-8000-000000000004'

const { remove, updateUserById, deleteUser, rpc } = vi.hoisted(() => ({
  remove: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
  rpc: vi.fn(),
}))

const service: ExternalActionService = {
  storage: { from: () => ({ remove }) },
  auth: { admin: { updateUserById, deleteUser } },
  rpc,
}

beforeEach(() => {
  remove.mockReset().mockResolvedValue({ error: null })
  updateUserById.mockReset().mockResolvedValue({ error: null })
  deleteUser.mockReset().mockResolvedValue({ error: null })
  rpc.mockReset().mockResolvedValue({ data: null, error: null })
})

afterEach(() => vi.unstubAllGlobals())

describe('external action contract', () => {
  it('rejects a Calendar delete context that omits server-resolved credentials', () => {
    expect(
      parseExternalAction({
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_delete',
        booking_id: BOOKING_ID,
        barber_id: 'ada',
        google_event_id: 'event-1',
        calendar_id: 'primary',
      }),
    ).toBeNull()
  })

  it('removes a Storage object idempotently through service-role Storage', async () => {
    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'storage_object_delete',
        bucket: 'gallery',
        path: 'salon/current.webp',
      },
      service,
      { googleClientId: undefined, googleClientSecret: undefined },
    )

    expect(remove).toHaveBeenCalledWith(['salon/current.webp'])
  })

  it('forgets Calendar mapping only after Google deletion succeeds', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_delete',
        booking_id: BOOKING_ID,
        barber_id: 'ada',
        google_event_id: 'event-1',
        refresh_token: 'server-resolved-refresh-token',
        calendar_id: 'primary',
      },
      service,
      { googleClientId: 'client', googleClientSecret: 'secret' },
    )

    expect(rpc).toHaveBeenCalledWith('calendar_forget_event', { p_booking_id: BOOKING_ID })
  })

  it('retains Calendar mapping when Google deletion fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'access-token' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('unavailable', { status: 503 })
      }),
    )

    await expect(
      executeExternalAction(
        {
          id: ACTION_ID,
          dispatch_token: DISPATCH_TOKEN,
          action_type: 'calendar_event_delete',
          booking_id: BOOKING_ID,
          barber_id: 'ada',
          google_event_id: 'event-1',
          refresh_token: 'server-resolved-refresh-token',
          calendar_id: 'primary',
        },
        service,
        { googleClientId: 'client', googleClientSecret: 'secret' },
      ),
    ).rejects.toMatchObject<Partial<ExternalActionError>>({
      code: 'calendar_delete_failed',
      retryable: true,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('blocks Calendar deletion for same-account reauthorization when Google revokes the grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_grant' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    await expect(
      executeExternalAction(
        {
          id: ACTION_ID,
          dispatch_token: DISPATCH_TOKEN,
          action_type: 'calendar_event_delete',
          booking_id: BOOKING_ID,
          barber_id: 'ada',
          google_event_id: 'event-1',
          refresh_token: 'revoked-refresh-token',
          calendar_id: 'primary',
        },
        service,
        { googleClientId: 'client', googleClientSecret: 'secret' },
      ),
    ).rejects.toMatchObject<Partial<ExternalActionError>>({
      code: 'calendar_authorization_required',
      retryable: false,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    [false, '876000h'],
    [true, 'none'],
  ] as const)('syncs account enabled=%s to Auth ban state', async (accountEnabled, banDuration) => {
    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'auth_user_access_sync',
        user_id: USER_ID,
        account_enabled: accountEnabled,
        version: 3,
      },
      service,
      { googleClientId: undefined, googleClientSecret: undefined },
    )

    expect(updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: banDuration })
  })

  it('does not revoke token while Calendar event deletion remains pending', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      executeExternalAction(
        {
          id: ACTION_ID,
          dispatch_token: DISPATCH_TOKEN,
          action_type: 'calendar_disconnect',
          barber_id: 'ada',
          refresh_token: 'server-resolved-refresh-token',
          ready: false,
        },
        service,
        { googleClientId: undefined, googleClientSecret: undefined },
      ),
    ).rejects.toMatchObject<Partial<ExternalActionError>>({ code: 'calendar_events_pending' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('revokes token before deleting local Calendar credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )

    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_disconnect',
        barber_id: 'ada',
        refresh_token: 'server-resolved-refresh-token',
        ready: true,
      },
      service,
      { googleClientId: undefined, googleClientSecret: undefined },
    )

    expect(rpc).toHaveBeenCalledWith('calendar_delete_token', { p_barber_id: 'ada' })
  })

  it('soft-deletes Auth user and treats missing user as idempotent success', async () => {
    deleteUser.mockResolvedValue({ error: { status: 404, code: 'user_not_found' } })

    await expect(
      executeExternalAction(
        {
          id: ACTION_ID,
          dispatch_token: DISPATCH_TOKEN,
          action_type: 'auth_user_delete',
          user_id: USER_ID,
        },
        service,
        { googleClientId: undefined, googleClientSecret: undefined },
      ),
    ).resolves.toBeUndefined()
    expect(deleteUser).toHaveBeenCalledWith(USER_ID, true)
  })
})
