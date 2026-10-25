import type * as SharedModule from '../../src/app/shared'
import type { VNode } from 'preact'
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AboutSection } from '../../src/about/AboutSection'
import { GalleryMarquee } from '../../src/about/GalleryMarquee'
import { MobileSite } from '../../src/app/MobileSite'
import { shellPalette } from '../../src/app/shared'
import { palette } from '../../src/booking/bookingStyles'
import { appStrings, bookingStrings } from '../../src/i18n/index'
import { DEFAULT_BUSINESS } from '../../src/config'
import { DEFAULT_CHROME } from '../../src/site/siteChrome'

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  effects: [] as (() => undefined | (() => void))[],
}))
const ports = vi.hoisted(() => ({
  overlay: vi.fn(),
  reviews: vi.fn(),
  roster: vi.fn(),
  gallery: vi.fn(),
}))
vi.mock('preact/hooks', () => ({
  useContext: () => null,
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      hooks.values[index],
      (next: unknown) => {
        hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next
      },
    ]
  },
  useRef: (current: unknown) => (hooks.refs[hooks.refCursor++] ??= { current }),
  useEffect: (effect: () => undefined | (() => void)) => {
    hooks.effects.push(effect)
  },
  useLayoutEffect: vi.fn(),
}))
vi.mock('../../src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))
vi.mock('../../src/cms/NativeSurface', () => ({
  useNativeSource: () => false,
  useNativeSurface: (node: unknown) => node,
  useNativeChild: () => (node: unknown) => node,
}))
vi.mock('../../src/app/shared', async (original) => ({
  ...(await original<typeof SharedModule>()),
  useReducedMotion: () => false,
}))
vi.mock('../../src/about/useBarberMarquee', () => ({
  useBarberMarquee: () => ({
    selected: null,
    toggle: vi.fn(),
    reducedMotion: true,
    animate: false,
  }),
}))
vi.mock('../../src/booking/useRoster', () => ({ useRoster: ports.roster }))
vi.mock('../../src/about/gallery/useGallery', () => ({ useGallery: ports.gallery }))
vi.mock('../../src/about/content/index', () => ({
  aboutContentIsMock: false,
  defaultAboutContentPort: { overlay: ports.overlay },
}))
vi.mock('../../src/about/reviews/adapters/index', () => ({
  defaultReviewsPort: { list: ports.reviews },
}))

function render<T>(component: () => T): T {
  hooks.cursor = 0
  hooks.refCursor = 0
  hooks.effects = []
  return component()
}
function mount(): () => void {
  const cleanups = hooks.effects.map((effect) => effect())
  return () => {
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
  }
}
function nodes(node: unknown): VNode<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as VNode<Record<string, unknown>>
  return [vnode, ...nodes(vnode.props.children)]
}
function ref(index: number, value: unknown): void {
  const target = hooks.refs[index]
  if (!target) throw new Error(`Missing component ref ${index}`)
  target.current = value
}

beforeEach(() => {
  hooks.values = []
  hooks.refs = []
  vi.clearAllMocks()
  ports.overlay.mockResolvedValue({})
  ports.reviews.mockResolvedValue([])
  ports.roster.mockReturnValue({ roster: [], loading: false })
  ports.gallery.mockReturnValue({ status: 'ready', photos: [] })
  vi.stubGlobal('window', {
    location: { pathname: '/' },
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false }),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('public performance lifecycles', () => {
  it('defers About reads until intersection, then enables all data ports', async () => {
    const observer: { intersect?: (entries: { isIntersecting: boolean }[]) => void } = {}
    const disconnect = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: NonNullable<typeof observer.intersect>) {
          observer.intersect = callback
        }
        observe = vi.fn()
        disconnect = disconnect
      },
    )
    render(() => AboutSection({ mode: 'light', lang: 'sv' }))
    ref(0, {})
    const dispose = mount()
    expect(ports.overlay).not.toHaveBeenCalled()
    expect(ports.reviews).not.toHaveBeenCalled()
    expect(ports.roster).toHaveBeenLastCalledWith(undefined, false)
    expect(ports.gallery).toHaveBeenLastCalledWith('cuts', undefined, false)
    observer.intersect?.([{ isIntersecting: false }])
    expect(ports.overlay).not.toHaveBeenCalled()
    observer.intersect?.([{ isIntersecting: true }])
    render(() => AboutSection({ mode: 'light', lang: 'sv' }))
    const disposeActive = mount()
    expect(ports.overlay).toHaveBeenCalledWith('sv')
    expect(ports.reviews).toHaveBeenCalledOnce()
    expect(ports.roster).toHaveBeenLastCalledWith(undefined, true)
    expect(ports.gallery).toHaveBeenCalledWith('salon', undefined, true)
    expect(ports.gallery).toHaveBeenCalledWith('cuts', undefined, true)
    expect(disconnect).toHaveBeenCalled()
    await Promise.resolve()
    disposeActive()
    dispose()
  })

  it.each([false, true])(
    'gates gallery frames by reduced motion, intersection and document visibility (reduced=%s)',
    (reduced) => {
      vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) })
      const document = Object.assign(new EventTarget(), { hidden: false })
      vi.stubGlobal('document', document)
      const frame = vi.fn(() => 7)
      const cancel = vi.fn()
      vi.stubGlobal('requestAnimationFrame', frame)
      vi.stubGlobal('cancelAnimationFrame', cancel)
      const observer: { intersect?: (entries: { isIntersecting: boolean }[]) => void } = {}
      const disconnect = vi.fn()
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: NonNullable<typeof observer.intersect>) {
            observer.intersect = callback
          }
          observe = vi.fn()
          disconnect = disconnect
        },
      )
      const tree = render(() =>
        GalleryMarquee({
          photos: [{ id: 'one', url: '/one.webp', alt: 'One' }],
          alt: 'Photo',
          c: palette(false),
        }),
      )
      const row = nodes(tree).find((node) => typeof node.type === 'function')
      if (!row || typeof row.type !== 'function') throw new Error('Missing gallery row')
      hooks.values = []
      hooks.refs = []
      render(() => (row.type as (props: unknown) => unknown)(row.props))
      ref(0, {})
      const dispose = mount()
      expect(frame).not.toHaveBeenCalled()
      if (reduced) {
        expect(observer.intersect).toBeUndefined()
      } else {
        observer.intersect?.([{ isIntersecting: true }])
        expect(frame).toHaveBeenCalledOnce()
        document.hidden = true
        document.dispatchEvent(new Event('visibilitychange'))
        expect(cancel).toHaveBeenCalledWith(7)
        observer.intersect?.([{ isIntersecting: false }])
        observer.intersect?.([{ isIntersecting: true }])
        expect(frame).toHaveBeenCalledOnce()
        observer.intersect?.([{ isIntersecting: false }])
        document.hidden = false
        document.dispatchEvent(new Event('visibilitychange'))
        expect(frame).toHaveBeenCalledOnce()
        observer.intersect?.([{ isIntersecting: true }])
        expect(frame).toHaveBeenCalledTimes(2)
      }
      dispose()
      document.dispatchEvent(new Event('visibilitychange'))
      expect(frame).toHaveBeenCalledTimes(reduced ? 0 : 2)
      if (!reduced) expect(disconnect).toHaveBeenCalledOnce()
    },
  )

  it('coalesces mobile scrolls into one frame, reads the latest position, and cancels pending work on disposal', () => {
    const callbacks: FrameRequestCallback[] = []
    const frame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', frame)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const tree = render(() =>
      MobileSite({
        mode: 'light',
        lang: 'sv',
        tx: appStrings('sv'),
        dark: false,
        c: shellPalette(false),
        view: 'home',
        mobMutedColor: '#666',
        mobBtnBgColor: '#fff',
        business: DEFAULT_BUSINESS,
        chromeIconStyle: {},
        themeToggle: h('span', null),
        langToggle: h('span', null),
        openMobBooking: vi.fn(),
        scrollToAbout: vi.fn(),
        scrollMobToHero: vi.fn(),
        openCancel: vi.fn(),
        openMyBookings: vi.fn(),
        homepageScale: 'md',
        homepageLogo: DEFAULT_CHROME.homepageLogo,
        aboutScale: 'md',
        bookingPopupText: bookingStrings('sv'),
      }),
    )
    const root = { scrollTop: 0 }
    ref(0, root)
    const dispose = mount()
    const host = nodes(tree).find((node) => node.props['data-testid'] === 'mobile-site-scroll')
    if (!host) throw new Error('Missing mobile scroll host')
    const onScroll = host.props.onScroll as () => void
    root.scrollTop = 100
    onScroll()
    onScroll()
    expect(frame).toHaveBeenCalledOnce()
    root.scrollTop = 200
    callbacks[0]?.(16)
    expect(hooks.values[0]).toBe(200)
    onScroll()
    expect(frame).toHaveBeenCalledTimes(2)
    dispose()
    expect(cancel).toHaveBeenCalledWith(2)
  })
})
