import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeExternalAction,
  parseExternalAction,
  type ExternalActionService,
} from '../../supabase/functions/_shared/externalActions'
import type { ExternalActionError } from '../../supabase/functions/_shared/externalActions'
import { encryptCustomerAccessToken } from '../../supabase/functions/_shared/customerAccess'

const ACTION_ID = '41000000-0000-4000-8000-000000000001'
const DISPATCH_TOKEN = '41000000-0000-4000-8000-000000000002'
const BOOKING_ID = '41000000-0000-4000-8000-000000000003'
const USER_ID = '41000000-0000-4000-8000-000000000004'
const CHALLENGE_ID = '41000000-0000-4000-8000-000000000005'
const CUSTOMER_TOKEN = 'a'.repeat(64)
const CUSTOMER_ACCESS_SECRET = 'customer-access-secret-that-is-long-enough-32'

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
  rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'public_business_discovery') {
      return {
        data: {
          settings: {
            business_name: 'Current Studio',
            business_email: 'contact@current.example',
            business_phone_display: '031-12 34 56',
            business_phone_tel: '+4631123456',
            business_street: 'Current Street 7',
            business_postal_code: '411 11',
            business_city: 'Göteborg',
            business_maps_href: 'https://maps.example/current',
            cancellation_policy_hours: '36',
          },
        },
        error: null,
      }
    }
    if (name === 'email_template_for_delivery') return { data: null, error: null }
    if (name === 'consume_customer_access_email_challenge') return { data: true, error: null }
    return { data: null, error: null }
  })
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

  it('decrypts customer access only for email construction and consumes its challenge afterward', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.resend.com/emails')
      const body = JSON.parse(String(init?.body)) as { html: string; to: string }
      expect(body.to).toBe('customer@example.com')
      expect(body.html).toContain(`https://bladeblendstudio.se/${CUSTOMER_TOKEN}`)
      expect(body.html).not.toContain('v1.')
      expect(init?.headers).toMatchObject({
        'Idempotency-Key': `customer-booking-access/${ACTION_ID}`,
      })
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const ciphertext = await encryptCustomerAccessToken(CUSTOMER_TOKEN, CUSTOMER_ACCESS_SECRET)
    const action = parseExternalAction({
      id: ACTION_ID,
      dispatch_token: DISPATCH_TOKEN,
      action_type: 'customer_access_email_send',
      email: 'customer@example.com',
      lang: 'en',
      challenge_id: CHALLENGE_ID,
      token_ciphertext: ciphertext,
    })
    expect(action).not.toBeNull()
    if (action === null || action.action_type !== 'customer_access_email_send') return

    await executeExternalAction(action, service, {
      googleClientId: undefined,
      googleClientSecret: undefined,
      resendApiKey: 'resend-secret',
      customerAccessHashSalt: CUSTOMER_ACCESS_SECRET,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('consume_customer_access_email_challenge', {
      p_challenge_id: CHALLENGE_ID,
    })
  })

  it('leaves the dispatch-only challenge available when Resend delivery fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('provider unavailable', { status: 503 })),
    )

    const ciphertext = await encryptCustomerAccessToken(CUSTOMER_TOKEN, CUSTOMER_ACCESS_SECRET)
    const action = parseExternalAction({
      id: ACTION_ID,
      dispatch_token: DISPATCH_TOKEN,
      action_type: 'customer_access_email_send',
      email: 'customer@example.com',
      lang: 'en',
      challenge_id: CHALLENGE_ID,
      token_ciphertext: ciphertext,
    })
    expect(action).not.toBeNull()
    if (action === null || action.action_type !== 'customer_access_email_send') return

    await expect(
      executeExternalAction(action, service, {
        googleClientId: undefined,
        googleClientSecret: undefined,
        resendApiKey: 'resend-secret',
        customerAccessHashSalt: CUSTOMER_ACCESS_SECRET,
      }),
    ).rejects.toMatchObject({ code: 'send_failed_transient', retryable: true })
    expect(rpc).not.toHaveBeenCalledWith('consume_customer_access_email_challenge', {
      p_challenge_id: CHALLENGE_ID,
    })
  })

  it('keeps Calendar execution retryable when the authoritative source is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'temporary source failure' } })
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      executeExternalAction(
        {
          id: ACTION_ID,
          dispatch_token: DISPATCH_TOKEN,
          action_type: 'calendar_event_sync',
          booking_id: BOOKING_ID,
          barber_id: 'ada',
          service_name: 'Stale Service',
          customer_name: 'Stale Customer',
          phone: '0700000000',
          start_at: '2040-03-14T12:30:00.000Z',
          end_at: '2040-03-14T13:15:00.000Z',
          refresh_token: 'server-resolved-refresh-token',
          calendar_id: 'primary',
          google_event_id: null,
        },
        service,
        { googleClientId: 'client', googleClientSecret: 'secret' },
      ),
    ).rejects.toMatchObject({ code: 'calendar_source_failed', retryable: true })
    expect(fetchMock).toHaveBeenCalledOnce()
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
