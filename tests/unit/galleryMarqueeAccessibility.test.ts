import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { GalleryMarquee, resolvePointerEnd } from '../../src/about/GalleryMarquee'
import { PlaceholderPhoto } from '../../src/about/PlaceholderPhoto'
import { palette } from '../../src/booking/bookingStyles'
import { aboutStrings } from '../../src/i18n/index'
import { useEffect, useState } from 'preact/hooks'
import { useGallery } from '../../src/about/gallery/useGallery'
import { supabaseGalleryAdapter } from '../../src/about/gallery/supabaseGallery'

describe('gallery marquee interaction contract', () => {
  const source = readFileSync('src/about/GalleryMarquee.tsx', 'utf8')

  it('exposes one keyboard-selectable logical copy and hides loop clones', () => {
    expect(source).toContain('const accessible = j < itemCount')
    expect(source).toContain("aria-hidden={accessible ? undefined : 'true'}")
    expect(source).toContain("role={accessible ? 'button' : undefined}")
    expect(source).toContain('tabIndex={accessible ? 0 : undefined}')
  })

  it('keys selection by physical tile instance so loop clones cannot all highlight', () => {
    expect(source).toContain('const logicalKey =')
    expect(source).toContain('const key = `${logicalKey}:${j}`')
    expect(source).toContain('const selected = props.selectedKey === key')
  })

  it('cancels pointer selection on pointercancel or scrolling and pauses while focused', () => {
    expect(source).toContain('const onPointerCancel =')
    expect(source).toContain('onPointerCancel={onPointerCancel}')
    expect(source).toContain("document.addEventListener('scroll', onScroll")
    expect(source).toContain('onFocus={onRowFocus}')
    expect(source).toContain('onBlur={onRowBlur}')
  })

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

  it('re-anchors the one focusable logical copy when normal motion moved it away', () => {
    expect(source).toContain('const target = e.target')
    expect(source).toContain("target.closest<HTMLElement>('[data-tile-key]')")
    expect(source).toContain("tile.getAttribute('aria-hidden') === 'true'")
    expect(source).toContain('offset.current = 0')
    expect(source).toContain('paint()')
  })
})

// Inspect rendered photo controls without running browser animation/effects; pointer, scroll,
// focus and reduced-motion behavior remain covered by the browser harness.
vi.mock('preact/hooks', () => ({
  useState: vi.fn((initial: unknown) => [
    typeof initial === 'function' ? initial() : initial,
    vi.fn(),
  ]),
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
}))

interface RenderedNode {
  readonly type?: unknown
  readonly props?: { readonly children?: unknown; readonly [key: string]: unknown }
}

function elements(node: unknown): readonly RenderedNode[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as RenderedNode
  if (typeof vnode.type === 'function') return elements(vnode.type(vnode.props))
  return [vnode, ...elements(vnode.props?.children)]
}

describe('published gallery photos', () => {
  it('renders no controls, tiles or images for an empty gallery', () => {
    expect(GalleryMarquee({ photos: [], alt: 'Gallery photo', c: palette(false) })).toBeNull()
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

const galleryDb = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../src/backend/supabaseClient', () => ({ getSupabase: () => galleryDb }))

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
