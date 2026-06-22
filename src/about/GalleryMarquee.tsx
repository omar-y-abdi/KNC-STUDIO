// GalleryMarquee — two counter-scrolling, draggable photo rows for an About gallery section.
//
// Behaviour (per spec):
//  - two rows auto-scroll in OPPOSITE directions, looping seamlessly (each row's tiles are rendered
//    twice and the transform wraps at one copy's width — every tile carries its own trailing margin
//    so the two copies tile without a seam).
//  - drag / swipe a row to browse; on release the row keeps scrolling in the DRAG's direction
//    ("rotate the direction"). Vertical page scrolling is preserved (touch-action: pan-y).
//  - tap a tile to SELECT it: that row pauses, the tile's frame highlights and it scales up a touch.
//    Nothing disappears — the other tiles stay. Tap it again, or pick another, to change/clear it.
//
// The scroll transform is written straight to the track ref inside requestAnimationFrame, so the
// motion causes NO React re-renders; only selection (rare) is component state. prefers-reduced-motion
// disables the auto-scroll (dragging still works).

import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Palette } from '../booking/bookingStyles'
import { PlaceholderPhoto } from './PlaceholderPhoto'
import type { PlaceholderGlyph } from './PlaceholderPhoto'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const TILE_W = 210
const TILE_GAP = 14
const SPEED = 34 // px per second

interface MarqueeRowProps {
  readonly ids: readonly string[]
  readonly initialDir: 1 | -1
  readonly c: Palette
  readonly dark: boolean
  readonly glyph: PlaceholderGlyph
  readonly alt: string
  /** This row pauses while one of its tiles is selected (so the highlighted tile stays put). */
  readonly paused: boolean
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
}

function MarqueeRow(props: MarqueeRowProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const offset = useRef(0)
  const half = useRef(0)
  const dir = useRef<1 | -1>(props.initialDir)
  const dragging = useRef(false)
  const moved = useRef(false)
  const startX = useRef(0)
  const startOffset = useRef(0)
  const lastX = useRef(0)
  const lastDx = useRef(0)
  const pausedRef = useRef(props.paused)
  const reduce = useRef(prefersReducedMotion())

  useEffect(() => {
    pausedRef.current = props.paused
  }, [props.paused])

  // Two copies of the tile list make one seamless loop; wrap on one copy's width. Tiles are
  // placeholders today, so only the COUNT matters here (one tile per id, rendered twice).
  const tiles = [...Array(props.ids.length * 2).keys()]

  useLayoutEffect(() => {
    const el = trackRef.current
    if (el) half.current = el.scrollWidth / 2
  }, [props.ids])

  // Wrap the offset back into (-half, 0] so the loop is endless in either direction.
  const wrap = (): void => {
    const h = half.current
    if (h <= 0) return
    if (offset.current <= -h) offset.current += h
    else if (offset.current > 0) offset.current -= h
  }
  const paint = (): void => {
    const el = trackRef.current
    if (el) el.style.transform = `translate3d(${offset.current}px,0,0)`
  }

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      if (last === 0) last = t
      const dt = Math.min(64, t - last)
      last = t
      if (half.current > 0 && !dragging.current && !pausedRef.current && !reduce.current) {
        offset.current -= dir.current * SPEED * (dt / 1000)
        wrap()
        paint()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    dragging.current = true
    moved.current = false
    startX.current = e.clientX
    lastX.current = e.clientX
    startOffset.current = offset.current
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    const dx = e.clientX - startX.current
    if (Math.abs(dx) > 4) moved.current = true
    lastDx.current = e.clientX - lastX.current
    lastX.current = e.clientX
    offset.current = startOffset.current + dx
    wrap()
    paint()
  }
  const onPointerEnd = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    if (moved.current && Math.abs(lastDx.current) > 0.4) {
      // Keep rolling in the direction the finger was moving.
      dir.current = lastDx.current < 0 ? 1 : -1
    } else {
      // A tap (no real movement) selects the tile under the pointer. elementFromPoint works even
      // through the pointer capture (e.target would be the captured row, not the tile).
      const node = document.elementFromPoint(e.clientX, e.clientY)
      const tile = node ? node.closest('[data-tile-key]') : null
      const key = tile ? tile.getAttribute('data-tile-key') : null
      if (key !== null) props.onSelect(key)
    }
    if (e.currentTarget.releasePointerCapture && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const onTileKey = (key: string) => (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      props.onSelect(key)
    }
  }

  const rowStyle: JSX.CSSProperties = {
    overflow: 'hidden',
    padding: '12px 0',
    cursor: 'grab',
    touchAction: 'pan-y',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  }
  const trackStyle: JSX.CSSProperties = { display: 'flex', width: 'max-content', willChange: 'transform' }

  return (
    <div
      style={rowStyle}
      data-testid="marquee-row"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div ref={trackRef} style={trackStyle} data-testid="marquee-track" data-dir={String(props.initialDir)}>
        {tiles.map((j) => {
          const key = String(j)
          const selected = props.selectedKey === key
          const tileStyle: JSX.CSSProperties = {
            flex: 'none',
            width: TILE_W + 'px',
            marginRight: TILE_GAP + 'px',
            borderRadius: '14px',
            position: 'relative',
            zIndex: selected ? 2 : 1,
            cursor: 'pointer',
            transform: selected ? 'scale(1.08)' : 'scale(1)',
            transition: 'transform .26s cubic-bezier(.32,.72,0,1), box-shadow .26s ease',
            boxShadow: selected
              ? '0 0 0 2px ' + props.c.text + ',0 12px 28px rgba(0,0,0,.28)'
              : '0 0 0 0 rgba(0,0,0,0)',
          }
          return (
            <div
              key={key}
              data-tile-key={key}
              style={tileStyle}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={props.alt}
              onKeyDown={onTileKey(key)}
            >
              <PlaceholderPhoto c={props.c} dark={props.dark} glyph={props.glyph} alt={props.alt} ratio="4 / 3" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export interface GalleryMarqueeProps {
  /** Stable tile ids (placeholder count today; one per real photo later). */
  readonly ids: readonly string[]
  readonly glyph: PlaceholderGlyph
  readonly alt: string
  readonly c: Palette
  readonly dark: boolean
}

/** Two counter-scrolling rows of the same photos (row 2 reversed so they don't move in lock-step). */
export function GalleryMarquee(props: GalleryMarqueeProps): JSX.Element {
  const [selected, setSelected] = useState<{ row: 0 | 1; key: string } | null>(null)
  const select = (row: 0 | 1) => (key: string): void =>
    setSelected((cur) => (cur && cur.row === row && cur.key === key ? null : { row, key }))

  const rowB = [...props.ids].reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <MarqueeRow
        ids={props.ids}
        initialDir={1}
        c={props.c}
        dark={props.dark}
        glyph={props.glyph}
        alt={props.alt}
        paused={selected?.row === 0}
        selectedKey={selected && selected.row === 0 ? selected.key : null}
        onSelect={select(0)}
      />
      <MarqueeRow
        ids={rowB}
        initialDir={-1}
        c={props.c}
        dark={props.dark}
        glyph={props.glyph}
        alt={props.alt}
        paused={selected?.row === 1}
        selectedKey={selected && selected.row === 1 ? selected.key : null}
        onSelect={select(1)}
      />
    </div>
  )
}
