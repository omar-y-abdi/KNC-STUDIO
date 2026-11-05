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

/** Content-only choreography. Native panel/header positioning remains owned by the carriers. */
export function mobileBrandMotion(collapse: number, viewportHeight: number, reduced = false) {
  const progress = Math.min(1, Math.max(0, collapse / Math.max(1, viewportHeight - 112)))
  const phase = (start: number, end: number): number => {
    const t = Math.min(1, Math.max(0, (progress - start) / (end - start)))
    return t * t * (3 - 2 * t)
  }
  const banner = phase(0.86, 1)
  return {
    actions: 1 - phase(0, 0.3),
    brand: reduced ? 1 - phase(0, 0.18) : 1 - banner,
    banner,
    shrink: reduced ? 0 : phase(0, 0.65),
    lift: reduced ? 0 : phase(0, 0.8),
    slide: reduced ? 0 : phase(0.7, 0.86),
  }
}

const brandBaselineAttribute = 'data-knc-brand-baseline'

/** Capture runs in another iframe realm, so keep the original values on the painted node.
 * Only these decorative properties are restored; unrelated owner styling stays untouched. */
function rememberBrandBaseline(element: HTMLElement, properties: string[], inert = false): void {
  if (element.hasAttribute(brandBaselineAttribute)) return
  element.setAttribute(
    brandBaselineAttribute,
    JSON.stringify({
      styles: Object.fromEntries(
        properties.map((property) => [
          property,
          [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)],
        ]),
      ),
      ...(inert ? { inert: element.hasAttribute('inert') } : {}),
    }),
  )
}

/** Restore a snapshot clone before its current inline styles become the CMS source baseline. */
export function restoreMobileBrandSnapshot(root: Element): void {
  for (const element of [root, ...root.querySelectorAll(`[${brandBaselineAttribute}]`)]) {
    const value = element.getAttribute(brandBaselineAttribute)
    if (!value) continue
    const baseline = JSON.parse(value) as {
      styles: Record<string, [string, string]>
      inert?: boolean
    }
    const style = (element as HTMLElement).style
    for (const property of ['translate', 'scale', 'opacity']) {
      const original = baseline.styles[property]
      if (!original) continue
      if (original[0]) style.setProperty(property, original[0], original[1])
      else style.removeProperty(property)
    }
    if (baseline.inert !== undefined) element.toggleAttribute('inert', baseline.inert)
    element.removeAttribute(brandBaselineAttribute)
  }
}

/** Measure layout offsets, never the transformed brand's client rect: reverse scrolling must not
 * accumulate its own previous transform. The original SVG or owner image remains untouched.
 */
export function paintMobileBrand(
  root: HTMLElement,
  collapse: number,
  viewportHeight: number,
  reduced = false,
): void {
  const hero = root.querySelector<HTMLElement>('[data-knc-fold="hero"]')
  const brand = hero?.querySelector<HTMLElement>('h1')
  const mark = root.querySelector<HTMLElement>('[data-knc-fold="mark"]')
  const asset = brand?.querySelector('svg,img')
  const compact = mark?.querySelector('svg,img')
  if (!hero || !brand || !mark || !asset || !compact) return
  const win = root.ownerDocument.defaultView
  if (!win) return
  const motion = mobileBrandMotion(collapse, viewportHeight, reduced)
  brand.setAttribute('data-knc-fold', 'brand')
  const assetHeight = Number.parseFloat(win.getComputedStyle(asset).height) || asset.clientHeight
  const compactStyle = win.getComputedStyle(compact)
  const compactHeight = Number.parseFloat(compactStyle.height)
  const compactWidth = Number.parseFloat(compactStyle.width)
  if (!(assetHeight > 0 && compactHeight > 0 && compactWidth > 0)) return
  const centerX = brand.offsetLeft + brand.offsetWidth / 2
  const centerY = brand.offsetTop + assetHeight / 2
  // CornerMark's emblem is centered at (29,24) in its 322×48 viewBox.
  const anchorX = mark.offsetLeft + compactWidth * (29 / 322)
  const anchorY = mark.offsetTop + compactHeight / 2
  const scale = 1 + (compactHeight / assetHeight - 1) * motion.shrink
  const x = (anchorX - centerX) * motion.slide
  const y = reduced
    ? 0
    : collapse +
      centerY +
      (anchorY - centerY) * motion.lift -
      brand.offsetTop -
      (assetHeight / 2) * scale
  rememberBrandBaseline(brand, ['translate', 'scale', 'opacity'])
  rememberBrandBaseline(mark, ['opacity'])
  brand.style.translate = `${x}px ${y}px`
  brand.style.scale = String(scale)
  brand.style.opacity = String(motion.brand)
  mark.style.opacity = String(motion.banner)
  const fade = (element: HTMLElement): void => {
    rememberBrandBaseline(element, ['opacity'], true)
    if (win.getComputedStyle(element).display === 'contents') {
      for (const child of element.children) fade(child as HTMLElement)
    } else {
      element.style.opacity = String(motion.actions)
    }
    element.inert = motion.actions === 0
  }
  for (const child of hero.children) if (child !== brand) fade(child as HTMLElement)
}
