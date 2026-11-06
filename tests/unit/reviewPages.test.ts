import { describe, expect, it } from 'vitest'
import {
  PAGE_BUTTONS,
  REVIEWS_PER_PAGE,
  clampPage,
  pageCount,
  pageItems,
  pageRow,
} from '../../modules/public-web/src/about/reviewPages'

/** Every row reached from the first one by pressing ">" until it disappears. */
function forwardRows(pages: number): (readonly number[])[] {
  const rows: (readonly number[])[] = []
  let row = pageRow(1, pages)
  rows.push(row.pages)
  while (row.nextStart !== null) {
    row = pageRow(row.nextStart, pages)
    rows.push(row.pages)
  }
  return rows
}

describe('review pages', () => {
  it('holds five reviews per page and keeps one page for an empty list', () => {
    expect(REVIEWS_PER_PAGE).toBe(5)
    expect([0, 1, 5, 6, 10, 11, 100].map(pageCount)).toEqual([1, 1, 1, 2, 2, 3, 20])
  })

  it('slices a page newest first and leaves the last page short', () => {
    const items = Array.from({ length: 12 }, (_, index) => index)
    expect(pageItems(items, 1)).toEqual([0, 1, 2, 3, 4])
    expect(pageItems(items, 2)).toEqual([5, 6, 7, 8, 9])
    expect(pageItems(items, 3)).toEqual([10, 11])
  })

  it('clamps a page into the pages that exist', () => {
    expect([clampPage(0, 4), clampPage(3, 4), clampPage(9, 4)]).toEqual([1, 3, 4])
  })

  it('shows no arrows while every page fits in one row', () => {
    for (let pages = 1; pages <= PAGE_BUTTONS; pages++)
      expect(pageRow(1, pages)).toEqual({
        pages: Array.from({ length: pages }, (_, index) => index + 1),
        previousStart: null,
        nextStart: null,
      })
  })

  it('moves ">" to the next five pages or to the five that end on the last page', () => {
    expect(pageRow(1, 7)).toEqual({ pages: [1, 2, 3, 4, 5], previousStart: null, nextStart: 3 })
    expect(pageRow(3, 7)).toEqual({ pages: [3, 4, 5, 6, 7], previousStart: 1, nextStart: null })
    expect(pageRow(1, 20).nextStart).toBe(6)
    expect(pageRow(6, 20)).toEqual({ pages: [6, 7, 8, 9, 10], previousStart: 1, nextStart: 11 })
    expect(forwardRows(12)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [8, 9, 10, 11, 12],
    ])
  })

  it('moves "<" to the five pages before the row, or back to page 1', () => {
    expect(pageRow(8, 12).previousStart).toBe(3)
    expect(pageRow(3, 12).previousStart).toBe(1)
    expect(pageRow(16, 20).previousStart).toBe(11)
  })

  it('clamps a stale row start into the pages that exist', () => {
    expect(pageRow(0, 9).pages).toEqual([1, 2, 3, 4, 5])
    expect(pageRow(40, 9)).toEqual({ pages: [5, 6, 7, 8, 9], previousStart: 1, nextStart: null })
  })

  it('reaches every page with full contiguous rows, forward and back', () => {
    for (let pages = 1; pages <= 60; pages++) {
      const rows = forwardRows(pages)
      for (const row of rows) {
        expect(row.length).toBe(Math.min(PAGE_BUTTONS, pages))
        expect(row.slice(1).every((page, index) => page - 1 === row[index])).toBe(true)
        expect(Math.min(...row)).toBeGreaterThanOrEqual(1)
        expect(Math.max(...row)).toBeLessThanOrEqual(pages)
      }
      expect(new Set(rows.flat()).size).toBe(pages)
      expect(rows.at(-1)?.at(-1)).toBe(pages)

      let row = pageRow(pages, pages)
      while (row.previousStart !== null) row = pageRow(row.previousStart, pages)
      expect(row.pages[0]).toBe(1)
    }
  })
})
