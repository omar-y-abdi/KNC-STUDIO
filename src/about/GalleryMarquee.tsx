import { useNativeChild } from '../cms/NativeSurface'
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
import type { GalleryPhoto } from './gallery/port'

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

/** Image fill for a real gallery tile — covers the wrapper exactly (no letterboxing, no shift). */
const IMG_STYLE: JSX.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
}

/** Original gallery tile geometry: 4/3, 14px radius, hairline border. */
function photoWrapStyle(c: Palette): JSX.CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    aspectRatio: '4 / 3',
    borderRadius: '14px',
    overflow: 'hidden',
    border: '0.5px solid ' + c.line,
  }
}

interface MarqueeRowProps {
  /** Real Storage-backed photos for this row. */
  readonly photos: readonly GalleryPhoto[]
  readonly initialDir: 1 | -1
  readonly c: Palette
  readonly alt: string
  /** This row pauses while one of its tiles is selected (so the highlighted tile stays put). */
  readonly paused: boolean
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
}

interface PointerEndResolution {
  readonly shouldSelect: boolean
  readonly nextDir: 1 | -1
}

export function resolvePointerEnd(
  moved: boolean,
  lastDx: number,
  currentDir: 1 | -1,
): PointerEndResolution {
  if (!moved) return { shouldSelect: true, nextDir: currentDir }
  if (Math.abs(lastDx) <= 0.4) return { shouldSelect: false, nextDir: currentDir }
  return { shouldSelect: false, nextDir: lastDx < 0 ? 1 : -1 }
}

function MarqueeRow(props: MarqueeRowProps): JSX.Element {
  const present = useNativeChild()
  const rowRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const offset = useRef(0)
  const half = useRef(0)
  const dir = useRef<1 | -1>(props.initialDir)
  const dragging = useRef(false)
  const moved = useRef(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const startOffset = useRef(0)
  const lastX = useRef(0)
  const lastDx = useRef(0)
  const pointerId = useRef<number | null>(null)
  const pausedRef = useRef(props.paused)
  const reduce = useRef(prefersReducedMotion())

  useEffect(() => {
    pausedRef.current = props.paused
  }, [props.paused])

  // Repeat real photos into a seamless loop; the transform wraps on one loop-half's width.
  const itemCount = props.photos.length

  // Repeat the photo set enough times that ONE loop-half always spans at least the row's full width.
  // A short photo list otherwise leaves a wide screen half-empty — tiles bunch on one side with a
  // hard clip and dead space instead of a continuous stream (the reported "clipped/broken" look).
  // `perHalf` sets are rendered TWICE (the two halves) so the wrap is seamless. Recomputed on resize.
  const [perHalf, setPerHalf] = useState(1)
  useLayoutEffect(() => {
    const el = trackRef.current
    if (el === null) return
    const compute = (): void => {
      const container = el.parentElement !== null ? el.parentElement.clientWidth : 0
      const base = itemCount * (TILE_W + TILE_GAP)
      setPerHalf(base > 0 && container > 0 ? Math.max(1, Math.ceil(container / base)) : 1)
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [itemCount])

  const tiles = [...Array(itemCount * perHalf * 2).keys()]

  useLayoutEffect(() => {
    const el = trackRef.current
    if (el) half.current = el.scrollWidth / 2
  }, [props.photos, perHalf])

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

  const releasePointerCapture = (target: HTMLDivElement | null, id: number | null): void => {
    if (
      target !== null &&
      id !== null &&
      target.releasePointerCapture &&
      target.hasPointerCapture(id)
    ) {
      target.releasePointerCapture(id)
    }
  }

  const cancelPointer = (e?: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    const id = pointerId.current
    dragging.current = false
    pointerId.current = null
    moved.current = true
    lastDx.current = 0
    releasePointerCapture(e?.currentTarget ?? rowRef.current, id)
  }

  const onScroll = (): void => {
    cancelPointer()
  }

  useEffect(() => {
    // Capture descendant scroll events too (the mobile site uses an inner scrolling element).
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])

  useEffect(() => {
    if (reduce.current) return
    const row = rowRef.current
    if (row === null) return

    let raf = 0
    let last = 0
    let intersecting = false
    let running = false

    const tick = (t: number): void => {
      if (!running) return
      if (last === 0) last = t
      const dt = Math.min(64, t - last)
      last = t
      if (half.current > 0 && !dragging.current && !pausedRef.current) {
        offset.current -= dir.current * SPEED * (dt / 1000)
        wrap()
        paint()
      }
      raf = requestAnimationFrame(tick)
    }
    const start = (): void => {
      if (running || document.hidden || !intersecting) return
      running = true
      last = 0
      raf = requestAnimationFrame(tick)
    }
    const stop = (): void => {
      running = false
      last = 0
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
    }

    const onVisibility = (): void => {
      if (document.hidden) stop()
      else start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver === 'undefined') {
      intersecting = true
      start()
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          intersecting = entries.some((entry) => entry.isIntersecting)
          if (intersecting) start()
          else stop()
        },
        { threshold: 0.01 },
      )
      observer.observe(row)
    }

    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [])

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (dragging.current) return
    dragging.current = true
    pointerId.current = e.pointerId
    moved.current = false
    startX.current = e.clientX
    startY.current = e.clientY
    lastX.current = e.clientX
    startOffset.current = offset.current
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current || pointerId.current !== e.pointerId) return
    const dx = e.clientX - startX.current
    const dy = e.clientY - startY.current
    if (Math.hypot(dx, dy) > 4) moved.current = true
    lastDx.current = e.clientX - lastX.current
    lastX.current = e.clientX
    offset.current = startOffset.current + dx
    wrap()
    paint()
  }
  const onPointerEnd = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current || pointerId.current !== e.pointerId) return
    const id = pointerId.current
    dragging.current = false
    pointerId.current = null
    const resolution = resolvePointerEnd(moved.current, lastDx.current, dir.current)
    dir.current = resolution.nextDir
    if (resolution.shouldSelect) {
      // A tap (no real movement) selects the tile under the pointer. elementFromPoint works even
      // through the pointer capture (e.target would be the captured row, not the tile).
      const node = document.elementFromPoint(e.clientX, e.clientY)
      const tile = node ? node.closest('[data-tile-key]') : null
      const key = tile ? tile.getAttribute('data-tile-key') : null
      if (key !== null) props.onSelect(key)
    }
    releasePointerCapture(e.currentTarget, id)
  }

  const onPointerCancel = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (pointerId.current !== e.pointerId) return
    cancelPointer(e)
  }

  const onRowFocus = (e: JSX.TargetedFocusEvent<HTMLDivElement>): void => {
    pausedRef.current = true
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    const tile = target.closest<HTMLElement>('[data-tile-key]')
    if (tile === null || tile.getAttribute('aria-hidden') === 'true') return

    // Only the first logical copy is focusable. Normal motion can carry that copy completely out
    // of view when perHalf > 1, so put it back at the visible anchor before the keyboard user lands.
    offset.current = 0
    paint()
  }

  const onRowBlur = (e: JSX.TargetedFocusEvent<HTMLDivElement>): void => {
    const row = rowRef.current
    if (row !== null && e.relatedTarget instanceof Node && row.contains(e.relatedTarget)) return
    pausedRef.current = props.paused
  }

  const onTileKey =
    (key: string) =>
    (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
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
  const trackStyle: JSX.CSSProperties = {
    display: 'flex',
    width: 'max-content',
    willChange: 'transform',
  }

  return present(
    <div
      ref={rowRef}
      style={rowStyle}
      data-testid="marquee-row"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerCancel}
      onFocus={onRowFocus}
      onBlur={onRowBlur}
    >
      <div
        ref={trackRef}
        style={trackStyle}
        data-testid="marquee-track"
        data-dir={String(props.initialDir)}
      >
        {tiles.map((j) => {
          const logicalIndex = itemCount > 0 ? j % itemCount : 0
          const photo = props.photos[logicalIndex]
          if (photo === undefined) return null
          const logicalKey = photo.id
          const alt = photo.alt.trim() || props.alt
          // The same logical photo appears in loop clones. Selection belongs to the physical tile
          // instance under the pointer, not every clone with the same photo id.
          const key = `${logicalKey}:${j}`
          const accessible = j < itemCount
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
              key={`${logicalKey}:${Math.floor(j / itemCount)}`}
              data-tile-key={key}
              style={tileStyle}
              role={accessible ? 'button' : undefined}
              tabIndex={accessible ? 0 : undefined}
              aria-hidden={accessible ? undefined : 'true'}
              aria-pressed={accessible ? selected : undefined}
              aria-label={accessible ? alt : undefined}
              onKeyDown={accessible ? onTileKey(key) : undefined}
            >
              <div style={photoWrapStyle(props.c)}>
                <img
                  src={photo.url}
                  alt={alt}
                  draggable={false}
                  style={IMG_STYLE}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>,
  )
}

export interface GalleryMarqueeProps {
  /** Real Storage-backed photos; an empty list renders no interactive rows. */
  readonly photos: readonly GalleryPhoto[]
  readonly alt: string
  readonly c: Palette
}

/** Two counter-scrolling rows of the same photos (row 2 reversed so they don't move in lock-step). */
export function GalleryMarquee(props: GalleryMarqueeProps): JSX.Element | null {
  const present = useNativeChild()
  const [selected, setSelected] = useState<{ row: 0 | 1; key: string } | null>(null)
  const select =
    (row: 0 | 1) =>
    (key: string): void =>
      setSelected((cur) => (cur && cur.row === row && cur.key === key ? null : { row, key }))

  const photos = props.photos
  if (photos.length === 0) return null
  const photosB = [...photos].reverse()

  return present(
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <MarqueeRow
        photos={photos}
        initialDir={1}
        c={props.c}
        alt={props.alt}
        paused={selected?.row === 0}
        selectedKey={selected && selected.row === 0 ? selected.key : null}
        onSelect={select(0)}
      />
      <MarqueeRow
        photos={photosB}
        initialDir={-1}
        c={props.c}
        alt={props.alt}
        paused={selected?.row === 1}
        selectedKey={selected && selected.row === 1 ? selected.key : null}
        onSelect={select(1)}
      />
    </div>,
  )
}
