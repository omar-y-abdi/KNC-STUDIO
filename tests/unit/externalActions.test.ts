import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeExternalAction,
  isMissingCalendarDispatcherError,
  parseExternalAction,
  type ExternalActionService,
} from '../../supabase/functions/_shared/externalActions'
import type { ExternalActionError } from '../../supabase/functions/_shared/externalActions'

const ACTION_ID = '41000000-0000-4000-8000-000000000001'
const DISPATCH_TOKEN = '41000000-0000-4000-8000-000000000002'
const BOOKING_ID = '41000000-0000-4000-8000-000000000003'
const USER_ID = '41000000-0000-4000-8000-000000000004'
const CALENDAR_EVENT_ID = 'calendar-event-1'

const authoritativeCalendarSource = {
  status: 'confirmed',
  barber_id: 'source-barber',
  service_name: 'Database Service',
  customer_name: 'Database Customer',
  phone: '0707654321',
  email: 'database.customer@example.com',
  start_at: '2040-03-14T14:30:00.000Z',
  end_at: '2040-03-14T15:15:00.000Z',
  refresh_token: 'source-refresh-token',
  calendar_id: 'source-calendar',
  google_event_id: null,
}

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
  it('allows generic dispatch fallback only for an explicitly missing Calendar dispatcher', () => {
    expect(isMissingCalendarDispatcherError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingCalendarDispatcherError({ code: '42883' })).toBe(true)
    expect(
      isMissingCalendarDispatcherError({
        message: 'function calendar_external_action_for_dispatch does not exist',
      }),
    ).toBe(true)
    expect(isMissingCalendarDispatcherError({ code: '42501', message: 'permission denied' })).toBe(
      false,
    )
    expect(
      isMissingCalendarDispatcherError({ code: 'PGRST500', message: 'database unavailable' }),
    ).toBe(false)
    expect(isMissingCalendarDispatcherError(null)).toBe(false)
  })

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

  it('accepts an unlinked Calendar destination while retaining the old cleanup identity', () => {
    expect(
      parseExternalAction({
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_sync',
        booking_id: BOOKING_ID,
        barber_id: 'destination-barber',
        service_name: 'Service',
        customer_name: 'Customer',
        phone: '0700000000',
        start_at: '2040-03-14T12:30:00.000Z',
        end_at: '2040-03-14T13:15:00.000Z',
        refresh_token: null,
        calendar_id: null,
        google_event_id: null,
        mapped_barber_id: 'source-barber',
        mapped_refresh_token: 'current-source-refresh-token',
        mapped_calendar_id: 'source-calendar',
        mapped_google_event_id: 'source-event-id',
      }),
    ).toMatchObject({
      action_type: 'calendar_event_sync',
      refresh_token: null,
      mapped_barber_id: 'source-barber',
    })
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

  it('re-reads authoritative Calendar customer details before creating an event', async () => {
    const operations: string[] = []
    rpc.mockImplementation(async (name: string) => {
      operations.push(name)
      if (name === 'calendar_sync_source') {
        return { data: authoritativeCalendarSource, error: null }
      }
      return { data: true, error: null }
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      operations.push('google')
      const url = String(input)
      if (url.includes('oauth2.googleapis.com/token')) {
        expect(String(init?.body)).toContain('refresh_token=source-refresh-token')
        return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 })
      }
      expect(url).toContain('/calendars/source-calendar/events')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.summary).toBe('Database Customer — Database Service')
      expect(body.description).toContain('Kund: Database Customer')
      expect(body.description).toContain('Telefon: 0707654321')
      expect(body.description).toContain('E-post: database.customer@example.com')
      expect(body.description).toContain('Tjänst: Database Service')
      expect(body.start).toEqual({
        dateTime: authoritativeCalendarSource.start_at,
        timeZone: 'Europe/Stockholm',
      })
      expect(body.end).toEqual({
        dateTime: authoritativeCalendarSource.end_at,
        timeZone: 'Europe/Stockholm',
      })
      return new Response(JSON.stringify({ id: CALENDAR_EVENT_ID }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await executeExternalAction(
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
    )

    expect(rpc).toHaveBeenNthCalledWith(1, 'calendar_sync_source', {
      p_booking_id: BOOKING_ID,
    })
    expect(operations[0]).toBe('calendar_sync_source')
    expect(rpc).toHaveBeenCalledWith('calendar_record_event_if_current', {
      p_booking_id: BOOKING_ID,
      p_barber_id: 'source-barber',
      p_calendar_id: 'source-calendar',
      p_google_event_id: CALENDAR_EVENT_ID,
    })
  })

  it('re-reads authoritative Calendar customer details before updating an event', async () => {
    const source = { ...authoritativeCalendarSource, google_event_id: 'source-event-id' }
    rpc.mockImplementation(async (name: string) => {
      if (name === 'calendar_sync_source') {
        return { data: source, error: null }
      }
      return { data: true, error: null }
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('oauth2.googleapis.com/token')) {
        expect(String(init?.body)).toContain('refresh_token=source-refresh-token')
        return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 })
      }
      expect(url).toContain('/calendars/source-calendar/events/source-event-id')
      expect(init?.method).toBe('PATCH')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.summary).toBe('Database Customer — Database Service')
      expect(body.description).toContain('Telefon: 0707654321')
      expect(body.description).toContain('E-post: database.customer@example.com')
      expect(body.start).toEqual({
        dateTime: authoritativeCalendarSource.start_at,
        timeZone: 'Europe/Stockholm',
      })
      expect(body.end).toEqual({
        dateTime: authoritativeCalendarSource.end_at,
        timeZone: 'Europe/Stockholm',
      })
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await executeExternalAction(
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
        google_event_id: CALENDAR_EVENT_ID,
      },
      service,
      { googleClientId: 'client', googleClientSecret: 'secret' },
    )

    expect(rpc).toHaveBeenNthCalledWith(1, 'calendar_sync_source', {
      p_booking_id: BOOKING_ID,
    })
    expect(rpc).toHaveBeenCalledWith('calendar_record_event_if_current', {
      p_booking_id: BOOKING_ID,
      p_barber_id: 'source-barber',
      p_calendar_id: 'source-calendar',
      p_google_event_id: 'source-event-id',
    })
  })

  it('deletes the old barber event before creating the linked destination event', async () => {
    let source: Record<string, unknown> = {
      ...authoritativeCalendarSource,
      barber_id: 'destination-barber',
      refresh_token: 'destination-refresh-token',
      calendar_id: 'destination-calendar',
      google_event_id: null,
      mapped_barber_id: 'source-barber',
      mapped_refresh_token: 'current-source-refresh-token',
      mapped_calendar_id: 'source-calendar',
      mapped_google_event_id: 'source-event-id',
    }
    const operations: string[] = []
    rpc.mockImplementation(async (name: string, params: Readonly<Record<string, unknown>>) => {
      if (name === 'calendar_sync_source') return { data: source, error: null }
      if (name === 'calendar_forget_event_if_matches') {
        expect(params).toEqual({
          p_booking_id: BOOKING_ID,
          p_barber_id: 'source-barber',
          p_calendar_id: 'source-calendar',
          p_google_event_id: 'source-event-id',
        })
        source = {
          ...source,
          mapped_barber_id: null,
          mapped_calendar_id: null,
          mapped_google_event_id: null,
          mapped_refresh_token: null,
        }
        return { data: true, error: null }
      }
      if (name === 'calendar_record_event_if_current') {
        operations.push('record-destination')
        return { data: true, error: null }
      }
      return { data: null, error: null }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com/token')) {
          const body = String(init?.body)
          operations.push(
            body.includes('current-source-refresh-token') ? 'refresh-old' : 'refresh-destination',
          )
          return new Response(
            JSON.stringify({
              access_token: body.includes('current-source-refresh-token')
                ? 'old-access-token'
                : 'destination-access-token',
            }),
            { status: 200 },
          )
        }
        if (init?.method === 'DELETE') {
          operations.push(`delete:${url}`)
          return new Response(null, { status: 204 })
        }
        operations.push(`insert:${url}`)
        return new Response(JSON.stringify({ id: CALENDAR_EVENT_ID }), { status: 200 })
      }),
    )

    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_sync',
        booking_id: BOOKING_ID,
        barber_id: 'stale-barber',
        service_name: 'Stale Service',
        customer_name: 'Stale Customer',
        phone: '0700000000',
        start_at: '2040-03-14T12:30:00.000Z',
        end_at: '2040-03-14T13:15:00.000Z',
        refresh_token: 'stale-refresh-token',
        calendar_id: 'stale-calendar',
        google_event_id: null,
      },
      service,
      { googleClientId: 'client', googleClientSecret: 'secret' },
    )

    expect(operations.findIndex((operation) => operation.startsWith('delete:'))).toBeGreaterThan(-1)
    expect(operations.indexOf('refresh-old')).toBeLessThan(
      operations.indexOf('refresh-destination'),
    )
    expect(operations.indexOf('refresh-destination')).toBeLessThan(
      operations.findIndex((operation) => operation.startsWith('insert:')),
    )
    expect(rpc).toHaveBeenCalledWith('calendar_record_event_if_current', {
      p_booking_id: BOOKING_ID,
      p_barber_id: 'destination-barber',
      p_calendar_id: 'destination-calendar',
      p_google_event_id: CALENDAR_EVENT_ID,
    })
  })

  it('deletes the old event and creates no replacement when the destination is unlinked', async () => {
    let source: Record<string, unknown> = {
      ...authoritativeCalendarSource,
      barber_id: 'unlinked-destination',
      refresh_token: null,
      calendar_id: null,
      google_event_id: null,
      mapped_barber_id: 'source-barber',
      mapped_refresh_token: 'current-source-refresh-token',
      mapped_calendar_id: 'source-calendar',
      mapped_google_event_id: 'source-event-id',
    }
    rpc.mockImplementation(async (name: string) => {
      if (name === 'calendar_sync_source') return { data: source, error: null }
      if (name === 'calendar_forget_event_if_matches') {
        source = {
          ...source,
          mapped_barber_id: null,
          mapped_calendar_id: null,
          mapped_google_event_id: null,
          mapped_refresh_token: null,
        }
        return { data: true, error: null }
      }
      return { data: null, error: null }
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('oauth2.googleapis.com/token')) {
        expect(String(init?.body)).toContain('current-source-refresh-token')
        return new Response(JSON.stringify({ access_token: 'old-access-token' }), { status: 200 })
      }
      expect(init?.method).toBe('DELETE')
      expect(url).toContain('/calendars/source-calendar/events/source-event-id')
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_sync',
        booking_id: BOOKING_ID,
        barber_id: 'stale-barber',
        service_name: 'Stale Service',
        customer_name: 'Stale Customer',
        phone: '0700000000',
        start_at: '2040-03-14T12:30:00.000Z',
        end_at: '2040-03-14T13:15:00.000Z',
        refresh_token: 'stale-refresh-token',
        calendar_id: 'stale-calendar',
        google_event_id: null,
      },
      service,
      { googleClientId: 'client', googleClientSecret: 'secret' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rpc).not.toHaveBeenCalledWith('calendar_record_event_if_current', expect.anything())
  })

  it('keeps the old mapping through a partial failure and retries it before destination sync', async () => {
    let oldMapping = true
    let forgetAttempts = 0
    const operations: string[] = []
    rpc.mockImplementation(async (name: string) => {
      if (name === 'calendar_sync_source') {
        return {
          data: oldMapping
            ? {
                ...authoritativeCalendarSource,
                barber_id: 'destination-barber',
                refresh_token: 'destination-refresh-token',
                calendar_id: 'destination-calendar',
                google_event_id: null,
                mapped_barber_id: 'source-barber',
                mapped_refresh_token: 'current-source-refresh-token',
                mapped_calendar_id: 'source-calendar',
                mapped_google_event_id: 'source-event-id',
              }
            : {
                ...authoritativeCalendarSource,
                barber_id: 'destination-barber',
                refresh_token: 'destination-refresh-token',
                calendar_id: 'destination-calendar',
                google_event_id: null,
                mapped_barber_id: null,
                mapped_refresh_token: null,
                mapped_calendar_id: null,
                mapped_google_event_id: null,
              },
          error: null,
        }
      }
      if (name === 'calendar_forget_event_if_matches') {
        forgetAttempts += 1
        if (forgetAttempts === 1)
          return { data: null, error: { message: 'temporary mapping failure' } }
        oldMapping = false
        return { data: true, error: null }
      }
      if (name === 'calendar_record_event_if_current') {
        operations.push('record-destination')
        return { data: true, error: null }
      }
      return { data: null, error: null }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com/token')) {
          const body = String(init?.body)
          operations.push(
            body.includes('current-source-refresh-token') ? 'refresh-old' : 'refresh-destination',
          )
          return new Response(
            JSON.stringify({
              access_token: body.includes('current-source-refresh-token')
                ? 'old-access-token'
                : 'destination-access-token',
            }),
            { status: 200 },
          )
        }
        if (init?.method === 'DELETE') {
          operations.push('delete-old')
          return new Response(null, { status: 204 })
        }
        operations.push('insert-destination')
        return new Response(JSON.stringify({ id: CALENDAR_EVENT_ID }), { status: 200 })
      }),
    )

    const action: Extract<
      Parameters<typeof executeExternalAction>[0],
      { action_type: 'calendar_event_sync' }
    > = {
      id: ACTION_ID,
      dispatch_token: DISPATCH_TOKEN,
      action_type: 'calendar_event_sync',
      booking_id: BOOKING_ID,
      barber_id: 'stale-barber',
      service_name: 'Stale Service',
      customer_name: 'Stale Customer',
      phone: '0700000000',
      start_at: '2040-03-14T12:30:00.000Z',
      end_at: '2040-03-14T13:15:00.000Z',
      refresh_token: 'stale-refresh-token',
      calendar_id: 'stale-calendar',
      google_event_id: null,
    }

    await expect(
      executeExternalAction(action, service, {
        googleClientId: 'client',
        googleClientSecret: 'secret',
      }),
    ).rejects.toMatchObject({ code: 'calendar_forget_failed', retryable: true })
    expect(operations).toEqual(['refresh-old', 'delete-old'])
    expect(rpc).not.toHaveBeenCalledWith('calendar_record_event_if_current', expect.anything())

    await executeExternalAction(action, service, {
      googleClientId: 'client',
      googleClientSecret: 'secret',
    })
    expect(operations).toEqual([
      'refresh-old',
      'delete-old',
      'refresh-old',
      'delete-old',
      'refresh-destination',
      'insert-destination',
      'record-destination',
    ])
  })

  it('does not overwrite a newer mapping when the booking changes during destination sync', async () => {
    const operations: string[] = []
    let source: Record<string, unknown> = { ...authoritativeCalendarSource }
    rpc.mockImplementation(async (name: string) => {
      if (name === 'calendar_sync_source') {
        return { data: source, error: null }
      }
      if (name === 'calendar_record_event_if_current') {
        source = { ...source, status: 'cancelled' }
        return { data: false, error: null }
      }
      return { data: null, error: null }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'destination-access-token' }), {
            status: 200,
          })
        }
        if (init?.method === 'DELETE') {
          operations.push('delete-destination')
          return new Response(null, { status: 204 })
        }
        expect(init?.method).toBe('POST')
        operations.push('insert-destination')
        return new Response(JSON.stringify({ id: CALENDAR_EVENT_ID }), { status: 200 })
      }),
    )

    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_sync',
        booking_id: BOOKING_ID,
        barber_id: 'stale-barber',
        service_name: 'Stale Service',
        customer_name: 'Stale Customer',
        phone: '0700000000',
        start_at: '2040-03-14T12:30:00.000Z',
        end_at: '2040-03-14T13:15:00.000Z',
        refresh_token: 'stale-refresh-token',
        calendar_id: 'stale-calendar',
        google_event_id: null,
      },
      service,
      { googleClientId: 'client', googleClientSecret: 'secret' },
    )

    expect(operations).toEqual(['insert-destination', 'delete-destination'])
    expect(rpc).not.toHaveBeenCalledWith(
      'calendar_queue_event_deletion_for_identity',
      expect.anything(),
    )
    expect(rpc).toHaveBeenCalledWith('calendar_record_event_if_current', {
      p_booking_id: BOOKING_ID,
      p_barber_id: 'source-barber',
      p_calendar_id: 'source-calendar',
      p_google_event_id: CALENDAR_EVENT_ID,
    })
    expect(rpc).not.toHaveBeenCalledWith('calendar_record_event', expect.anything())
  })

  it('keeps orphan cleanup retryable and queues identifier-only identity when immediate deletion fails', async () => {
    const queuePayloads: Readonly<Record<string, unknown>>[] = []
    rpc.mockImplementation(async (name: string, params: Readonly<Record<string, unknown>>) => {
      if (name === 'calendar_sync_source')
        return { data: { ...authoritativeCalendarSource }, error: null }
      if (name === 'calendar_record_event_if_current') return { data: false, error: null }
      if (name === 'calendar_queue_event_deletion_for_identity') {
        queuePayloads.push(params)
        return { data: true, error: null }
      }
      return { data: null, error: null }
    })
    let destinationInserted = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'destination-access-token' }), {
            status: 200,
          })
        }
        if (!destinationInserted) {
          destinationInserted = true
          expect(init?.method).toBe('POST')
          return new Response(JSON.stringify({ id: CALENDAR_EVENT_ID }), { status: 200 })
        }
        expect(init?.method).toBe('DELETE')
        return new Response('temporary Google failure', { status: 503 })
      }),
    )

    await expect(
      executeExternalAction(
        {
          id: ACTION_ID,
          dispatch_token: DISPATCH_TOKEN,
          action_type: 'calendar_event_sync',
          booking_id: BOOKING_ID,
          barber_id: 'stale-barber',
          service_name: 'Stale Service',
          customer_name: 'Stale Customer',
          phone: '0700000000',
          start_at: '2040-03-14T12:30:00.000Z',
          end_at: '2040-03-14T13:15:00.000Z',
          refresh_token: 'stale-refresh-token',
          calendar_id: 'stale-calendar',
          google_event_id: null,
        },
        service,
        { googleClientId: 'client', googleClientSecret: 'secret' },
      ),
    ).rejects.toMatchObject<Partial<ExternalActionError>>({
      code: 'calendar_orphan_cleanup_failed',
      retryable: true,
    })

    expect(queuePayloads).toEqual([
      {
        p_booking_id: BOOKING_ID,
        p_barber_id: 'source-barber',
        p_calendar_id: 'source-calendar',
        p_google_event_id: CALENDAR_EVENT_ID,
      },
    ])
  })

  it('re-reads after an exact mapping delete loses a race and patches the newer mapping', async () => {
    let sourceRead = 0
    const operations: string[] = []
    rpc.mockImplementation(async (name: string) => {
      if (name === 'calendar_sync_source') {
        sourceRead += 1
        return {
          data:
            sourceRead === 1
              ? {
                  ...authoritativeCalendarSource,
                  barber_id: 'destination-barber',
                  refresh_token: 'destination-refresh-token',
                  calendar_id: 'destination-calendar',
                  google_event_id: null,
                  mapped_barber_id: 'source-barber',
                  mapped_refresh_token: 'current-source-refresh-token',
                  mapped_calendar_id: 'source-calendar',
                  mapped_google_event_id: 'source-event-id',
                }
              : {
                  ...authoritativeCalendarSource,
                  barber_id: 'destination-barber',
                  refresh_token: 'destination-refresh-token',
                  calendar_id: 'destination-calendar',
                  google_event_id: 'newer-event-id',
                  mapped_barber_id: 'destination-barber',
                  mapped_refresh_token: 'current-destination-refresh-token',
                  mapped_calendar_id: 'destination-calendar',
                  mapped_google_event_id: 'newer-event-id',
                },
          error: null,
        }
      }
      if (name === 'calendar_forget_event_if_matches') return { data: false, error: null }
      if (name === 'calendar_record_event_if_current') {
        operations.push('record-newer')
        return { data: true, error: null }
      }
      return { data: null, error: null }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com/token')) {
          const body = String(init?.body)
          operations.push(
            body.includes('current-source-refresh-token') ? 'refresh-old' : 'refresh-newer',
          )
          return new Response(
            JSON.stringify({
              access_token: body.includes('current-source-refresh-token')
                ? 'old-access-token'
                : 'newer-access-token',
            }),
            { status: 200 },
          )
        }
        if (init?.method === 'DELETE') {
          operations.push('delete-old')
          return new Response(null, { status: 204 })
        }
        expect(init?.method).toBe('PATCH')
        expect(url).toContain('/calendars/destination-calendar/events/newer-event-id')
        operations.push('patch-newer')
        return new Response(null, { status: 200 })
      }),
    )

    await executeExternalAction(
      {
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_sync',
        booking_id: BOOKING_ID,
        barber_id: 'stale-barber',
        service_name: 'Stale Service',
        customer_name: 'Stale Customer',
        phone: '0700000000',
        start_at: '2040-03-14T12:30:00.000Z',
        end_at: '2040-03-14T13:15:00.000Z',
        refresh_token: 'stale-refresh-token',
        calendar_id: 'stale-calendar',
        google_event_id: null,
      },
      service,
      { googleClientId: 'client', googleClientSecret: 'secret' },
    )

    expect(sourceRead).toBe(2)
    expect(operations).toEqual([
      'refresh-old',
      'delete-old',
      'refresh-newer',
      'patch-newer',
      'record-newer',
    ])
    expect(rpc).not.toHaveBeenCalledWith(
      'calendar_queue_event_deletion_for_identity',
      expect.anything(),
    )
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
        { googleClientId: undefined, googleClientSecret: undefined },
      ),
    ).rejects.toMatchObject({ code: 'calendar_source_failed', retryable: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing booking', null],
    ['unconfirmed booking', { status: 'cancelled' }],
    ['missing active Calendar token', { ...authoritativeCalendarSource, refresh_token: null }],
  ] as const)('completes a %s Calendar job without contacting Google', async (_case, data) => {
    rpc.mockResolvedValue({ data, error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      executeExternalAction(
        {
          id: ACTION_ID,
          dispatch_token: DISPATCH_TOKEN,
          action_type: 'calendar_event_sync',
          booking_id: BOOKING_ID,
          barber_id: 'stale-barber',
          service_name: 'Stale Service',
          customer_name: 'Stale Customer',
          phone: '0700000000',
          start_at: '2040-03-14T12:30:00.000Z',
          end_at: '2040-03-14T13:15:00.000Z',
          refresh_token: 'stale-refresh-token',
          calendar_id: 'stale-calendar',
          google_event_id: null,
        },
        service,
        { googleClientId: undefined, googleClientSecret: undefined },
      ),
    ).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
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

    expect(rpc).toHaveBeenCalledWith('calendar_forget_event_if_matches', {
      p_booking_id: BOOKING_ID,
      p_barber_id: 'ada',
      p_calendar_id: 'primary',
      p_google_event_id: 'event-1',
    })
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
