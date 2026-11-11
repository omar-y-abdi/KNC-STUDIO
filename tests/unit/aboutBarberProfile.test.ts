import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AboutSection } from '../../modules/public-web/src/about/AboutSection'
import { GalleryMarquee } from '../../modules/public-web/src/about/GalleryMarquee'
import type { GalleryPhoto } from '../../modules/public-web/src/about/gallery/port'
import type { RosterBarber } from '../../modules/public-web/src/booking/barbersPort'
import { asBarberId } from '../../modules/public-web/src/booking/domain'
import { aboutStrings } from '../../modules/public-web/src/i18n/index'
import { nodes, reset, type RenderedNode } from './helpers/fakeHooks'

// The About section's barber card handle and the cuts gallery it composes from the roster.

const reads = vi.hoisted(() => ({
  roster: vi.fn(),
  gallery: vi.fn(),
  marquee: { selected: null as string | null, reducedMotion: true },
}))
vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('../../modules/public-web/src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))
vi.mock('../../modules/public-web/src/cms/NativeSurface', () => ({
  useNativeSource: () => false,
  useNativeSurface: (node: unknown) => node,
  useNativeChild: () => (node: unknown) => node,
}))
vi.mock('../../modules/public-web/src/about/useBarberMarquee', () => ({
  useBarberMarquee: () => ({ ...reads.marquee, toggle: vi.fn(), animate: false }),
}))
vi.mock('../../modules/public-web/src/booking/useRoster', () => ({ useRoster: reads.roster }))
vi.mock('../../modules/public-web/src/about/gallery/useGallery', () => ({
  useGallery: reads.gallery,
}))

const tx = aboutStrings('sv')
const entry = (id: string, ig: string, work?: readonly string[]): RosterBarber => ({
  barber: { id: asBarberId(id), name: `Barber ${id}`, ig },
  copy: null,
  photoUrl: null,
  ...(work === undefined ? {} : { work }),
})
const salon: readonly GalleryPhoto[] = [{ id: 'salon-1', url: '/gallery/salon-1.webp', alt: '' }]
const cuts: readonly GalleryPhoto[] = [{ id: 'cut-1', url: '/gallery/cut-1.webp', alt: 'Fade' }]

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''
  return text((node as RenderedNode).props?.children)
}

function about(roster: readonly RosterBarber[], cutsStatus: 'ready' | 'loading' | 'error') {
  reads.roster.mockReturnValue({ roster, status: 'ready', retry: () => undefined })
  reads.gallery.mockImplementation((kind: string) =>
    kind === 'salon'
      ? { status: 'ready', photos: salon }
      : { status: cutsStatus, photos: cutsStatus === 'ready' ? cuts : [] },
  )
  return nodes(AboutSection({ mode: 'light', lang: 'sv' }))
}

const galleries = (tree: RenderedNode[]) =>
  tree.filter((node) => node.type === GalleryMarquee).map((node) => node.props)

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  reads.marquee = { selected: null, reducedMotion: true }
})

describe('About barber card handle', () => {
  it('shows no bare "@" for a barber without Instagram, and the linked handle otherwise', () => {
    const handles = about([entry('a', ''), entry('b', 'bee')], 'ready').filter(
      (node) => node.props['data-barber-social'] === 'instagram',
    )
    expect(handles).toHaveLength(2)
    expect(handles.map(text)).toEqual(['', '@bee'])
    expect(nodes(handles[0]?.props.children).some((node) => node.type === 'a')).toBe(false)
    const link = nodes(handles[1]?.props.children).find((node) => node.type === 'a')
    expect(link?.props['href']).toBe('https://www.instagram.com/bee/')
  })
})

const copy = { roleSv: 'Frisör', roleEn: 'Barber', bioSv: 'Om mig', bioEn: 'About me' }
const isNode = (child: unknown): child is RenderedNode =>
  typeof child === 'object' && child !== null && 'props' in child
const children = (node: RenderedNode): readonly unknown[] =>
  Array.isArray(node.props.children) ? node.props.children : []
const kinds = (info: RenderedNode) =>
  children(info).map((child) =>
    isNode(child) ? (child.props['data-barber-social'] ?? child.type) : child,
  )

/** The card's info column: the element holding the name, the Instagram line and the role. */
function cardInfo(barber: RosterBarber, mobile: boolean): RenderedNode {
  reads.roster.mockReturnValue({ roster: [barber], status: 'ready', retry: () => undefined })
  reads.gallery.mockReturnValue({ status: 'ready', photos: [] })
  const info = nodes(AboutSection({ mode: 'light', lang: 'sv', mobile })).find((node) =>
    children(node).some(
      (child) => isNode(child) && child.props['data-barber-social'] === 'instagram',
    ),
  )
  if (!info) throw new Error('Missing card info')
  return info
}

/** The info column's style, then each element under it: tag, kind, hiding, style and text. */
const shape = (info: RenderedNode) => [
  info.props['style'],
  ...nodes(info.props.children).map((node) => [
    node.type,
    node.props['data-barber-social'],
    node.props['aria-hidden'],
    node.props['style'],
    text(node),
  ]),
]

describe('About barber card TikTok line', () => {
  it.each([
    ['desktop', false, null, { display: 'flex', flexDirection: 'column', gap: '3px' }],
    [
      'collapsed mobile',
      true,
      null,
      { display: 'grid', gridTemplateRows: 'auto 0fr 0fr', gap: 0, transition: 'none' },
    ],
    [
      'open mobile',
      true,
      'a',
      { display: 'grid', gridTemplateRows: 'auto 1fr 1fr', gap: '3px', transition: 'none' },
    ],
  ] as const)('renders the %s card info as before without a handle', (_, mobile, open, style) => {
    reads.marquee.selected = open
    const absent = cardInfo({ ...entry('a', 'anna'), copy }, mobile)
    expect(absent.props['style']).toEqual(style)
    expect(kinds(absent)).toEqual(['span', 'instagram', 'bio', null])
    const empty = cardInfo({ ...entry('a', 'anna'), copy, tiktok: '' }, mobile)
    expect(shape(empty)).toEqual(shape(absent))
  })

  it('adds the desktop TikTok line last, placed on the row under the Instagram line', () => {
    reads.marquee.reducedMotion = false
    const info = cardInfo({ ...entry('a', 'anna'), copy, tiktok: 'anna.tt' }, false)
    expect(info.props['style']).toEqual({ display: 'grid', gap: '3px' })
    expect(kinds(info)).toEqual(['span', 'instagram', 'bio', 'tiktok'])
    const line = children(info)[3]
    if (!isNode(line)) throw new Error('Missing TikTok line')
    expect(Reflect.get(line, 'key')).toBe('tiktok')
    expect(line.props['aria-hidden']).toBeUndefined()
    expect(line.props['style']).toEqual({
      fontSize: '12.5px',
      opacity: 0.5,
      minHeight: 0,
      overflow: undefined,
      transition: 'opacity .24s ease',
      gridRow: 3,
    })
    expect(text(line)).toBe('TikTok @anna.tt')
    expect(nodes(line.props.children).find((node) => node.type === 'a')?.props['href']).toBe(
      'https://www.tiktok.com/@anna.tt',
    )
  })

  it.each([
    ['collapsed', 'with', copy, null, 'auto 0fr 0fr 0fr'],
    ['open', 'with', copy, 'a', 'auto 1fr 1fr 1fr'],
    ['collapsed', 'without', null, null, 'auto 0fr 0fr'],
    ['open', 'without', null, 'a', 'auto 1fr 1fr'],
  ] as const)(
    'gives the TikTok line its own track on a %s mobile card %s copy',
    (_state, _label, role, open, rows) => {
      reads.marquee.selected = open
      const info = cardInfo({ ...entry('a', 'anna'), copy: role, tiktok: 'anna.tt' }, true)
      expect(info.props['style']).toMatchObject({ display: 'grid', gridTemplateRows: rows })
      const line = children(info)[3]
      if (!isNode(line)) throw new Error('Missing TikTok line')
      expect(line.props['aria-hidden']).toBe(open === null)
      expect(line.props['style']).toMatchObject({
        opacity: open === null ? 0 : 0.5,
        minHeight: 0,
        overflow: 'hidden',
        gridRow: 3,
      })
    },
  )
})

describe('About cuts gallery', () => {
  it('appends the barbers work pictures to the owner cuts and leaves the salon gallery alone', () => {
    const [salonGallery, cutsGallery] = galleries(
      about([entry('a', 'anna', ['/w/a1']), entry('b', 'bo', ['/w/b1'])], 'ready'),
    )
    expect(salonGallery?.['photos']).toBe(salon)
    expect(salonGallery?.['alt']).toBe(tx.galleryAlt)
    expect(cutsGallery?.['alt']).toBe(tx.cutsAlt)
    expect(cutsGallery?.['photos']).toEqual([
      { ...cuts[0], credit: { platform: 'instagram', handle: 'bnbstudio_gbg' } },
      { id: '/w/a1', url: '/w/a1', alt: '', credit: { platform: 'instagram', handle: 'anna' } },
      { id: '/w/b1', url: '/w/b1', alt: '', credit: { platform: 'instagram', handle: 'bo' } },
    ])
  })

  it('shows work pictures when the owner has published no cuts', () => {
    reads.roster.mockReturnValue({
      roster: [entry('a', 'anna', ['/w/a1'])],
      status: 'ready',
      retry: () => undefined,
    })
    reads.gallery.mockImplementation((kind: string) => ({
      status: 'ready',
      photos: kind === 'salon' ? salon : [],
    }))
    const [, cutsGallery] = galleries(nodes(AboutSection({ mode: 'light', lang: 'sv' })))
    expect((cutsGallery?.['photos'] as readonly GalleryPhoto[]).map((photo) => photo.url)).toEqual([
      '/w/a1',
    ])
  })

  it('keeps the empty note when neither the owner nor a barber has a cuts picture', () => {
    const tree = about([entry('a', 'anna'), entry('b', 'bo', [])], 'ready')
    expect(galleries(tree)).toHaveLength(2)
    reads.gallery.mockImplementation((kind: string) => ({
      status: 'ready',
      photos: kind === 'salon' ? salon : [],
    }))
    const empty = nodes(AboutSection({ mode: 'light', lang: 'sv' }))
    expect(galleries(empty)).toHaveLength(1)
    expect(
      empty.some((node) => node.props['role'] === 'status' && text(node) === tx.galleryEmpty),
    ).toBe(true)
  })

  it.each([
    ['loading', tx.galleryLoading],
    ['error', tx.galleryUnavailable],
  ] as const)('keeps the %s note of the owner cuts read', (status, note) => {
    const tree = about([entry('a', 'anna', ['/w/a1'])], status)
    expect(galleries(tree)).toHaveLength(1)
    expect(tree.some((node) => node.props['role'] === 'status' && text(node) === note)).toBe(true)
  })
})
