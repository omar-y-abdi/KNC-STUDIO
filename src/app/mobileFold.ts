/** Shared scroll geometry for the live mobile site and its editing canvas. */
export function mobileFold(
  scrollTop: number,
  viewportHeight: number,
  privacyOpen = false,
): {
  collapse: number
  compact: boolean
  opacity: number
} {
  const limit = Math.max(0, viewportHeight - 112)
  const scrolled = Math.max(0, scrollTop)
  const collapse = privacyOpen ? (scrolled >= limit ? limit : 0) : Math.min(limit, scrolled)
  return {
    collapse,
    compact: collapse > 0,
    opacity: Math.max(0, 1 - collapse / Math.max(1, limit * 0.45)),
  }
}
