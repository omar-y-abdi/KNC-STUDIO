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
  const banner = phase(0.55, 0.85)
  return {
    actions: 1 - phase(0, 0.25),
    controls: 1 - phase(0, 0.12) + phase(0.9, 1),
    brand: 1 - banner,
    banner,
    travel: reduced ? 0 : phase(0, 0.85),
    settled: progress >= 0.85,
  }
}

const brandBaselineAttribute = 'data-knc-brand-baseline'

/** Capture runs in another iframe realm, so keep the original values on the painted node.
 * Only these decorative properties are restored; unrelated owner styling stays untouched. */
function rememberBrandBaseline(
  element: HTMLElement | SVGElement,
  properties: string[],
  inert = false,
): void {
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
    for (const property of [
      'translate',
      'scale',
      'opacity',
      'transform',
      'font-size',
      'font-weight',
      'letter-spacing',
      'overflow',
    ]) {
      const original = baseline.styles[property]
      if (!original) continue
      if (original[0]) style.setProperty(property, original[0], original[1])
      else style.removeProperty(property)
    }
    if (baseline.inert !== undefined) element.toggleAttribute('inert', baseline.inert)
    element.removeAttribute(brandBaselineAttribute)
  }
}

/** Decompose only the known vector lockup. Uploaded images use the intact-image fallback. */
function paintVectorBrand(
  source: SVGSVGElement,
  target: SVGSVGElement,
  sourceLeft: number,
  sourceTop: number,
  sourceUnit: number,
  targetLeft: number,
  targetTop: number,
  targetUnit: number,
  motion: ReturnType<typeof mobileBrandMotion>,
  reduced: boolean,
): boolean {
  const word = source.querySelector<SVGTextElement>(
    '[data-knc-brand-part="wordmark"],text[x="230"][y="216"]',
  )
  const finalWord = target.querySelector<SVGTextElement>(
    '[data-knc-brand-part="wordmark"],text[x="70"][y="32"]',
  )
  const monogram = [
    ...source.querySelectorAll<SVGGraphicsElement>(
      '[data-knc-brand-part="monogram"],text[y="150"],text[y="156"]',
    ),
  ]
  const emblem = [
    ...target.querySelectorAll<SVGGraphicsElement>(
      '[data-knc-brand-part="monogram"],line,text[x="29"]',
    ),
  ]
  if (!word || !finalWord || !monogram.length || !emblem.length) return false
  rememberBrandBaseline(source, ['overflow'])
  rememberBrandBaseline(target, ['overflow'])
  source.style.overflow = 'visible'
  target.style.overflow = 'visible'
  const number = (node: Element, name: string): number => Number(node.getAttribute(name))
  const finalX =
    targetLeft + (number(finalWord, 'x') + finalWord.getComputedTextLength() / 2) * targetUnit
  const finalY = targetTop + number(finalWord, 'y') * targetUnit
  const sourceX = sourceLeft + number(word, 'x') * sourceUnit
  const sourceY = sourceTop + number(word, 'y') * sourceUnit
  rememberBrandBaseline(word, [
    'transform', 'opacity', 'font-size', 'font-weight', 'letter-spacing',
  ])
  const mix = (start: number, end: number): number => start + (end - start) * motion.travel
  word.style.transform = `translate(${((finalX - sourceX) * motion.travel) / sourceUnit}px, ${((finalY - sourceY) * motion.travel) / sourceUnit}px)`
  word.style.fontSize = `${mix(number(word, 'font-size'), (number(finalWord, 'font-size') * targetUnit) / sourceUnit)}px`
  word.style.fontWeight = String(mix(number(word, 'font-weight'), number(finalWord, 'font-weight')))
  word.style.letterSpacing = `${mix(number(word, 'letter-spacing'), (number(finalWord, 'letter-spacing') * targetUnit) / sourceUnit)}px`
  // Exactly one wordmark: the static destination replaces the source only at the matched pose.
  word.style.opacity = motion.settled ? '0' : '1'
  rememberBrandBaseline(finalWord, ['opacity'])
  finalWord.style.opacity = motion.settled ? '1' : '0'
  const bounds = (nodes: SVGGraphicsElement[]) => {
    const boxes = nodes.map((node) => node.getBBox())
    const x = Math.min(...boxes.map((box) => box.x))
    const y = Math.min(...boxes.map((box) => box.y))
    return {
      x,
      y,
      width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
      height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
    }
  }
  const from = bounds(monogram)
  const to = bounds(emblem)
  const fromX = from.x + from.width / 2
  const fromY = from.y + from.height / 2
  const toX = (targetLeft + (to.x + to.width / 2) * targetUnit - sourceLeft) / sourceUnit
  const toY = (targetTop + (to.y + to.height / 2) * targetUnit - sourceTop) / sourceUnit
  const finalScale =
    (Math.min(to.width / from.width, to.height / from.height) * targetUnit) / sourceUnit
  const scale = mix(1, finalScale)
  for (const node of monogram) {
    rememberBrandBaseline(node, ['transform', 'opacity'])
    node.style.transform = `matrix(${scale},0,0,${scale},${mix(fromX, toX) - fromX * scale},${mix(fromY, toY) - fromY * scale})`
    node.style.opacity = String(motion.brand)
  }
  const emblemScale = reduced ? 1 : scale / finalScale
  const emblemX = reduced
    ? to.x + to.width / 2
    : (sourceLeft + mix(fromX, toX) * sourceUnit - targetLeft) / targetUnit
  const emblemY = reduced
    ? to.y + to.height / 2
    : (sourceTop + mix(fromY, toY) * sourceUnit - targetTop) / targetUnit
  for (const node of emblem) {
    rememberBrandBaseline(node, ['transform', 'opacity'])
    node.style.transform = `matrix(${emblemScale},0,0,${emblemScale},${emblemX - (to.x + to.width / 2) * emblemScale},${emblemY - (to.y + to.height / 2) * emblemScale})`
    node.style.opacity = String(motion.banner)
  }
  for (const node of source.children) {
    if (node === word || monogram.includes(node as SVGGraphicsElement)) continue
    const detail = node as SVGElement
    rememberBrandBaseline(detail, ['opacity'])
    detail.style.opacity = String(motion.actions)
  }
  // Fade-only mode keeps both marks at their original positions and never travels the glyphs.
  if (reduced) word.style.opacity = String(motion.brand)
  return true
}

/** Measure layout offsets, never the transformed brand's client rect: reverse scrolling must not
 * accumulate its own previous transform. Existing nodes and owner image bytes stay intact.
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
  const assetStyle = win.getComputedStyle(asset)
  const assetHeight = Number.parseFloat(assetStyle.height) || asset.clientHeight
  const assetWidth = Number.parseFloat(assetStyle.width) || asset.clientWidth
  const compactStyle = win.getComputedStyle(compact)
  const compactHeight = Number.parseFloat(compactStyle.height)
  const compactWidth = Number.parseFloat(compactStyle.width)
  if (!(assetWidth > 0 && assetHeight > 0 && compactHeight > 0 && compactWidth > 0)) return
  rememberBrandBaseline(brand, ['translate', 'scale', 'opacity'])
  rememberBrandBaseline(mark, ['translate', 'scale', 'opacity'])
  const vector =
    asset.localName === 'svg' &&
    asset.getAttribute('viewBox') === '0 0 460 330' &&
    compact.localName === 'svg' &&
    compact.getAttribute('viewBox') === '0 0 322 48' &&
    paintVectorBrand(
      asset as SVGSVGElement,
      compact as SVGSVGElement,
      brand.offsetLeft + (brand.offsetWidth - assetWidth) / 2,
      brand.offsetTop,
      assetWidth / 460,
      mark.offsetLeft,
      mark.offsetTop,
      compactWidth / 322,
      motion,
      reduced,
    )
  brand.style.translate = vector && !reduced ? `0px ${collapse}px` : '0px 0px'
  brand.style.scale = '1'
  brand.style.opacity = vector ? '1' : String(motion.brand)
  mark.style.translate = '0px 0px'
  mark.style.scale = '1'
  mark.style.opacity = vector ? '1' : String(motion.banner)
  const controls = root.querySelector<HTMLElement>('[data-knc-fold="controls"]')
  if (controls) {
    rememberBrandBaseline(controls, ['opacity'], true)
    controls.style.opacity = String(motion.controls)
    controls.inert = motion.controls === 0
  }
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
