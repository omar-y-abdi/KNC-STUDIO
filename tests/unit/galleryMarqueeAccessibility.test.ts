import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GalleryMarquee,
  resolvePointerEnd,
} from '../../modules/public-web/src/about/GalleryMarquee'
import { PlaceholderPhoto } from '../../modules/public-web/src/about/PlaceholderPhoto'
import { palette } from '../../modules/public-web/src/booking/bookingStyles'
import { aboutStrings } from '../../modules/public-web/src/i18n/index'
import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import { useGallery } from '../../modules/public-web/src/about/gallery/useGallery'
import { supabaseGalleryAdapter } from '../../modules/public-web/src/about/gallery/supabaseGallery'
import type { GalleryPhoto } from '../../modules/public-web/src/about/gallery/port'
import {
  nodes as elements,
  mount,
  ref,
  render,
  reset,
  type RenderedNode,
} from './helpers/fakeHooks'

beforeEach(reset)
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('gallery marquee interaction contract', () => {
  it('does not select after pointer down, vertical move, then pointer up', () => {
    const startX = 120
    const startY = 80
    const currentX = 120
    const currentY = 124
    const dx = currentX - startX
    const dy = currentY - startY
    const moved = Math.hypot(dx, dy) > 4
    const lastDx = currentX - startX

    const resolution = resolvePointerEnd(moved, lastDx, 1)

    expect(resolution.shouldSelect).toBe(false)
    expect(resolution.nextDir).toBe(1)
  })
})

// Inspect rendered photo controls without running browser animation/effects; pointer, scroll,
// focus and reduced-motion behavior remain covered by the browser harness.
vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))

describe('published gallery photos', () => {
  it('renders no controls, tiles or images for an empty gallery', () => {
    expect(GalleryMarquee({ photos: [], alt: 'Gallery photo', c: palette(false) })).toBeNull()
  })

  it('highlights only the selected physical tile, leaving its loop clone unselected', () => {
    const gallery = GalleryMarquee({
      photos: [{ id: 'photo', url: '/photo.webp', alt: 'Photo' }],
      alt: 'Gallery photo',
      c: palette(false),
    })
    if (!gallery) throw new Error('Missing gallery')
    const rows = gallery.props.children as readonly RenderedNode[]
    const row = rows[0]
    if (!row || typeof row.type !== 'function') throw new Error('Missing gallery row')
    const renderRow = row.type
    const tiles = (selectedKey: unknown) =>
      elements(renderRow({ ...row.props, selectedKey }), { expandComponents: true }).filter(
        (node) => node.props?.['data-tile-key'] !== undefined,
      )
    const keys = tiles(null).map((node) => node.props?.['data-tile-key'])
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
    expect(tiles(keys[0]).map((node) => node.props?.style)).toEqual([
      expect.objectContaining({ transform: 'scale(1.08)' }),
      expect.objectContaining({ transform: 'scale(1)' }),
    ])
  })

  it.each(['sv', 'en'] as const)(
    'gives blank CMS alt a localized name and preserves described photos (%s)',
    (lang) => {
      const t = aboutStrings(lang)
      const nodes = elements(
        GalleryMarquee({
          photos: [
            { id: 'empty', url: '/salon-one.webp', alt: '  ' },
            { id: 'described', url: '/salon-two.webp', alt: '  Saved description  ' },
          ],
          alt: t.galleryAlt,
          c: palette(false),
        }),
        { expandComponents: true },
      )
      const buttons = nodes.filter((node) => node.props?.role === 'button')
      expect(buttons).toHaveLength(4) // One logical photo set per counter-scrolling row.
      expect(buttons.map((node) => node.props?.['aria-label']).sort()).toEqual(
        [t.galleryAlt, t.galleryAlt, 'Saved description', 'Saved description'].sort(),
      )
      expect(buttons.every((node) => node.props?.tabIndex === 0)).toBe(true)
      const clones = nodes.filter((node) => node.props?.['aria-hidden'] === 'true')
      expect(clones).toHaveLength(4)
      expect(clones.every((node) => node.props?.tabIndex === undefined)).toBe(true)
      expect(
        nodes
          .filter((node) => node.type === 'img')
          .every((node) => typeof node.props?.alt === 'string' && node.props.alt.length > 0),
      ).toBe(true)
      expect(JSON.stringify(nodes)).not.toMatch(/platshållare|placeholder/)
    },
  )

  it('makes a missing portrait decorative instead of announcing a prototype image', () => {
    const portrait = PlaceholderPhoto({ c: palette(false), dark: false })
    expect(portrait.props['aria-hidden']).toBe('true')
    expect(portrait.props.role).toBeUndefined()
    expect(portrait.props['aria-label']).toBeUndefined()
  })
})

const U = undefined
const cutsPhotos: readonly GalleryPhoto[] = [
  {
    id: 'cut',
    url: '/cut.webp',
    alt: 'Fade',
    credit: { platform: 'instagram', handle: 'bnbstudio_gbg' },
  },
  { id: 'work', url: '/work.webp', alt: '', credit: { platform: 'tiktok', handle: 'one.tt' } },
  { id: 'salon', url: '/salon.webp', alt: 'Chair' },
]
const plainPhotos: readonly GalleryPhoto[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
  id,
  url: `/${id}.webp`,
  alt: id,
}))
/** The sources of the plain row's twelve tiles when exactly `tiles` hold their photo. */
const holding = (...tiles: number[]) =>
  [...Array(12).keys()].map((j) => (tiles.includes(j) ? plainPhotos[j % 6]?.url : U))

/** Renders a gallery's first row from an empty hook store, as often as asked. */
function firstRow(
  photos: readonly GalleryPhoto[],
): (selectedKey?: string | null) => RenderedNode[] {
  const gallery = GalleryMarquee({ photos, alt: 'Gallery photo', c: palette(false) })
  const row = (gallery?.props.children as readonly RenderedNode[] | undefined)?.[0]
  if (!row || typeof row.type !== 'function') throw new Error('Missing gallery row')
  const component = row.type
  reset()
  return (selectedKey = null) => elements(render(() => component({ ...row.props, selectedKey })))
}

/** Runs the row's four layout effects from its last render, as the renderer does after it. */
function layout(): void {
  for (const [effect] of vi.mocked(useLayoutEffect).mock.calls.slice(-4)) effect()
}

/** A 400 px row of the plain photos (twelve tiles, 1344 px per loop half) after its first layout. */
function measuredRow(): (selectedKey?: string | null) => RenderedNode[] {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    },
  )
  const row = firstRow(plainPhotos)
  row()
  ref(1, { scrollWidth: 2688, parentElement: { clientWidth: 400 }, style: {} })
  layout()
  return row
}

const links = (tree: RenderedNode[]) => tree.filter((node) => node.type === 'a')
const styles = (tree: RenderedNode[]) => tree.map((node) => node.props['style'])
const sources = (tree: RenderedNode[]) =>
  tree.filter((node) => node.type === 'img').map((node) => node.props['src'])
const fold = (rows: '0fr' | '1fr', transition = 'grid-template-rows .36s ease') => ({
  display: 'grid',
  gridTemplateRows: rows,
  transition,
})

function fire(node: RenderedNode | undefined, handler: string, event: object): void {
  const listener = node?.props[handler]
  if (typeof listener !== 'function') throw new Error(`Missing ${handler}`)
  listener(event)
}

const pointer = (clientX: number) => ({
  isPrimary: true,
  button: 0,
  pointerId: 1,
  clientX,
  clientY: 50,
  preventDefault: vi.fn(),
  currentTarget: {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  },
})

function drag(row: RenderedNode | undefined, fromX: number, toX: number): void {
  fire(row, 'onPointerDown', pointer(fromX))
  fire(row, 'onPointerMove', pointer(toX))
  fire(row, 'onPointerUp', pointer(toX))
}

describe('gallery photo credit', () => {
  it('unfolds the studio credit under the selected tile only, after laying it out folded', () => {
    const row = firstRow(cutsPhotos)
    expect(links(row())).toEqual([])
    const folded = row('cut:0')
    const [link] = links(folded)
    expect(links(folded)).toHaveLength(1)
    expect(link?.props).toMatchObject({
      href: 'https://www.instagram.com/bnbstudio_gbg/',
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': 'Instagram @bnbstudio_gbg',
      children: '@bnbstudio_gbg',
    })
    expect(link?.props['tabIndex']).toBeUndefined()
    expect(link?.props['style']).toEqual({
      display: 'block',
      padding: '8px 0',
      textAlign: 'center',
      fontSize: '13px',
      fontWeight: 600,
      color: palette(false).text,
      textDecoration: 'none',
    })
    expect(styles(folded)).toContainEqual(fold('0fr'))
    layout()
    expect(styles(row('cut:0'))).toContainEqual(fold('1fr'))
    row(null)
    layout()
    expect(links(row(null))).toEqual([])
  })

  it('credits a loop clone outside the Tab order and a work picture by its TikTok handle', () => {
    const row = firstRow(cutsPhotos)
    const [clone] = links(row('cut:3'))
    expect(clone?.props['tabIndex']).toBe(-1)
    expect(clone?.props['aria-label']).toBe('Instagram @bnbstudio_gbg')
    expect(
      links(row('work:1')).map((node) => [
        node.props['href'],
        node.props['aria-label'],
        node.props['children'],
      ]),
    ).toEqual([['https://www.tiktok.com/@one.tt', 'TikTok @one.tt', '@one.tt']])
    expect(row('salon:2').map((node) => node.type)).toEqual(row(null).map((node) => node.type))
  })

  it('keeps a press or key on the credit from selecting or dragging the tile', () => {
    const [link] = links(firstRow(cutsPhotos)('cut:0'))
    expect(link?.props['draggable']).toBe(false)
    for (const handler of ['onPointerDown', 'onKeyDown']) {
      const stopPropagation = vi.fn()
      fire(link, handler, { stopPropagation })
      expect(stopPropagation).toHaveBeenCalledOnce()
    }
  })

  it('shows the credit without the unfold under reduced motion', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const row = firstRow(cutsPhotos)
    row('cut:0')
    layout()
    expect(styles(row('cut:0'))).toContainEqual(fold('1fr', 'none'))
  })
})

describe('gallery image window', () => {
  it('requests no photo before the row is measured, then only the tiles near its strip and their copies', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
      },
    )
    const row = firstRow(plainPhotos)
    expect(sources(row())).toEqual(holding())
    layout()
    expect(sources(row())).toEqual(holding())
    ref(1, { scrollWidth: 2688, parentElement: { clientWidth: 400 }, style: {} })
    layout()
    expect(sources(row())).toEqual(holding(0, 1, 2, 5, 6, 7, 8, 11))
  })

  it('keeps the photo of a tile that left the window for 1.5 s', () => {
    vi.useFakeTimers()
    const row = measuredRow()
    ref(2, -300) // The track offset.
    row()
    layout()
    const kept = holding(0, 1, 2, 3, 5, 6, 7, 8, 9, 11)
    expect(sources(row())).toEqual(kept)
    vi.advanceTimersByTime(1499)
    expect(sources(row())).toEqual(kept)
    vi.advanceTimersByTime(1)
    expect(sources(row())).toEqual(holding(1, 2, 3, 7, 8, 9))
  })

  it('widens to five tiles a side from a drag until 2 s after it, then lets far tiles go', () => {
    vi.useFakeTimers()
    const row = measuredRow()
    drag(row()[0], 100, 60)
    const all = holding(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
    expect(sources(row())).toEqual(all)
    vi.advanceTimersByTime(1999)
    expect(sources(row())).toEqual(all)
    vi.advanceTimersByTime(1)
    expect(sources(row())).toEqual(all)
    vi.advanceTimersByTime(1500)
    expect(sources(row())).toEqual(holding(0, 1, 2, 5, 6, 7, 8, 11))
  })

  it('keeps the selected tile loaded wherever it is in the loop', () => {
    const row = measuredRow()
    row('e:10')
    layout()
    expect(sources(row('e:10'))).toEqual(holding(0, 1, 2, 4, 5, 6, 7, 8, 10, 11))
  })

  it.each([
    ['release', 4],
    ['drag window', 1],
  ] as const)('leaves no %s timer running after unmount', (pending, timers) => {
    vi.useFakeTimers()
    vi.stubGlobal('document', new EventTarget())
    const row = measuredRow()
    if (pending === 'release') {
      ref(2, -300)
      row()
      layout()
    } else drag(row()[0], 100, 60)
    expect(vi.getTimerCount()).toBe(timers)
    const unmount = mount()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

const galleryDb = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../modules/public-web/src/backend/publicRest', () => ({
  getPublicRest: () => galleryDb,
}))

describe('gallery load outcomes', () => {
  it('distinguishes an empty successful read from a failed database read', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    galleryDb.from.mockReturnValue({ select: () => ({ eq: () => ({ order }) }) })
    await expect(supabaseGalleryAdapter.list('salon')).resolves.toEqual([])
    order.mockResolvedValue({ data: null, error: { message: 'network failure' } })
    await expect(supabaseGalleryAdapter.list('salon')).rejects.toThrow('Gallery unavailable')
  })

  it.each(['ready', 'error'] as const)(
    'the hook exposes %s instead of interactive placeholders',
    async (status) => {
      const list =
        status === 'ready'
          ? vi.fn().mockResolvedValue([])
          : vi.fn().mockRejectedValue(new Error('offline'))
      const initial = useGallery('salon', { list }, true)
      expect(initial).toEqual({ status: 'loading', photos: [] })
      const effect = vi.mocked(useEffect).mock.calls.at(-1)?.[0]
      const result = vi.mocked(useState).mock.results.at(-1)?.value as readonly [
        unknown,
        ReturnType<typeof vi.fn>,
      ]
      effect?.()
      await Promise.resolve()
      expect(result[1]).toHaveBeenLastCalledWith({ status, photos: [] })
    },
  )

  it('does not fetch gallery data while its section is deferred', () => {
    const list = vi.fn().mockResolvedValue([])
    useGallery('salon', { list }, false)
    vi.mocked(useEffect).mock.calls.at(-1)?.[0]()
    expect(list).not.toHaveBeenCalled()
  })
})
