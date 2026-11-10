import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { h, isValidElement, render, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  validatePresentation,
  type CmsPresentation,
  type PageVariant,
} from '../../packages/content-contracts/src/cms'
import { repairDesktopCss } from '../../packages/content-contracts/src/cms-device-css'
import type * as NativeSurfaceModule from '../../modules/public-web/src/cms/NativeSurface'

// Audit E 15a: css-tree is no longer on the boot path; NativeSiteProvider imports the Desktop
// breakpoint repair on demand. These renders pin when that import happens, and that the native
// surfaces never receive a legacy sheet unrepaired: the provider shows its gate until the repair is
// there. The node environment has no DOMParser, so the <style> elements themselves are exercised by
// the browser suites (rev-56 fixture); here the provider's output is read as VNodes, as in
// cmsNativeRegion.test.ts.

const REPAIR_CHUNK = '@bladeblend/content-contracts/cms-device-css'
const SURFACE_PATHS = ['/', '/about', '/booking', '/my-bookings']

function storedPresentation(): CmsPresentation {
  const response: unknown = JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
    ).toString('utf8'),
  )
  if (!response || typeof response !== 'object' || !('presentation' in response))
    throw new Error('Invalid stored presentation')
  validatePresentation(response.presentation)
  return response.presentation
}

const stored = storedPresentation()

/** Each page with both sheets of both languages as the render-time repair returned them. */
function repairedEverywhere(presentation: CmsPresentation): CmsPresentation {
  const repair = (variant: PageVariant): PageVariant => ({
    ...variant,
    css: { light: repairDesktopCss(variant.css.light), dark: repairDesktopCss(variant.css.dark) },
  })
  return {
    ...presentation,
    pages: presentation.pages.map((page) => ({
      ...page,
      content: { sv: repair(page.content.sv), en: repair(page.content.en) },
    })),
  }
}

/** Every sheet a native surface renders, in page, language and mode order. */
function surfaceSheets(presentation: CmsPresentation | null): string[] {
  return (presentation?.pages ?? [])
    .filter((page) => SURFACE_PATHS.includes(page.path))
    .flatMap((page) =>
      (['sv', 'en'] as const).flatMap((lang) =>
        (['light', 'dark'] as const).map((mode) => page.content[lang].css[mode]),
      ),
    )
}

const repairedSheets = surfaceSheets(repairedEverywhere(stored))

/** One import of the repair chunk, held until the test settles it. */
interface HeldImport {
  /** Resolves once the provider has asked for the chunk. */
  readonly reached: Promise<void>
  readonly succeed: () => void
  readonly fail: (reason: unknown) => void
}

/** Mocks the repair chunk so that every import waits for the next load the test queued. */
function holdRepairChunk() {
  const queued: { readonly arrive: () => void; readonly outcome: Promise<void> }[] = []
  let imports = 0
  vi.doMock(REPAIR_CHUNK, async () => {
    imports += 1
    const load = queued.shift()
    if (load === undefined) throw new Error('the repair chunk was imported more often than queued')
    load.arrive()
    await load.outcome
    return { repairDesktopCss }
  })
  const queue = (): HeldImport => {
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
  return { queue, imports: () => imports }
}

async function loadSurface(pathname: string): Promise<typeof NativeSurfaceModule> {
  vi.resetModules()
  vi.doMock('wouter-preact', () => ({ useLocation: () => [pathname, () => undefined] }))
  return import('../../modules/public-web/src/cms/NativeSurface')
}

/** What one render of the provider produced: its gate, or the site with the presentation the
 * native surfaces receive. */
type Frame =
  | { readonly kind: 'gate'; readonly error: boolean; readonly retry: () => void }
  | { readonly kind: 'site'; readonly presentation: CmsPresentation | null }

function frameOf(output: ComponentChildren): Frame {
  if (!isValidElement(output)) throw new Error('the provider rendered no element')
  const props = output.props as Record<string, unknown>
  if (typeof props['onRetry'] === 'function')
    return { kind: 'gate', error: props['error'] === true, retry: props['onRetry'] as () => void }
  const value = props['value']
  if (!value || typeof value !== 'object' || !('presentation' in value))
    throw new Error('the provider rendered neither its gate nor the site')
  return { kind: 'site', presentation: value.presentation as CmsPresentation | null }
}

type ProviderProps = Parameters<(typeof NativeSurfaceModule)['NativeSiteProvider']>[0]

const containers: HTMLElement[] = []

/** Renders the provider inside a probe that records every output and returns null, so the node
 * environment needs no host DOM. */
function mount(
  Provider: (typeof NativeSurfaceModule)['NativeSiteProvider'],
  props: Omit<ProviderProps, 'children'>,
) {
  const container = {} as HTMLElement
  containers.push(container)
  const frames: Frame[] = []
  function Probe() {
    frames.push(frameOf(Provider({ ...props, children: null })))
    return null
  }
  act(() => render(h(Probe, {}), container))
  return { frames, latest: () => frames.at(-1) }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Every site frame rendered the repaired sheets; no frame ever offered the stored legacy ones. */
function expectOnlyRepairedSites(frames: readonly Frame[]): void {
  const sites = frames.filter((frame) => frame.kind === 'site')
  expect(sites.length).toBeGreaterThan(0)
  for (const frame of sites) expect(surfaceSheets(frame.presentation)).toEqual(repairedSheets)
}

beforeEach(() => {
  // Preact's render compares its parent with `document`; the visitor read names no revision.
  vi.stubGlobal('document', { documentElement: { getAttribute: () => null } })
})

afterEach(() => {
  for (const container of containers) act(() => render(null, container))
  containers.length = 0
  vi.unstubAllGlobals()
  vi.doUnmock('wouter-preact')
  vi.doUnmock(REPAIR_CHUNK)
})

describe('NativeSiteProvider Desktop breakpoint repair (audit E 15a)', () => {
  it('fixture: the stored /about en sheets need the repair and the repair changes them', () => {
    expect(repairedSheets).not.toEqual(surfaceSheets(stored))
  })

  it('renders a passed presentation without legacy sheets at once and never imports the chunk', async () => {
    const chunk = holdRepairChunk()
    const { NativeSiteProvider } = await loadSurface('/')
    const clean = repairedEverywhere(stored)
    const view = mount(NativeSiteProvider, { presentation: clean })
    expect(view.frames.map((frame) => frame.kind)).toEqual(['site'])
    const first = view.frames[0]
    expect(first?.kind === 'site' && first.presentation).toBe(clean)
    await flush()
    await flush()
    expect(chunk.imports()).toBe(0)
  })

  it('holds the gate for a passed legacy presentation until the chunk loads, then renders it repaired', async () => {
    const chunk = holdRepairChunk()
    const { NativeSiteProvider } = await loadSurface('/')
    const load = chunk.queue()
    const view = mount(NativeSiteProvider, { presentation: stored })
    await load.reached
    await flush()
    expect(view.frames.length).toBeGreaterThan(0)
    expect(view.frames.every((frame) => frame.kind === 'gate' && !frame.error)).toBe(true)
    load.succeed()
    await vi.waitFor(() => expect(view.latest()?.kind).toBe('site'))
    expectOnlyRepairedSites(view.frames)
    expect(chunk.imports()).toBe(1)
  })

  it('keeps the visitor gate from the read until the repaired presentation', async () => {
    const chunk = holdRepairChunk()
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ revision: 56, presentation: stored })),
    )
    vi.stubGlobal('fetch', fetch)
    const { NativeSiteProvider } = await loadSurface('/')
    const load = chunk.queue()
    const view = mount(NativeSiteProvider, {})
    await load.reached
    await flush()
    expect(view.frames.every((frame) => frame.kind === 'gate' && !frame.error)).toBe(true)
    load.succeed()
    await vi.waitFor(() => expect(view.latest()?.kind).toBe('site'))
    expectOnlyRepairedSites(view.frames)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(chunk.imports()).toBe(1)
  })

  it('shows a failed load in the gate error and retries only the load, never the read', async () => {
    const chunk = holdRepairChunk()
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ revision: 56, presentation: stored })),
    )
    vi.stubGlobal('fetch', fetch)
    const { NativeSiteProvider } = await loadSurface('/')
    const first = chunk.queue()
    const view = mount(NativeSiteProvider, {})
    await first.reached
    first.fail(new TypeError('Failed to fetch dynamically imported module'))
    await vi.waitFor(() => expect(view.latest()).toMatchObject({ kind: 'gate', error: true }))
    const gate = view.latest()
    if (gate?.kind !== 'gate') throw new Error('expected the gate')
    const second = chunk.queue()
    act(() => gate.retry())
    await second.reached
    expect(view.latest()).toMatchObject({ kind: 'gate', error: false })
    second.succeed()
    await vi.waitFor(() => expect(view.latest()?.kind).toBe('site'))
    expectOnlyRepairedSites(view.frames)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(chunk.imports()).toBe(2)
  })
})
