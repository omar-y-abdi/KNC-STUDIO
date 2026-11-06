// Paging for the About reviews list: five reviews per page, newest first (the order the port
// returns), and a row of at most five page buttons. The row moves only through its arrows: ">"
// shows the next five page numbers, or the last five when fewer remain; "<" mirrors it toward
// page 1. Moving the row never changes the page being read. Pure functions, no DOM.

/** Reviews shown on one page. */
export const REVIEWS_PER_PAGE = 5

/** Page buttons shown in the row at once. */
export const PAGE_BUTTONS = 5

/** The visible page buttons and where each arrow moves the row (`null`: that arrow is hidden). */
export interface PageRow {
  /** Page numbers shown, ascending, 1-based; at most `PAGE_BUTTONS`. */
  readonly pages: readonly number[]
  /** First page number of the row after "<"; `null` when page 1 is already shown. */
  readonly previousStart: number | null
  /** First page number of the row after ">"; `null` when the last page is already shown. */
  readonly nextStart: number | null
}

/** Number of pages for `total` reviews; an empty list still has its one (empty) page. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / REVIEWS_PER_PAGE))
}

/** `page` (1-based) clamped into `1..pages`. */
export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(1, page), pages)
}

/** The reviews on `page` (1-based); the caller passes a page within `1..pageCount`. */
export function pageItems<T>(items: readonly T[], page: number): readonly T[] {
  const start = (page - 1) * REVIEWS_PER_PAGE
  return items.slice(start, start + REVIEWS_PER_PAGE)
}

/** The button row that starts at `start`, clamped so it never runs past the last of `pages`. */
export function pageRow(start: number, pages: number): PageRow {
  const lastStart = Math.max(1, pages - PAGE_BUTTONS + 1)
  const first = Math.min(Math.max(1, start), lastStart)
  const last = Math.min(pages, first + PAGE_BUTTONS - 1)
  return {
    pages: Array.from({ length: last - first + 1 }, (_, index) => first + index),
    previousStart: first > 1 ? Math.max(1, first - PAGE_BUTTONS) : null,
    nextStart: last < pages ? Math.min(first + PAGE_BUTTONS, lastStart) : null,
  }
}
