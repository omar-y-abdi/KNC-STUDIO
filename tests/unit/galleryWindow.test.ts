import { describe, expect, it } from 'vitest'
import {
  wantedTiles,
  windowMargin,
  type RowWindow,
} from '../../modules/public-web/src/about/galleryWindow'

// GalleryMarquee's geometry: 210 px tiles, a 14 px gap, 34 px/s.
const PITCH = 224
const SPEED = 34
const sorted = (tiles: ReadonlySet<number>): number[] => [...tiles].sort((a, b) => a - b)
// Eight tiles, four per loop half (tiles 0-3 and their copies 4-7), in a 390 px row.
const row = (patch: Partial<RowWindow>): RowWindow => ({
  offset: 0,
  half: 4 * PITCH,
  width: 390,
  count: 8,
  mode: 'auto',
  ...patch,
})

/** Tiles whose box meets the row's visible strip, without a margin. */
function visible({ offset, half, width, count }: RowWindow): number[] {
  const pitch = (2 * half) / count
  return [...Array(count).keys()].filter(
    (tile) => tile * pitch < width - offset && (tile + 1) * pitch > -offset,
  )
}

describe('gallery window margins', () => {
  it('reaches 1.5 s of auto-scroll ahead, and five tile pitches while dragging', () => {
    expect(windowMargin('auto', SPEED, PITCH)).toBe(51)
    expect(windowMargin('drag', SPEED, PITCH)).toBe(1120)
  })
})

describe('wanted gallery tiles', () => {
  // Twelve tiles, six per loop half (tiles 0-5 and their copies 6-11), in a 700 px row.
  const seam = { count: 12, half: 6 * PITCH, width: 700 }

  it('wants nothing before the row is measured, not even a selected or focused tile', () => {
    expect(wantedTiles(row({ half: 0 }), SPEED, [0, 1]).size).toBe(0)
    expect(wantedTiles(row({ width: 0 }), SPEED, [0, 1]).size).toBe(0)
    expect(wantedTiles(row({ count: 0 }), SPEED, []).size).toBe(0)
  })

  it('wants a tile whose box reaches into the auto margin and no tile beyond it', () => {
    // Tile 2 starts at 448 px; the window ends at 390 + 51 = 441 px. Tile 3 ends the loop half
    // that a wrap brings in left of the row; 4, 5 and 7 are the copies of 0, 1 and 3.
    expect(sorted(wantedTiles(row({}), SPEED, []))).toEqual([0, 1, 3, 4, 5, 7])
    // 8 px further on the window ends at 449 px, one pixel into tile 2.
    expect(sorted(wantedTiles(row({ offset: -8 }), SPEED, []))).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(sorted(wantedTiles(row({ offset: -6 }), SPEED, []))).toEqual([0, 1, 3, 4, 5, 7])
  })

  it('widens the window by five tile pitches while dragging', () => {
    // Tiles 5 and 6 show; the auto margin adds tile 4, the drag margin every tile of 0-11, and
    // each brings its copy sixteen tiles on.
    const long = { count: 32, half: 16 * PITCH, offset: -5 * PITCH }
    expect(sorted(wantedTiles(row(long), SPEED, []))).toEqual([4, 5, 6, 20, 21, 22])
    expect(sorted(wantedTiles(row({ ...long, mode: 'drag' }), SPEED, []))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
    ])
  })

  it('wants the tile a wrap brings in at the left, with its copy', () => {
    // Moving right past offset 0 wraps by one half: tile 5 (ending at 1344 px) lands left of the row.
    expect(sorted(wantedTiles(row({ ...seam, offset: -10 }), SPEED, []))).toEqual([
      0, 1, 2, 3, 5, 6, 7, 8, 9, 11,
    ])
    expect(sorted(wantedTiles(row({ ...seam, offset: -60 }), SPEED, []))).toEqual([
      0, 1, 2, 3, 6, 7, 8, 9,
    ])
  })

  it('wants the tiles at the end of the loop together with the copies a wrap swaps in', () => {
    // At -1340 px tiles 6-9 fill the row and tile 5's slot (photo and gap) ends 4 px into it.
    expect(sorted(wantedTiles(row({ ...seam, offset: -1340 }), SPEED, []))).toEqual([
      0, 1, 2, 3, 5, 6, 7, 8, 9, 11,
    ])
  })

  it('always wants the selected and the focused tile, and ignores an index outside the track', () => {
    const near = row({ ...seam, offset: -60 })
    expect(sorted(wantedTiles(near, SPEED, [4]))).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10])
    expect(sorted(wantedTiles(near, SPEED, [10, 11]))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ])
    expect(sorted(wantedTiles(near, SPEED, [12, -1, Number.NaN]))).toEqual([0, 1, 2, 3, 6, 7, 8, 9])
  })

  it('wants a tile and its loop copy together, so a wrap shows only tiles wanted before it', () => {
    const step = SPEED * 0.064 // The longest frame the loop advances by.
    const phone = { count: 6, half: 3 * PITCH, width: 390 }
    for (const geometry of [phone, seam]) {
      const { half } = geometry
      const wraps = [
        { before: -half + step / 2, after: -step / 2 }, // Moving left: -half wraps to 0.
        { before: -step / 2, after: step / 2 - half }, // Moving right: 0 wraps to -half.
      ]
      for (const { before, after } of wraps) {
        const wanted = wantedTiles(row({ ...geometry, offset: before }), SPEED, [])
        const shown = visible(row({ ...geometry, offset: after }))
        expect(shown.length).toBeGreaterThan(0)
        expect(shown.filter((tile) => !wanted.has(tile))).toEqual([])
      }
    }
  })

  it('adds no loop copy to a track that does not split into two equal halves', () => {
    expect(sorted(wantedTiles(row({ count: 7, half: 3.5 * PITCH }), SPEED, []))).toEqual([0, 1, 3])
  })
})
