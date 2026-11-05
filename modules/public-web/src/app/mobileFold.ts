/** Shared scroll geometry for the live mobile site and its editing canvas. */
export function mobileFold(
  scrollTop: number,
  viewportHeight: number,
  privacyOpen = false,
): {
  collapse: number
  compact: boolean
  pinned: boolean
  opacity: number
} {
  const limit = Math.max(0, viewportHeight - 112)
  const scrolled = Math.max(0, scrollTop)
  const collapse = privacyOpen ? (scrolled >= limit ? limit : 0) : Math.min(limit, scrolled)
  return {
    collapse,
    compact: collapse > 0,
    pinned: collapse === limit,
    opacity: Math.max(0, 1 - collapse / Math.max(1, limit * 0.45)),
  }
}

/** The fold uses CSS 100dvh, which can differ from innerHeight while a mobile keyboard is open.
 * The scroll root is exactly that CSS height minus the separately reserved privacy-panel space. */
export function mobileLayoutViewportHeight(root: HTMLElement): number {
  const style = getComputedStyle(root)
  return (
    Number.parseFloat(style.height) +
    (Number.parseFloat(style.getPropertyValue('--privacy-overlay-space')) || 0)
  )
}
