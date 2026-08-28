import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  contentData: null as readonly unknown[] | null,
  discoveryData: null as unknown,
  contentOk: false,
  discoveryOk: true,
  changeHandlers: [] as (() => void)[],
  systemHandlers: [] as ((payload: unknown) => void)[],
  subscriptionHandler: undefined as ((status: string) => void) | undefined,
  removeChannel: vi.fn(),
}))

vi.mock('../../src/backend/config', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ.test.signature',
  isBackendConfigured: () => true,
}))

vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => {
    const channel = {
      on: vi.fn((event: string, _filter: unknown, handler: (payload?: unknown) => void) => {
        if (event === 'system') state.systemHandlers.push(handler)
        if (event === 'postgres_changes') state.changeHandlers.push(handler)
        return channel
      }),
      subscribe: vi.fn((handler?: (status: string) => void) => {
        state.subscriptionHandler = handler
        return channel
      }),
    }
    return {
      channel: () => channel,
      removeChannel: state.removeChannel,
    }
  },
}))

import { supabaseSiteChromeAdapter } from '../../src/site/adapters/supabaseSiteChrome'

describe('Supabase site chrome resolution', () => {
  beforeEach(() => {
    state.contentData = null
    state.discoveryData = null
    state.contentOk = false
    state.discoveryOk = true
    state.changeHandlers = []
    state.systemHandlers = []
    state.subscriptionHandler = undefined
    state.removeChannel.mockReset()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input.toString())
        if (url.pathname === '/rest/v1/site_content') {
          return new Response(JSON.stringify(state.contentData), {
            status: state.contentOk ? 200 : 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (url.pathname === '/rest/v1/rpc/public_business_discovery') {
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
})
