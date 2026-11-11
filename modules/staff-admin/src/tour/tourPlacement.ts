// Spotlight geometry for the staff tutorial, in viewport CSS px.

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}
export interface Size {
  readonly width: number
  readonly height: number
}
export type CardSide = 'bottom' | 'top' | 'right' | 'left' | 'overlap'
export interface CardPlacement {
  readonly side: CardSide
  readonly left: number
  readonly top: number
  readonly arrow: number | null
}

export const HOLE_PADDING = 8
export const HOLE_RADIUS = 12
export const CARD_GAP = 14
export const EDGE = 16

const HOLE_INSET = 4
const ARROW_INSET = 20
const BAND_GAP = 12

type FittingSide = Exclude<CardSide, 'overlap'>

/** When `min > max` (an item larger than its range) `min` wins. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

interface Edges {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

function paddedEdges(target: Box): Edges {
  return {
    left: target.left - HOLE_PADDING,
    top: target.top - HOLE_PADDING,
    right: target.left + target.width + HOLE_PADDING,
    bottom: target.top + target.height + HOLE_PADDING,
  }
}

/** The target grown by `HOLE_PADDING`, not clipped: what scrolling has to bring into view. */
export function paddedBox(target: Box): Box {
  const edges = paddedEdges(target)
  return {
    left: edges.left,
    top: edges.top,
    width: edges.right - edges.left,
    height: edges.bottom - edges.top,
  }
}

export function holeBox(target: Box, viewport: Size): Box {
  const edges = paddedEdges(target)
  const left = clamp(edges.left, HOLE_INSET, viewport.width - HOLE_INSET)
  const top = clamp(edges.top, HOLE_INSET, viewport.height - HOLE_INSET)
  const right = clamp(edges.right, HOLE_INSET, viewport.width - HOLE_INSET)
  const bottom = clamp(edges.bottom, HOLE_INSET, viewport.height - HOLE_INSET)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

export function holePath(viewport: Size, hole: Box): string {
  const r = Math.max(0, Math.min(HOLE_RADIUS, hole.width / 2, hole.height / 2))
  const left = hole.left
  const top = hole.top
  const right = hole.left + hole.width
  const bottom = hole.top + hole.height
  const arc = (x: number, y: number): string => `A${r} ${r} 0 0 1 ${x} ${y}`
  return (
    `M0 0H${viewport.width}V${viewport.height}H0Z` +
    `M${left + r} ${top}H${right - r}${arc(right, top + r)}` +
    `V${bottom - r}${arc(right - r, bottom)}` +
    `H${left + r}${arc(left, bottom - r)}` +
    `V${top + r}${arc(left + r, top)}Z`
  )
}

export function placeCard(input: {
  readonly hole: Box
  readonly card: Size
  readonly viewport: Size
  readonly topInset: number
  readonly narrow: boolean
  readonly prefer: 'right' | 'bottom'
}): CardPlacement {
  const { hole, card, viewport, topInset } = input
  const holeRight = hole.left + hole.width
  const holeBottom = hole.top + hole.height
  const centreX = hole.left + hole.width / 2
  const centreY = hole.top + hole.height / 2
  const fits: Readonly<Record<FittingSide, boolean>> = {
    bottom: holeBottom + CARD_GAP + card.height <= viewport.height - EDGE,
    top: hole.top - CARD_GAP - card.height >= topInset,
    right: holeRight + CARD_GAP + card.width <= viewport.width - EDGE,
    left: hole.left - CARD_GAP - card.width >= EDGE,
  }
  const candidates: readonly FittingSide[] = input.narrow
    ? ['bottom', 'top']
    : [...new Set<FittingSide>([input.prefer, 'bottom', 'top', 'right', 'left'])]
  const side = candidates.find((candidate) => fits[candidate])

  const centredLeft = clamp(centreX - card.width / 2, EDGE, viewport.width - EDGE - card.width)
  const centredTop = clamp(
    centreY - card.height / 2,
    topInset,
    viewport.height - EDGE - card.height,
  )
  const arrowX = (left: number): number =>
    clamp(centreX - left, ARROW_INSET, card.width - ARROW_INSET)
  const arrowY = (top: number): number =>
    clamp(centreY - top, ARROW_INSET, card.height - ARROW_INSET)

  switch (side) {
    case 'bottom':
      return { side, left: centredLeft, top: holeBottom + CARD_GAP, arrow: arrowX(centredLeft) }
    case 'top': {
      const top = hole.top - CARD_GAP - card.height
      return { side, left: centredLeft, top, arrow: arrowX(centredLeft) }
    }
    case 'right': {
      const left = holeRight + CARD_GAP
      return { side, left, top: centredTop, arrow: arrowY(centredTop) }
    }
    case 'left': {
      const left = hole.left - CARD_GAP - card.width
      return { side, left, top: centredTop, arrow: arrowY(centredTop) }
    }
    case undefined:
      return {
        side: 'overlap',
        left: centredLeft,
        top: viewport.height - EDGE - card.height,
        arrow: null,
      }
  }
}

/** Positive scrolls the page down; the card is assumed below the hole. */
export function scrollDelta(input: {
  readonly hole: Box
  readonly cardHeight: number
  readonly viewportHeight: number
  readonly topInset: number
}): number {
  const bandTop = input.topInset + BAND_GAP
  const bandHeight = input.viewportHeight - EDGE - bandTop
  const need = input.hole.height + CARD_GAP + input.cardHeight
  const wantedTop = need <= bandHeight ? bandTop + (bandHeight - need) / 2 : bandTop
  return input.hole.top - wantedTop
}
