// Which marquee tiles may hold their image: those whose box meets the row's visible strip widened
// by a margin. Left of the track the strip continues with the tiles a wrap brings there; right of
// it a wrap brings tiles that already show. A wrap swaps each tile for its copy in the other loop
// half, so a wanted tile also wants that copy (same URL, no extra download).

export type WindowMode = 'auto' | 'drag'

/** One row as its frame loop sees it. `half` and `width` stay 0 until the row is measured. */
export interface RowWindow {
  /** Track translation, in (-half, 0]. */
  readonly offset: number
  /** Width of one loop half. */
  readonly half: number
  /** Visible width of the row. */
  readonly width: number
  /** Physical tiles in the track, both loop halves. */
  readonly count: number
  readonly mode: WindowMode
}

const AHEAD_S = 1.5
const DRAG_TILES = 5

/** `speed` px/s of auto-scroll for AHEAD_S seconds, or DRAG_TILES tile pitches while dragging. */
export function windowMargin(mode: WindowMode, speed: number, pitch: number): number {
  return mode === 'drag' ? DRAG_TILES * pitch : speed * AHEAD_S
}

export function wantedTiles(
  row: RowWindow,
  speed: number,
  always: readonly number[],
): ReadonlySet<number> {
  const wanted = new Set<number>()
  const { offset, half, width, count } = row
  if (half <= 0 || width <= 0 || count <= 0) return wanted
  const pitch = (2 * half) / count
  const margin = windowMargin(row.mode, speed, pitch)
  const start = -margin - offset
  const end = width + margin - offset
  const spans: (readonly [number, number])[] = [[start, end]]
  if (start < 0) spans.push([start + half, half])
  for (let tile = 0; tile < count; tile++) {
    const left = tile * pitch
    if (spans.some(([from, to]) => left < to && left + pitch > from)) wanted.add(tile)
  }
  for (const tile of always) if (tile >= 0 && tile < count) wanted.add(tile)
  if (count % 2 === 0) for (const tile of [...wanted]) wanted.add((tile + count / 2) % count)
  return wanted
}
