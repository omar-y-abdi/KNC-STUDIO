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
  vi.doMock('../../modules/public-web/src/backend/config', () => ({
    SUPABASE_URL: projectUrl,
    SUPABASE_ANON_KEY: KEY,
    isBackendConfigured: () => true,
  }))
  return import('../../modules/public-web/src/backend/publicRealtime')
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

/** One import of the library, held until the test settles it. */
interface HeldLoad {
  /** Resolves once the import has asked for the library. */
  readonly reached: Promise<void>
  readonly succeed: () => void
  readonly fail: (reason: unknown) => void
}

/**
 * Mocks the library so that every import waits for the next load the test queued. Vitest wraps a
 * failing factory in its own Error and keeps the reason as `cause`.
 */
function holdLibrary() {
  const queued: { readonly arrive: () => void; readonly outcome: Promise<void> }[] = []
  const constructed: unknown[][] = []
  vi.doMock('@supabase/realtime-js', async () => {
    const load = queued.shift()
    if (load === undefined) throw new Error('the library was imported more often than queued')
    load.arrive()
    await load.outcome
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
  const queue = (): HeldLoad => {
    let arrive = (): void => undefined
    let succeed = (): void => undefined
    let fail: (reason: unknown) => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      arrive = resolve
    })
    const outcome = new Promise<void>((resolve, reject) => {
      succeed = resolve
      fail = reject
    })
    queued.push({ arrive, outcome })
    return { reached, succeed, fail }
  }
  return { queue, constructed }
}

/** The settled outcome of a client request, so a rejection can be compared like a value. */
function settled(client: Promise<unknown>): Promise<{ client: unknown } | { error: unknown }> {
  return client.then(
    (value) => ({ client: value }),
    (error: unknown) => ({ error }),
  )
}

/** A browser page for the module: its window events and the network state it reports. */
function stubPage() {
  const page = new EventTarget()
  const network = { onLine: true }
  vi.stubGlobal('window', page)
  vi.stubGlobal('navigator', network)
  return { page, network }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../modules/public-web/src/backend/config')
  vi.doUnmock('@supabase/realtime-js')
  FakeSocket.opened.length = 0
})

describe('public Realtime client', () => {
  it.each(BASES)('puts the same bytes on the wire as supabase-js for %s', async (base) => {
    stubPage()
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
    stubPage()
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
    vi.doMock('../../modules/public-web/src/backend/config', () => ({
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      isBackendConfigured: () => false,
    }))
    const { getPublicRealtime } =
      await import('../../modules/public-web/src/backend/publicRealtime')
    await expect(getPublicRealtime()).rejects.toThrow(/not configured/)
  })

  // WebKit stops a document's pending loads once a navigation away from it starts, and rejects the
  // import while the document still runs. Live updates are an enhancement: that page is leaving.
  it('gives no client when the page starts leaving while the library loads', async () => {
    const { page } = stubPage()
    const library = holdLibrary()
    const { getPublicRealtime } = await loadRealtime('https://example.supabase.co')
    const load = library.queue()

    const client = getPublicRealtime()
    await load.reached
    page.dispatchEvent(new Event('beforeunload'))
    load.fail(new TypeError('Importing a module script failed.'))

    expect(await settled(client)).toEqual({ client: null })
  })

  it('gives no client while offline, then loads again on the next call', async () => {
    const { network } = stubPage()
    const library = holdLibrary()
    const { getPublicRealtime } = await loadRealtime('https://example.supabase.co')
    const load = library.queue()

    const client = getPublicRealtime()
    await load.reached
    network.onLine = false
    load.fail(new TypeError('Load failed'))
    expect(await settled(client)).toEqual({ client: null })

    network.onLine = true
    library.queue().succeed()
    expect(await settled(getPublicRealtime())).toMatchObject({ client: expect.any(Object) })
    expect(library.constructed.map(([endpoint]) => endpoint)).toEqual([
      'wss://example.supabase.co/realtime/v1',
    ])
  })

  it('rejects a failure while the page stays, then loads again on the next call', async () => {
    stubPage()
    const library = holdLibrary()
    const { getPublicRealtime } = await loadRealtime('https://example.supabase.co')
    const failure = new TypeError('Importing a module script failed.')
    const first = library.queue()

    const failed = getPublicRealtime()
    await first.reached
    first.fail(failure)
    expect(await settled(failed)).toMatchObject({ error: { cause: failure } })

    const second = library.queue()
    const loaded = getPublicRealtime()
    await second.reached
    second.succeed()
    expect(await settled(loaded)).toMatchObject({ client: expect.any(Object) })
    expect(library.constructed.map(([endpoint]) => endpoint)).toEqual([
      'wss://example.supabase.co/realtime/v1',
    ])
  })

  it('rejects a failure when the page only started leaving before the library was requested', async () => {
    const { page } = stubPage()
    const library = holdLibrary()
    const { getPublicRealtime } = await loadRealtime('https://example.supabase.co')
    const failure = new TypeError('Importing a module script failed.')
    // A navigation that turned into a download fires beforeunload and leaves the page in place.
    page.dispatchEvent(new Event('beforeunload'))
    const load = library.queue()

    const client = getPublicRealtime()
    await load.reached
    load.fail(failure)

    expect(await settled(client)).toMatchObject({ error: { cause: failure } })
  })

  it('keeps no beforeunload listener once the library has loaded', async () => {
    const { page } = stubPage()
    const added = vi.spyOn(page, 'addEventListener')
    const removed = vi.spyOn(page, 'removeEventListener')
    const library = holdLibrary()
    const { getPublicRealtime } = await loadRealtime('https://example.supabase.co')
    const load = library.queue()

    const client = getPublicRealtime()
    await load.reached
    load.succeed()
    await client

    const leaving = (calls: unknown[][]) =>
      calls.filter(([type]) => type === 'beforeunload').map(([, listener]) => listener)
    expect(leaving(added.mock.calls)).toHaveLength(1)
    expect(leaving(removed.mock.calls)).toEqual(leaving(added.mock.calls))
  })
})
