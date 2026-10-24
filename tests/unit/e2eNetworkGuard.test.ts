import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  THIRD_PARTY_ALLOWLIST,
  createNetworkGuard,
  guardOf,
  judgeUrl,
  networkPolicy,
} from '../../tools/e2e/network-guard.mjs'

const publicPolicy = networkPolicy({ baseURL: 'http://127.0.0.1:4188', group: 'public' })
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

describe('judgeUrl', () => {
  it.each([
    'http://127.0.0.1:4188/tools/e2e/admin-harness.html',
    'https://127.0.0.1:4197/__supabase/rest/v1/barbers',
    'http://127.0.0.1:54321/rest/v1/barbers',
    'http://localhost:5173/',
    'https://admin-harness.invalid/rest/v1/rpc/public_booking_catalog',
    'wss://admin-harness.invalid/realtime/v1/websocket?apikey=key',
    'data:text/plain;base64,aGk=',
    'blob:http://127.0.0.1:4188/6f1c0c2e',
  ])('allows %s', (url) => {
    expect(judgeUrl(url, publicPolicy)).toEqual({ allowed: true })
  })

  it.each([
    ['https://bladeblendstudio.se/api/cms/presentation', 'production-host'],
    ['https://www.bladeblendstudio.se/', 'production-host'],
    ['https://BladeBlendStudio.se./', 'production-host'],
    ['http://127.0.0.1@bladeblendstudio.se/', 'production-host'],
    ['https://example.supabase.co/rest/v1/rpc/public_booking_catalog', 'production-host'],
    ['wss://abcdefghij.supabase.co/realtime/v1/websocket', 'production-host'],
    [TURNSTILE_SCRIPT, 'foreign-host'],
    ['https://127.0.0.1.attacker.example/', 'foreign-host'],
    ['https://admin-harness.invalid.attacker.example/', 'foreign-host'],
    ['http://[::1]:4188/', 'foreign-host'],
    ['ftp://127.0.0.1/file', 'unsupported-scheme'],
    ['file:///etc/passwd', 'unsupported-scheme'],
    ['javascript:void(0)', 'unsupported-scheme'],
    ['/relative/path', 'unparseable-url'],
    ['', 'unparseable-url'],
  ])('blocks %s as %s', (url, reason) => {
    expect(judgeUrl(url, publicPolicy)).toMatchObject({ allowed: false, reason })
  })

  it('reports the offending host so failures are actionable', () => {
    expect(judgeUrl('https://example.supabase.co/x', publicPolicy)).toEqual({
      allowed: false,
      reason: 'production-host',
      host: 'example.supabase.co',
    })
  })
})

describe('networkPolicy', () => {
  it('allows a non-local base URL host', () => {
    const lan = networkPolicy({ baseURL: 'http://192.0.2.10:4188', group: 'public' })
    expect(judgeUrl('http://192.0.2.10:4188/x', lan)).toEqual({ allowed: true })
  })

  it('refuses a production host even when it is the base URL', () => {
    const production = networkPolicy({ baseURL: 'https://bladeblendstudio.se', group: 'public' })
    expect(judgeUrl('https://bladeblendstudio.se/', production)).toMatchObject({
      allowed: false,
      reason: 'production-host',
    })
  })

  it('fails loudly on an invalid base URL instead of ignoring it', () => {
    expect(() => networkPolicy({ baseURL: 'not a url', group: 'public' })).toThrow()
  })

  it('lets a missing base URL fall back to the fixed local hosts', () => {
    const policy = networkPolicy({ baseURL: undefined, group: 'public' })
    expect(judgeUrl('http://127.0.0.1:4188/', policy)).toEqual({ allowed: true })
  })

  it('applies a third-party allowlist entry only to its own groups', () => {
    const customer = networkPolicy({ baseURL: 'https://127.0.0.1:4197', group: 'customer' })
    expect(judgeUrl(TURNSTILE_SCRIPT, customer)).toEqual({ allowed: true })
    for (const group of ['public', 'cms', 'startup', undefined]) {
      expect(
        judgeUrl(TURNSTILE_SCRIPT, networkPolicy({ baseURL: 'http://127.0.0.1:4188', group })),
      ).toMatchObject({ allowed: false, reason: 'foreign-host' })
    }
  })

  it('documents every allowlist entry and never allowlists a production host', () => {
    expect(THIRD_PARTY_ALLOWLIST.length).toBeGreaterThan(0)
    for (const entry of THIRD_PARTY_ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(40)
      expect(entry.groups.length).toBeGreaterThan(0)
      expect(entry.host).toBe(entry.host.toLowerCase())
      expect(entry.host).not.toMatch(/(^|\.)(bladeblendstudio\.se|supabase\.co)$/)
    }
  })
})

interface FakeRoute {
  request: () => { url: () => string; method: () => string }
  abort: ReturnType<typeof vi.fn>
}
interface FakeSocket {
  url: () => string
  close: ReturnType<typeof vi.fn>
}
interface Registration<T> {
  matches: (url: URL) => boolean
  handle: (target: T) => unknown
}

const API_METHODS = ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'] as const

function fakeRoute(url: string, method = 'GET'): FakeRoute {
  return {
    request: () => ({ url: () => url, method: () => method }),
    abort: vi.fn().mockResolvedValue(undefined),
  }
}

function fakeSocket(url: string): FakeSocket {
  return { url: () => url, close: vi.fn().mockResolvedValue(undefined) }
}

function fakeContext() {
  const routes: Registration<FakeRoute>[] = []
  const sockets: Registration<FakeSocket>[] = []
  const reachNetwork = () => vi.fn().mockResolvedValue('reached the network')
  const originals = {
    fetch: reachNetwork(),
    get: reachNetwork(),
    post: reachNetwork(),
    put: reachNetwork(),
    patch: reachNetwork(),
    delete: reachNetwork(),
    head: reachNetwork(),
  }
  return {
    routes,
    sockets,
    originals,
    request: { ...originals },
    route: vi.fn(async (matches: Registration<FakeRoute>['matches'], handle) => {
      routes.push({ matches, handle })
    }),
    routeWebSocket: vi.fn(async (matches: Registration<FakeSocket>['matches'], handle) => {
      sockets.push({ matches, handle })
    }),
  }
}

async function attached(policy = publicPolicy) {
  const guard = createNetworkGuard(policy)
  const context = fakeContext()
  await guard.attach(context)
  return { guard, context }
}

describe('createNetworkGuard', () => {
  it('routes only blocked requests, aborts them and records the attempt', async () => {
    const { guard, context } = await attached()
    const [registration] = context.routes
    expect(registration?.matches(new URL('https://bladeblendstudio.se/x'))).toBe(true)
    expect(registration?.matches(new URL('http://127.0.0.1:4188/x'))).toBe(false)
    expect(registration?.matches(new URL('https://admin-harness.invalid/rest/v1/x'))).toBe(false)

    const route = fakeRoute('https://bladeblendstudio.se/api/cms/presentation')
    await registration?.handle(route)
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(guard.violations).toEqual([
      {
        channel: 'request',
        method: 'GET',
        url: 'https://bladeblendstudio.se/api/cms/presentation',
        reason: 'production-host',
      },
    ])
  })

  it('records the request before aborting so a failed abort cannot hide it', async () => {
    const { guard, context } = await attached()
    const route = fakeRoute('https://example.supabase.co/rest/v1/rpc/x', 'POST')
    route.abort.mockRejectedValue(new Error('Target closed'))
    await expect(context.routes[0]?.handle(route)).rejects.toThrow('Target closed')
    expect(guard.violations).toHaveLength(1)
  })

  it('closes and records blocked WebSockets and leaves allowed ones alone', async () => {
    const { guard, context } = await attached()
    const [registration] = context.sockets
    expect(
      registration?.matches(new URL('wss://abcdefghij.supabase.co/realtime/v1/websocket')),
    ).toBe(true)
    expect(registration?.matches(new URL('ws://127.0.0.1:4188/?token=hmr'))).toBe(false)
    expect(
      registration?.matches(new URL('wss://admin-harness.invalid/realtime/v1/websocket')),
    ).toBe(false)

    const socket = fakeSocket('wss://abcdefghij.supabase.co/realtime/v1/websocket')
    await registration?.handle(socket)
    expect(socket.close).toHaveBeenCalledWith({ code: 1008, reason: expect.any(String) })
    expect(guard.violations).toEqual([
      {
        channel: 'websocket',
        method: 'GET',
        url: 'wss://abcdefghij.supabase.co/realtime/v1/websocket',
        reason: 'production-host',
      },
    ])
  })

  it.each(API_METHODS)('rejects and records a blocked API request via %s', async (method) => {
    const { guard, context } = await attached()
    const call = context.request[method] as (target: unknown) => Promise<unknown>
    await expect(call('https://bladeblendstudio.se/robots.txt')).rejects.toThrow(/network guard/)
    expect(context.originals[method]).not.toHaveBeenCalled()
    expect(guard.violations).toMatchObject([
      { channel: 'api-request', url: 'https://bladeblendstudio.se/robots.txt' },
    ])
  })

  it('judges the URL of a Request object passed to fetch', async () => {
    const { context } = await attached()
    const blocked = { url: () => 'https://example.supabase.co/x' }
    await expect(context.request.fetch(blocked)).rejects.toThrow(/network guard/)
  })

  it('passes allowed API requests through untouched, resolving relative URLs on the base URL', async () => {
    const { guard, context } = await attached()
    const options = { timeout: 1000 }
    await expect(context.request.get('http://127.0.0.1:4173/robots.txt', options)).resolves.toBe(
      'reached the network',
    )
    expect(context.originals['get']).toHaveBeenCalledWith(
      'http://127.0.0.1:4173/robots.txt',
      options,
    )
    await context.request.get('/privacy')
    expect(context.originals['get']).toHaveBeenLastCalledWith('/privacy', undefined)
    expect(guard.violations).toEqual([])
  })

  it('blocks a relative API URL when there is no base URL to resolve it on', async () => {
    const { context } = await attached(networkPolicy({ baseURL: undefined, group: 'public' }))
    await expect(context.request.get('/privacy')).rejects.toThrow(/network guard/)
  })

  it('fails the test on teardown and names every blocked request', async () => {
    const { guard, context } = await attached()
    await context.routes[0]?.handle(fakeRoute('https://bladeblendstudio.se/'))
    await context.sockets[0]?.handle(
      fakeSocket('wss://abcdefghij.supabase.co/realtime/v1/websocket'),
    )
    expect(() => guard.assertClean()).toThrowError(
      /2 request\(s\)[\s\S]*GET https:\/\/bladeblendstudio\.se\/ \[production-host\][\s\S]*websocket/,
    )
  })

  it('stays silent when nothing was blocked', async () => {
    const { guard } = await attached()
    expect(() => guard.assertClean()).not.toThrow()
  })

  it('shortens very long violation lists in the failure message', async () => {
    const { guard, context } = await attached()
    for (let index = 0; index < 25; index++)
      await context.routes[0]?.handle(fakeRoute(`https://bladeblendstudio.se/${index}`))
    expect(() => guard.assertClean()).toThrowError(/and 5 more/)
  })

  it('lets a deliberate probe drain what it provoked and nothing else', async () => {
    const { guard, context } = await attached()
    await context.routes[0]?.handle(fakeRoute('https://bladeblendstudio.se/'))
    expect(guard.takeViolations()).toHaveLength(1)
    expect(() => guard.assertClean()).not.toThrow()
    expect(guard.takeViolations()).toEqual([])
  })

  it('attaches once per context and can be found again from the context', async () => {
    const { guard, context } = await attached()
    await guard.attach(context)
    expect(context.route).toHaveBeenCalledTimes(1)
    expect(context.routeWebSocket).toHaveBeenCalledTimes(1)
    expect(guardOf(context)).toBe(guard)
  })

  it('refuses to hand out a guard for a context the fixtures never saw', () => {
    expect(() => guardOf({})).toThrow(/guarded fixtures/)
  })
})

describe('e2e suite wiring', () => {
  const e2eDir = fileURLToPath(new URL('../../tools/e2e/', import.meta.url))
  const sources = readdirSync(e2eDir)
    .filter((name) => /\.(mjs|tsx)$/.test(name))
    .map((name) => ({ name, text: readFileSync(join(e2eDir, name), 'utf8') }))
  const specs = sources.filter(({ name }) => name.endsWith('.spec.mjs'))

  it('gives every spec its test object from a fixtures module that carries the guard', () => {
    const guardedImport = /import \{[^}]*\btest\b[^}]*\} from '\.\/(?:customer-)?fixtures\.mjs'/
    expect(specs.length).toBeGreaterThan(30)
    expect(specs.filter(({ text }) => !guardedImport.test(text)).map(({ name }) => name)).toEqual(
      [],
    )
  })

  it('creates browser contexts only in fixture modules, and attaches the guard there', () => {
    const creation =
      /\b(?:browser\.newContext|browser\.newPage|launchPersistentContext)\(|\b(?:chromium|firefox|webkit)\.launch\(/
    const creators = sources.filter(({ text }) => creation.test(text))
    expect(creators.map(({ name }) => name).sort()).toEqual([
      'customer-fixtures.mjs',
      'fixtures.mjs',
    ])
    for (const { text } of creators) expect(text).toMatch(/networkGuard\.attach\(/)
  })

  it('lets only the guard spec drain recorded violations', () => {
    const drainers = specs.filter(({ text }) => /\.takeViolations\(/.test(text))
    expect(drainers.map(({ name }) => name)).toEqual(['network-guard.spec.mjs'])
  })
})
