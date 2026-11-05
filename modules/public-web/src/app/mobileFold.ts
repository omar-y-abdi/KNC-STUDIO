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

/** Prime native sticky positioning before the browser's first pan, without forwarding or
 * cancelling scrolling. Ordinary taps, including the theme toggle, leave the resting layout alone.
 */
export function primeMobileFold(root: HTMLElement, change: (active: boolean) => void): () => void {
  let touching = false
  let startY = 0
  const prime = (): void => change(true)
  const rest = (): void => {
    if (!touching && root.scrollTop <= 0) change(false)
  }
  const move = (event: TouchEvent): void => {
    const touch = event.touches[0]
    if (event.defaultPrevented || !touch || event.touches.length !== 1) return
    if (touch.clientY < startY || root.scrollTop > 0) {
      prime()
      // Only the first movement waits for main-thread setup. The browser owns the pan.
      root.removeEventListener('touchmove', move)
    }
  }
  const start = (event: TouchEvent): void => {
    touching = true
    startY = event.touches[0]?.clientY ?? 0
    root.addEventListener('touchmove', move, { passive: false })
  }
  const end = (): void => {
    touching = false
    root.removeEventListener('touchmove', move)
    rest()
  }
  const wheel = (event: WheelEvent): void => {
    if (
      !event.defaultPrevented &&
      !event.ctrlKey &&
      event.deltaY !== 0 &&
      (event.deltaY > 0 || root.scrollTop > 0)
    )
      prime()
  }
  const key = (event: KeyboardEvent): void => {
    // Canvas events come from another Window; use its DOM method, not a cross-realm instanceof.
    const target = event.target as HTMLElement | null
    if (
      event.defaultPrevented ||
      target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
    )
      return
    if (event.key === ' ' && target?.closest?.('button,a[href]')) return
    if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) prime()
    else if (root.scrollTop > 0 && ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) prime()
  }
  root.addEventListener('touchstart', start, { passive: true })
  root.addEventListener('touchend', end, { passive: true })
  root.addEventListener('touchcancel', end, { passive: true })
  root.addEventListener('wheel', wheel, { passive: false })
  root.addEventListener('keydown', key)
  root.addEventListener('scroll', rest, { passive: true })
  rest()
  return () => {
    root.removeEventListener('touchstart', start)
    root.removeEventListener('touchmove', move)
    root.removeEventListener('touchend', end)
    root.removeEventListener('touchcancel', end)
    root.removeEventListener('wheel', wheel)
    root.removeEventListener('keydown', key)
    root.removeEventListener('scroll', rest)
  }
}
