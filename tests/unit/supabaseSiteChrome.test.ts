import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  supabaseUrl: 'https://example.supabase.co',
  contentData: null as readonly unknown[] | null,
  discoveryData: null as unknown,
  contentOk: false,
  discoveryOk: true,
  changeHandlers: [] as (() => void)[],
  changeFilters: [] as Record<string, unknown>[],
  systemHandlers: [] as ((payload: unknown) => void)[],
  subscriptionHandler: undefined as ((status: string) => void) | undefined,
  removeChannel: vi.fn(),
  realtimeReady: Promise.resolve(),
}))

vi.mock('../../src/backend/config', () => ({
  get SUPABASE_URL() {
    return state.supabaseUrl
  },
  SUPABASE_ANON_KEY: 'eyJ.test.signature',
  isBackendConfigured: () => true,
}))

vi.mock('../../src/backend/publicRealtime', () => ({
  getPublicRealtime: () => {
    const channel = {
      on: vi.fn(
        (event: string, filter: Record<string, unknown>, handler: (payload?: unknown) => void) => {
          if (event === 'system') state.systemHandlers.push(handler)
          if (event === 'postgres_changes') {
            state.changeFilters.push(filter)
            state.changeHandlers.push(handler)
          }
          return channel
        },
      ),
      subscribe: vi.fn((handler?: (status: string) => void) => {
        state.subscriptionHandler = handler
        return channel
      }),
    }
    return state.realtimeReady.then(() => ({
      channel: () => channel,
      removeChannel: state.removeChannel,
    }))
  },
}))

import { supabaseSiteChromeAdapter } from '../../src/site/adapters/supabaseSiteChrome'
import { unhandledRejectionsDuring } from './helpers/unhandledRejections'

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('Supabase site chrome resolution', () => {
  beforeEach(() => {
    state.supabaseUrl = 'https://example.supabase.co'
    state.contentData = null
    state.discoveryData = null
    state.contentOk = false
    state.discoveryOk = true
    state.changeHandlers = []
    state.changeFilters = []
    state.systemHandlers = []
    state.subscriptionHandler = undefined
    state.removeChannel.mockReset()
    state.realtimeReady = Promise.resolve()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        const prefix = new URL(state.supabaseUrl).pathname.replace(/\/$/, '')
        if (url.pathname === `${prefix}/rest/v1/site_content`) {
          return new Response(JSON.stringify(state.contentData), {
            status: state.contentOk ? 200 : 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.pathname === `${prefix}/rest/v1/rpc/public_business_discovery`) {
          return new Response(JSON.stringify(state.discoveryData), {
            status: state.discoveryOk ? 200 : 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(null, { status: 404 })
      }),
    )
  })

  it('keeps Worker metadata authoritative when either backend response is unavailable', async () => {
    await expect(supabaseSiteChromeAdapter.load('sv')).resolves.toBeNull()

    state.contentData = []
    state.contentOk = true
    state.discoveryData = { malformed: true }
    await expect(supabaseSiteChromeAdapter.load('sv')).resolves.toBeNull()
  })

  it('uses lightweight Data API requests for initial public hydration', async () => {
    state.contentData = []
    state.contentOk = true
    state.discoveryData = { settings: {}, barbers: [], services: [], schedules: [] }

    await expect(supabaseSiteChromeAdapter.load('sv')).resolves.not.toBeNull()

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes('/rest/v1/site_content'))).toBe(true)
    expect(urls.some((url) => url.includes('/rest/v1/rpc/public_business_discovery'))).toBe(true)

    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.get('apikey')).toBe('eyJ.test.signature')
      expect(headers.get('Authorization')).toBe('Bearer eyJ.test.signature')
    }
  })

  it.each(['https://127.0.0.1:4197/__supabase', 'https://127.0.0.1:4197/__supabase/'])(
    'preserves the TLS bridge prefix for metadata and logo reads (%s)',
    async (url) => {
      state.supabaseUrl = url
      state.contentData = [{ key: 'kicker', lang: 'sv', value: 'Existing source copy' }]
      state.contentOk = true
      const path = 'logo/123e4567-e89b-42d3-a456-426614174000.webp'
      state.discoveryData = {
        settings: { homepage_logo_path: path },
        barbers: [],
        services: [],
        schedules: [],
      }

      await expect(supabaseSiteChromeAdapter.load('sv')).resolves.toMatchObject({
        text: { kicker: 'Existing source copy' },
        homepageLogo: {
          url: `https://127.0.0.1:4197/__supabase/storage/v1/object/public/gallery/${path}`,
        },
      })
      expect(vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(
        ['/__supabase/rest/v1/site_content', '/__supabase/rest/v1/rpc/public_business_discovery'],
      )
    },
  )

  it('waits for Postgres Changes readiness before the authoritative realtime re-read', async () => {
    state.contentData = []
    state.contentOk = true
    state.discoveryData = { settings: {}, barbers: [], services: [], schedules: [] }

    const onChange = vi.fn()
    const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', onChange)
    await vi.waitFor(() => expect(state.subscriptionHandler).toBeDefined())

    state.subscriptionHandler?.('SUBSCRIBED')
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()

    for (const handler of state.systemHandlers) {
      handler({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' })
    }
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce())

    unsubscribe?.()
  })

  it('does not subscribe to anonymous schedule changes that RLS cannot deliver', async () => {
    const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', vi.fn())
    await vi.waitFor(() => expect(state.changeFilters.length).toBeGreaterThan(0))

    expect(state.changeFilters.map((filter) => filter.table)).toEqual([
      'site_content',
      'site_settings',
      'barbers',
      'services',
    ])
    expect(state.changeFilters.some((filter) => filter.table === 'barber_schedules')).toBe(false)

    unsubscribe?.()
  })

  it('revalidates again after reconnect when Postgres Changes becomes ready', async () => {
    state.contentData = []
    state.contentOk = true
    state.discoveryData = { settings: {}, barbers: [], services: [], schedules: [] }

    const onChange = vi.fn()
    const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', onChange)
    await vi.waitFor(() => expect(state.subscriptionHandler).toBeDefined())

    state.subscriptionHandler?.('SUBSCRIBED')
    for (const handler of state.systemHandlers) {
      handler({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' })
    }
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce())

    state.subscriptionHandler?.('SUBSCRIBED')
    await Promise.resolve()
    expect(onChange).toHaveBeenCalledOnce()

    for (const handler of state.systemHandlers) {
      handler({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' })
    }
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))

    unsubscribe?.()
  })

  it('does not publish an unresolved realtime reload', async () => {
    const onChange = vi.fn()
    const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', onChange)
    await vi.waitFor(() => expect(state.changeHandlers.length).toBeGreaterThan(0))

    state.changeHandlers[0]?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()

    unsubscribe?.()
    expect(state.removeChannel).toHaveBeenCalledOnce()
  })

  it('hydrates a whitelisted processed homepage logo from discovery settings', async () => {
    state.contentData = []
    state.contentOk = true
    state.discoveryData = {
      settings: {
        homepage_logo_path: 'logo/123e4567-e89b-42d3-a456-426614174000.webp',
        homepage_logo_scale: 'lg',
        homepage_logo_style: 'monochrome',
      },
      barbers: [],
      services: [],
      schedules: [],
    }

    await expect(supabaseSiteChromeAdapter.load('sv')).resolves.toMatchObject({
      homepageLogo: {
        path: 'logo/123e4567-e89b-42d3-a456-426614174000.webp',
        url: 'https://example.supabase.co/storage/v1/object/public/gallery/logo/123e4567-e89b-42d3-a456-426614174000.webp',
        scale: 'lg',
        style: 'monochrome',
      },
    })
  })

  it('opens no channel when the subscription is closed before Realtime is ready', async () => {
    let release = (): void => undefined
    state.realtimeReady = new Promise<void>((resolve) => {
      release = resolve
    })
    const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', vi.fn())
    unsubscribe?.()
    release()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(state.subscriptionHandler).toBeUndefined()
    expect(state.changeFilters).toEqual([])
    expect(state.removeChannel).not.toHaveBeenCalled()
  })

  it('surfaces a Realtime client that fails to load instead of swallowing it', async () => {
    const failure = new Error('realtime chunk failed to load')
    let fail: (reason: unknown) => void = () => undefined
    state.realtimeReady = new Promise<void>((_resolve, reject) => {
      fail = reject
    })
    const onChange = vi.fn()

    const surfaced = await unhandledRejectionsDuring(async () => {
      const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', onChange)
      fail(failure)
      await flush()
      expect(() => unsubscribe?.()).not.toThrow()
    })

    expect(surfaced).toEqual([failure])
    expect(state.subscriptionHandler).toBeUndefined()
    expect(state.removeChannel).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens no channel and still surfaces the failure when it closes before the client fails', async () => {
    const failure = new Error('realtime chunk failed to load')
    let fail: (reason: unknown) => void = () => undefined
    state.realtimeReady = new Promise<void>((_resolve, reject) => {
      fail = reject
    })

    const surfaced = await unhandledRejectionsDuring(async () => {
      const unsubscribe = supabaseSiteChromeAdapter.subscribe?.('sv', vi.fn())
      expect(() => unsubscribe?.()).not.toThrow()
      fail(failure)
      await flush()
    })

    expect(surfaced).toEqual([failure])
    expect(state.subscriptionHandler).toBeUndefined()
    expect(state.changeFilters).toEqual([])
    expect(state.removeChannel).not.toHaveBeenCalled()
  })
})
