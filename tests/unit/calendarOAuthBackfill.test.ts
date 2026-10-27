import type * as CalendarModule from '../../supabase/functions/_shared/calendar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queueBackfill } from '../../supabase/functions/_shared/calendarBackfill'

const OLD_ASSIGNMENT = '54000000-0000-0000-0000-000000000001'
const CURRENT_ASSIGNMENT = '54000000-0000-0000-0000-000000000002'
const UNMAPPED = '54000000-0000-0000-0000-000000000003'
const oauth = vi.hoisted(() => ({ rpc: vi.fn(), exchange: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === 'profiles' ? { id: 'staff' } : null,
          error: null,
        }),
      }
      return query
    },
    rpc: oauth.rpc,
  }),
}))
vi.mock('../../supabase/functions/_shared/calendar', async (original) => ({
  ...(await original<typeof CalendarModule>()),
  verifyState: async () => ({ barber_id: 'destination-barber', iat: 1 }),
  exchangeCode: oauth.exchange,
}))

describe('Calendar OAuth HTTP boundary', () => {
  let handler: (request: Request) => Promise<Response>
  beforeEach(async () => {
    vi.resetModules()
    oauth.rpc.mockReset().mockImplementation(async (name: string) => ({
      data:
        name === 'calendar_backfill_source'
          ? { calendar_id: 'primary', bookings: [{ id: UNMAPPED, google_event_id: null }] }
          : { ok: true },
      error: null,
    }))
    oauth.exchange.mockReset()
    vi.stubGlobal('Deno', {
      env: { get: () => 'unit-config' },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request')
      }),
    )
    await vi.importActual('../../supabase/functions/calendar-oauth-callback/index.ts')
  })
  afterEach(() => vi.unstubAllGlobals())

  const request = () => new Request('https://edge.example.test/callback?code=unit&state=unit')
  const idToken = (email: string) =>
    `e30.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.signature`

  it.each([undefined, '', '   '])(
    'rejects missing or blank account identity %j before storing OAuth credentials',
    async (email) => {
      oauth.exchange.mockResolvedValue({
        refresh_token: 'refresh',
        ...(email === undefined ? {} : { id_token: idToken(email) }),
      })
      const response = await handler(request())
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('Google-kontots e-post kunde inte verifieras')
      expect(oauth.rpc).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('stores a verified account and queues backfill without provider or mapping writes', async () => {
    oauth.exchange.mockResolvedValue({
      refresh_token: 'refresh',
      id_token: idToken(' barber@example.test '),
    })
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(oauth.rpc.mock.calls).toEqual([
      [
        'calendar_store_token',
        {
          p_barber_id: 'destination-barber',
          p_refresh_token: 'refresh',
          p_google_email: 'barber@example.test',
          p_calendar_id: 'primary',
        },
      ],
      ['calendar_backfill_source', { p_barber_id: 'destination-barber' }],
      ['queue_calendar_event_sync', { p_booking_id: UNMAPPED }],
    ])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Calendar OAuth backfill', () => {
  it('queues old and unmapped identities for the durable worker, including an old map after relink', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'calendar_backfill_source') {
        return {
          data: {
            calendar_id: 'destination-calendar',
            bookings: [
              {
                id: OLD_ASSIGNMENT,
                google_event_id: null,
                mapped_barber_id: 'source-barber',
                mapped_calendar_id: 'source-calendar',
                mapped_google_event_id: 'old-event',
              },
              {
                id: CURRENT_ASSIGNMENT,
                google_event_id: 'current-event',
                mapped_barber_id: 'destination-barber',
                mapped_calendar_id: 'destination-calendar',
                mapped_google_event_id: 'current-event',
              },
              {
                id: UNMAPPED,
                google_event_id: null,
                mapped_barber_id: null,
                mapped_calendar_id: null,
                mapped_google_event_id: null,
              },
            ],
          },
          error: null,
        }
      }
      return { data: 'queued', error: null }
    })

    await queueBackfill({ rpc }, 'destination-barber')

    expect(rpc).toHaveBeenNthCalledWith(1, 'calendar_backfill_source', {
      p_barber_id: 'destination-barber',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'queue_calendar_event_sync', {
      p_booking_id: OLD_ASSIGNMENT,
    })
    expect(rpc).toHaveBeenNthCalledWith(3, 'queue_calendar_event_sync', {
      p_booking_id: UNMAPPED,
    })
    expect(rpc).not.toHaveBeenCalledWith('queue_calendar_event_sync', {
      p_booking_id: CURRENT_ASSIGNMENT,
    })
  })

  it('does not perform provider or mapping writes while selecting backfill work', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'calendar_backfill_source') {
        return {
          data: { calendar_id: 'destination-calendar', bookings: [] },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    await queueBackfill({ rpc }, 'destination-barber')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalledWith('calendar_record_event', expect.anything())
  })
})
