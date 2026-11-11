// What the staff tutorial reads from the page: its anchors, the wait before a tour starts and the
// numbers a step is placed with.

import type { TourId } from './tourModel'
import type { Box, Size } from './tourPlacement'
import { TOURS, type TourAnchor } from './tourSteps'

const READY_TIMEOUT_MS = 10_000
const QUIET_MS = 300
const QUIET_CAP_MS = 3_000
const TOP_INSET_GAP = 8

export function findAnchor(anchor: TourAnchor): HTMLElement | null {
  const element = document.querySelector(`[data-tour="${anchor}"]`)
  return element instanceof HTMLElement ? element : null
}

/** The anchors of `tour` (its ready anchor and its steps') that are on the page now. */
export function presentAnchors(tour: TourId): ReadonlySet<TourAnchor> {
  const { ready, steps } = TOURS[tour]
  return new Set(
    [ready, ...steps.map((step) => step.anchor)].filter((anchor) => findAnchor(anchor) !== null),
  )
}

export function inSidebar(element: Element): boolean {
  return element.closest('nav.knc-admin-sidebar') !== null
}

/**
 * Looks for `anchor` every frame for up to 10 s (then `gaveUp`); once it is there, waits until
 * `main` has had no DOM change for 300 ms, at most 3 s (then `ready`). Returns the cancel.
 */
export function waitForReady(
  anchor: TourAnchor,
  ready: () => void,
  gaveUp: () => void,
): () => void {
  const deadline = performance.now() + READY_TIMEOUT_MS
  let frame: number | null = null
  let quiet: number | null = null
  let cap: number | null = null
  let observer: MutationObserver | null = null

  const cancel = (): void => {
    if (frame !== null) window.cancelAnimationFrame(frame)
    if (quiet !== null) window.clearTimeout(quiet)
    if (cap !== null) window.clearTimeout(cap)
    observer?.disconnect()
    frame = null
    quiet = null
    cap = null
    observer = null
  }
  const settle = (): void => {
    cancel()
    ready()
  }
  const awaitQuiet = (): void => {
    quiet = window.setTimeout(settle, QUIET_MS)
    cap = window.setTimeout(settle, QUIET_CAP_MS)
    const main = document.querySelector('.knc-admin-shell > main')
    if (main === null) return
    observer = new MutationObserver(() => {
      if (quiet !== null) window.clearTimeout(quiet)
      quiet = window.setTimeout(settle, QUIET_MS)
    })
    observer.observe(main, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
  }
  const look = (): void => {
    frame = null
    if (findAnchor(anchor) !== null) awaitQuiet()
    else if (performance.now() >= deadline) {
      cancel()
      gaveUp()
    } else frame = window.requestAnimationFrame(look)
  }

  frame = window.requestAnimationFrame(look)
  return cancel
}

/** One frame of a running step, in viewport CSS px. */
export interface StepFrame {
  readonly target: Box
  readonly viewport: Size
  readonly card: Size
  readonly topInset: number
}

export function measureStep(anchor: Element, card: HTMLElement, narrow: boolean): StepFrame {
  const rect = anchor.getBoundingClientRect()
  const bar = document.querySelector(narrow ? 'nav.knc-admin-sidebar' : 'header.knc-admin-topbar')
  return {
    target: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
    card: { width: card.offsetWidth, height: card.offsetHeight },
    topInset: (bar === null ? 0 : bar.getBoundingClientRect().bottom) + TOP_INSET_GAP,
  }
}

const sameBox = (a: Box, b: Box): boolean =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height

const sameSize = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height

export function sameFrame(a: StepFrame, b: StepFrame): boolean {
  return (
    sameBox(a.target, b.target) &&
    sameSize(a.viewport, b.viewport) &&
    sameSize(a.card, b.card) &&
    a.topInset === b.topInset
  )
}

/** Scrolls the window by `delta` px at once; true when the page moved. */
export function scrollWindowBy(delta: number): boolean {
  const before = window.scrollY
  window.scrollBy({ top: delta, behavior: 'instant' })
  return window.scrollY !== before
}
