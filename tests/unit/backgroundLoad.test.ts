import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unhandledRejectionsDuring } from './helpers/unhandledRejections'

// The booking-catalog preload and both live-update subscriptions import their adapter in the
// background (barbersIndex.ts, site/adapters/index.ts). WebKit fails such an import when the visitor
// leaves during it, while the page still runs; that must pass without a trace. A failure while the
// page stays still surfaces as an unhandled rejection, as before.

const CONFIG = '../../src/backend/config'
const CATALOG = '../../src/booking/adapters/supabaseBookingCatalog'
const SITE_CHROME = '../../src/site/adapters/supabaseSiteChrome'

/** One adapter import, held until the test settles it. */
interface HeldImport {
  /** Resolves once the module has been asked for. */
  readonly reached: Promise<void>
  readonly succeed: () => void
  readonly fail: (reason: unknown) => void
}

/** Mocks `path` with `exports`, which arrive only once the test settles the held import. */
function holdImport(path: string, exports: Record<string, unknown>): HeldImport {
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
  vi.doMock(path, async () => {
    arrive()
    await outcome
    return exports
  })
  return { reached, succeed, fail }
}

/** Starts one background import; `adapter` is the adapter function it reaches once loaded. */
type Site = () => Promise<{ readonly held: HeldImport; readonly adapter: ReturnType<typeof vi.fn> }>

const SITES: Record<string, Site> = {
  'the booking-catalog preload': async () => {
    const adapter = vi.fn()
    const held = holdImport(CATALOG, { preloadBookingCatalog: adapter })
    const { preloadBookingCatalog } = await import('../../src/booking/adapters/barbersIndex')
    preloadBookingCatalog()
    return { held, adapter }
  },
  'the booking-catalog subscription': async () => {
    const adapter = vi.fn(() => () => undefined)
    const held = holdImport(CATALOG, { subscribeBookingCatalog: adapter })
    const { subscribeBookingCatalog } = await import('../../src/booking/adapters/barbersIndex')
    subscribeBookingCatalog(() => undefined)
    return { held, adapter }
  },
  'the site-chrome subscription': async () => {
    const adapter = vi.fn(() => () => undefined)
    const held = holdImport(SITE_CHROME, {
      supabaseSiteChromeAdapter: { load: vi.fn(), subscribe: adapter },
    })
    const { defaultSiteChromePort } = await import('../../src/site/adapters')
    defaultSiteChromePort.subscribe?.('sv', () => undefined)
    return { held, adapter }
  },
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A page for the modules: its window events, and a network that is up. */
function stubPage(): EventTarget {
  const page = new EventTarget()
  vi.stubGlobal('window', page)
  vi.stubGlobal('navigator', { onLine: true })
  return page
}

beforeEach(() => {
  vi.resetModules()
  vi.doMock(CONFIG, () => ({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'eyJ.test.signature',
    isBackendConfigured: () => true,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const path of [CONFIG, CATALOG, SITE_CHROME]) vi.doUnmock(path)
})

describe.each(Object.entries(SITES))('%s', (_name, start) => {
  it('passes without a trace when the page starts leaving during its import', async () => {
    const page = stubPage()
    const surfaced = await unhandledRejectionsDuring(async () => {
      const { held, adapter } = await start()
      await held.reached
      page.dispatchEvent(new Event('beforeunload'))
      held.fail(new TypeError('Importing a module script failed.'))
      await flush()
      expect(adapter).not.toHaveBeenCalled()
    })
    expect(surfaced).toEqual([])
  })

  it('still surfaces an import failure while the page stays', async () => {
    stubPage()
    const failure = new TypeError('Importing a module script failed.')
    const surfaced = await unhandledRejectionsDuring(async () => {
      const { held } = await start()
      await held.reached
      held.fail(failure)
      await flush()
    })
    expect(surfaced).toMatchObject([{ cause: failure }])
  })

  it('reaches the adapter once its import succeeds', async () => {
    stubPage()
    const { held, adapter } = await start()
    await held.reached
    held.succeed()
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce())
  })
})
