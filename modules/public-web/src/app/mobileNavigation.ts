import { EASE } from './shared'

/** Preserve the original mobile fold's 660 ms CSS timing (before 809160b), now driving
 * the scroll position so the approved hero morph is visible throughout navigation. */
export function scrollMobileHero(
  root: HTMLElement,
  top: number,
  complete: () => void,
): () => void {
  const win = root.ownerDocument.defaultView
  if (!win) {
    complete()
    return () => undefined
  }
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)')
  const from = root.scrollTop
  const to = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight))
  const write = (position: number): void => root.scrollTo({ top: position, behavior: 'instant' })
  if (reduced.matches || from === to) {
    write(to)
    complete()
    return () => undefined
  }
  // An empty effect supplies native CSS easing without animating any page styles.
  const clock = root.animate([], { duration: 660, easing: EASE, fill: 'both' })
  let frame = 0
  let stopped = false
  const cancel = (): void => {
    if (stopped) return
    stopped = true
    win.cancelAnimationFrame(frame)
    clock.cancel()
    for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown'])
      root.removeEventListener(event, cancel)
    complete()
  }
  const paint = (): void => {
    const progress = reduced.matches ? 1 : (clock.effect?.getComputedTiming().progress ?? 0)
    write(from + (to - from) * progress)
    if (progress === 1) cancel()
    else frame = win.requestAnimationFrame(paint)
  }
  // A new user gesture takes ownership immediately; never forward or multiply its delta.
  for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown'])
    root.addEventListener(event, cancel, { passive: true })
  frame = win.requestAnimationFrame(paint)
  return cancel
}
