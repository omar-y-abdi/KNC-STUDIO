// The running tour on screen: dimmed backdrop with a cut-out, a ring on the explained control and
// the step card. Measures the anchor every frame; the shell keeps `nav` and `main` inert meanwhile.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { palette } from '@bladeblend/public-web/booking-styles'
import type { Lang } from '@bladeblend/public-web/localization'
import { adminText } from '../adminStrings'
import { useNarrow } from '../chrome'
import type { AdminStylesBundle } from '../views/viewTypes'
import {
  findAnchor,
  inSidebar,
  measureStep,
  presentAnchors,
  sameFrame,
  scrollWindowBy,
  type StepFrame,
} from './tourDom'
import {
  HOLE_RADIUS,
  holeBox,
  holePath,
  paddedBox,
  placeCard,
  scrollDelta,
  type CardSide,
} from './tourPlacement'
import type { TourAnchor } from './tourSteps'
import type { RunningTour } from './useStaffTour'
import './tour.css'

export interface TourLayerProps {
  readonly running: RunningTour
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly onNext: () => void
  readonly onBack: () => void
  readonly onSkip: () => void
  readonly onLost: (present: ReadonlySet<TourAnchor>) => void
  readonly setMenuOpen: (open: boolean) => void
}

const TITLE_ID = 'admin-tour-title'
const BODY_ID = 'admin-tour-body'
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])
const ARROW_SIZE = 12

interface Measured {
  readonly step: string
  readonly frame: StepFrame
}

const stepKey = (running: RunningTour): string =>
  `${running.tour}:${running.index}:${running.steps[running.index]?.anchor ?? ''}`

/** The padded target must sit between `topInset` and the viewport bottom. */
function inBand(frame: StepFrame): boolean {
  const padded = paddedBox(frame.target)
  return padded.top >= frame.topInset && padded.top + padded.height <= frame.viewport.height
}

/** Its two outward sides form the tip that points at the hole. */
function arrowStyle(
  side: Exclude<CardSide, 'overlap'>,
  offset: number,
  line: string,
): JSX.CSSProperties {
  const edge = '0.5px solid ' + line
  const at = offset - ARROW_SIZE / 2
  const outside = -ARROW_SIZE / 2
  switch (side) {
    case 'bottom':
      return { top: outside, left: at, borderTop: edge, borderLeft: edge }
    case 'top':
      return { bottom: outside, left: at, borderBottom: edge, borderRight: edge }
    case 'right':
      return { left: outside, top: at, borderBottom: edge, borderLeft: edge }
    case 'left':
      return { right: outside, top: at, borderTop: edge, borderRight: edge }
  }
}

export function TourLayer(props: TourLayerProps): JSX.Element {
  const { running, dark, s } = props
  const c = palette(dark)
  const t = adminText(props.lang)
  const narrow = useNarrow()
  const [measured, setMeasured] = useState<Measured | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const latest = useRef({ props, narrow })
  latest.current = { props, narrow }
  const focused = useRef<string | null>(null)

  const key = stepKey(running)
  const placedFrame = measured !== null && measured.step === key ? measured.frame : null
  const placed = placedFrame !== null

  useEffect(() => {
    let request = 0
    let stored: Measured | null = null
    let entered: string | null = null
    let lostFor: string | null = null
    let menuOpen: boolean | null = null
    // After a scroll attempt that did not move the page, this step scrolls no more.
    let stalled = false

    const tryScroll = (now: StepFrame): boolean => {
      const delta = scrollDelta({
        hole: paddedBox(now.target),
        cardHeight: now.card.height,
        viewportHeight: now.viewport.height,
        topInset: now.topInset,
      })
      if (Math.abs(delta) <= 1) return false
      const moved = scrollWindowBy(delta)
      stalled = !moved
      return moved
    }

    const tick = (): void => {
      request = window.requestAnimationFrame(tick)
      const { props: now, narrow: phone } = latest.current
      const step = now.running.steps[now.running.index]
      const card = cardRef.current
      if (step === undefined || card === null) return
      const current = stepKey(now.running)

      const wantOpen = phone && step.menu === 'open'
      if (menuOpen !== wantOpen) {
        menuOpen = wantOpen
        now.setMenuOpen(wantOpen)
      }

      const anchor = findAnchor(step.anchor)
      if (anchor === null) {
        if (lostFor !== current) {
          lostFor = current
          now.onLost(presentAnchors(now.running.tour))
        }
        return
      }

      const scrolls = !inSidebar(anchor)
      const next = measureStep(anchor, card, phone)
      if (entered !== current) {
        entered = current
        stalled = false
        if (scrolls) tryScroll(next)
        return
      }
      // A closed phone menu lays its buttons out at zero size until it opens.
      if (next.target.width === 0 && next.target.height === 0) return
      if (scrolls && !stalled && !inBand(next) && tryScroll(next)) return

      if (stored !== null && stored.step === current && sameFrame(stored.frame, next)) return
      stored = { step: current, frame: next }
      setMeasured(stored)
    }

    const onKey = (event: KeyboardEvent): void => {
      const { onNext, onBack, onSkip } = latest.current.props
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey
      if (plain && event.key === 'Escape') {
        event.preventDefault()
        onSkip()
      } else if (plain && event.key === 'ArrowRight') {
        event.preventDefault()
        onNext()
      } else if (plain && event.key === 'ArrowLeft') {
        event.preventDefault()
        onBack()
      } else if (
        SCROLL_KEYS.has(event.key) &&
        !(event.key === ' ' && event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault()
      }
    }
    const block = (event: Event): void => event.preventDefault()

    request = window.requestAnimationFrame(tick)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', block, { passive: false })
    window.addEventListener('touchmove', block, { passive: false })
    return () => {
      window.cancelAnimationFrame(request)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', block)
      window.removeEventListener('touchmove', block)
    }
  }, [])

  useEffect(() => {
    if (!placed || focused.current === key) return
    focused.current = key
    primaryRef.current?.focus({ preventScroll: true })
  }, [key, placed])

  const step = running.steps[running.index]
  const last = running.index === running.steps.length - 1
  const frame = measured?.frame ?? null
  const hole = frame === null ? null : holeBox(frame.target, frame.viewport)
  const placement =
    placedFrame !== null && step !== undefined
      ? placeCard({
          hole: holeBox(placedFrame.target, placedFrame.viewport),
          card: placedFrame.card,
          viewport: placedFrame.viewport,
          topInset: placedFrame.topInset,
          narrow,
          prefer: step.side,
        })
      : null

  return (
    <div
      class="knc-tour-layer"
      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault()
      }}
    >
      {frame !== null && hole !== null ? (
        <>
          <svg
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            <path
              d={holePath(frame.viewport, hole)}
              fill-rule="evenodd"
              fill={dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.45)'}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              left: hole.left,
              top: hole.top,
              width: hole.width,
              height: hole.height,
              boxSizing: 'border-box',
              border: '2px solid ' + c.accent,
              borderRadius: HOLE_RADIUS,
              boxShadow: dark
                ? '0 0 0 4px rgba(245,245,247,0.22)'
                : '0 0 0 4px rgba(28,28,30,0.22)',
              pointerEvents: 'none',
            }}
          />
        </>
      ) : null}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={BODY_ID}
        class={placement === null ? undefined : 'knc-tour-card-in'}
        style={{
          position: 'absolute',
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
          width: narrow ? 'min(calc(100% - 32px), 380px)' : '320px',
          boxSizing: 'border-box',
          background: c.card,
          border: '0.5px solid ' + c.line,
          borderRadius: '14px',
          padding: '16px 16px 14px',
          boxShadow: dark ? '0 16px 40px rgba(0,0,0,0.6)' : '0 16px 40px rgba(0,0,0,0.28)',
          fontFamily: 'inherit',
          color: c.text,
          visibility: placement === null ? 'hidden' : undefined,
        }}
      >
        {placement !== null && placement.side !== 'overlap' && placement.arrow !== null ? (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: ARROW_SIZE,
              height: ARROW_SIZE,
              boxSizing: 'border-box',
              background: c.card,
              transform: 'rotate(45deg)',
              ...arrowStyle(placement.side, placement.arrow, c.line),
            }}
          />
        ) : null}

        <div aria-live="polite" aria-atomic="true">
          <h2
            id={TITLE_ID}
            style={{
              margin: 0,
              paddingRight: '36px',
              fontSize: '16px',
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            {step === undefined ? null : t[step.title]}
          </h2>
          <p
            id={BODY_ID}
            style={{ margin: '6px 0 0', fontSize: '14px', lineHeight: 1.45, opacity: 0.78 }}
          >
            {step === undefined ? null : t[step.body]}
          </p>
        </div>

        <button
          type="button"
          aria-label={t.tourClose}
          onClick={props.onSkip}
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '44px',
            height: '44px',
            border: 'none',
            background: 'transparent',
            borderRadius: '10px',
            color: c.text,
            cursor: 'pointer',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            style={{ display: 'block', margin: '0 auto', opacity: 0.6 }}
          >
            <line x1="1" y1="1" x2="11" y2="11" />
            <line x1="11" y1="1" x2="1" y2="11" />
          </svg>
        </button>

        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          {running.steps.length > 1 ? (
            <span
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                opacity: 0.62,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {t.tourProgress
                .replace('{current}', String(running.index + 1))
                .replace('{total}', String(running.steps.length))}
            </span>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            {running.index > 0 ? (
              <button
                type="button"
                onClick={props.onBack}
                style={{ ...s.ghostBtn, minHeight: '44px' }}
              >
                {t.tourBack}
              </button>
            ) : null}
            <button
              ref={primaryRef}
              type="button"
              onClick={props.onNext}
              style={{ ...s.primaryBtn, minHeight: '44px', minWidth: '88px' }}
            >
              {last ? t.tourDone : t.tourNext}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
