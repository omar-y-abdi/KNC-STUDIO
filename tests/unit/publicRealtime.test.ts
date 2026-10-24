import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'
const BASES = [
  'https://example.supabase.co',
  'https://example.supabase.co/',
  'https://127.0.0.1:4197/__supabase',
  'http://localhost:54321',
]

async function loadRealtime(projectUrl: string) {
  vi.resetModules()
  vi.doMock('../../src/backend/config', () => ({
    SUPABASE_URL: projectUrl,
    SUPABASE_ANON_KEY: KEY,
    isBackendConfigured: () => true,
  }))
  return import('../../src/backend/publicRealtime')
}

/** A WebSocket that records the address it was opened with and every frame sent to it. */
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readyState = 0
  readonly protocol = ''
  binaryType = 'arraybuffer'
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly sent: string[] = []
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.opened.push(this)
  }
  send(frame: unknown): void {
    this.sent.push(typeof frame === 'string' ? frame : '[binary frame]')
  }
  close(): void {
    this.readyState = this.CLOSED
  }
  readonly addEventListener = vi.fn()
  readonly removeEventListener = vi.fn()
  open(): void {
    this.readyState = this.OPEN
    this.onopen?.({})
  }
}

interface Subscribable {
  channel(topic: string): {
    on(...args: unknown[]): unknown
    subscribe(): unknown
  }
  endpointURL(): string
  accessToken: (() => Promise<string | null>) | null
}

/** What a client puts on the wire for the site-chrome subscription, up to the first frames. */
async function wireOf(realtime: Subscribable) {
  const first = FakeSocket.opened.length
  const channel = realtime.channel('site-chrome:sv') as {
    on(...args: unknown[]): typeof channel
    subscribe(): void
  }
  channel
    .on('system', {}, () => undefined)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'site_content', filter: 'lang=eq.sv' },
      () => undefined,
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'barbers' }, () => undefined)
    .subscribe()
  await vi.waitFor(() => expect(FakeSocket.opened.length).toBe(first + 1))
  const socket = FakeSocket.opened[first]
  if (socket === undefined) throw new Error('the client never opened a socket')
  socket.open()
  await new Promise((resolve) => setTimeout(resolve, 30))
  return {
    endpoint: realtime.endpointURL(),
    token: await realtime.accessToken?.(),
    address: socket.url,
    frames: socket.sent,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../src/backend/config')
  vi.doUnmock('@supabase/realtime-js')
  FakeSocket.opened.length = 0
})

describe('public Realtime client', () => {
  it.each(BASES)('puts the same bytes on the wire as supabase-js for %s', async (base) => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const previous = createClient(base, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const old = await wireOf(previous.realtime as unknown as Subscribable)

    const { getPublicRealtime } = await loadRealtime(base)
    const current = await wireOf((await getPublicRealtime()) as unknown as Subscribable)

    expect(current.token).toBe(KEY)
    expect(current.address).toContain(`apikey=${KEY}`)
    expect(current).toEqual(old)
    expect(current.frames.length).toBeGreaterThan(0)
  })

  it('loads the library on the first call only, and builds a single shared client', async () => {
    let evaluated = 0
    const constructed: unknown[][] = []
    vi.resetModules()
    vi.doMock('@supabase/realtime-js', () => {
      evaluated += 1
      return {
        RealtimeClient: class {
          readonly args: unknown[]
          constructor(...args: unknown[]) {
            this.args = args
            constructed.push(args)
          }
        },
      }
    })
    const { getPublicRealtime } = await loadRealtime('https://example.supabase.co')
    expect(evaluated).toBe(0)

    const [first, second] = await Promise.all([getPublicRealtime(), getPublicRealtime()])
    expect(first).toBe(second)
    expect(await getPublicRealtime()).toBe(first)
    expect(evaluated).toBe(1)
    expect(constructed).toHaveLength(1)
    expect(constructed[0]?.[0]).toBe('wss://example.supabase.co/realtime/v1')
  })

  it('refuses to exist without a configured backend', async () => {
    vi.resetModules()
    vi.doMock('../../src/backend/config', () => ({
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      isBackendConfigured: () => false,
    }))
    const { getPublicRealtime } = await import('../../src/backend/publicRealtime')
    await expect(getPublicRealtime()).rejects.toThrow(/not configured/)
  })
})
