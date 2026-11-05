import { getMobileBrandGeometry } from './mobileBrandGeometry'
import type { MobileBrandGeometry } from './mobileBrandGeometry'
import { monogramPaths } from '../ui/logos/monogramPaths'
export { observeMobileBrandGeometry } from './mobileBrandGeometry'

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
    actions: 1 - phase(0, 0.65),
    phone: 1 - phase(0, 0.2) + phase(0.9, 1),
    rules: phase(0.9, 1),
    controlsShift: 24 * phase(0.65, 0.9),
    brand: 1 - banner,
    banner,
    travel: reduced ? 0 : phase(0, 0.85),
    form: reduced ? 0 : phase(0.05, 0.6),
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
  for (const runtime of root.querySelectorAll('[data-knc-brand-runtime]')) runtime.remove()
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

interface BrandLayer {
  vector: NonNullable<MobileBrandGeometry['vector']>
  svg: SVGSVGElement
  sourceWord: SVGTextElement
  targetWord: SVGTextElement
  paths: SVGPathElement[]
}
const brandLayers = new WeakMap<HTMLElement, BrandLayer>()

/** The artwork has one viewport anchor. Keeping both word weights in this private header
 * layer avoids compositor scroll moving one copy before JavaScript updates the other. */
function brandLayer(root: HTMLElement, geometry: MobileBrandGeometry): BrandLayer | undefined {
  const vector = geometry.vector
  if (!vector) return
  const parent = root.querySelector('[data-knc-fold="header-carrier"]') ?? root.querySelector('[data-knc-fold="panel"]')
  if (!parent) return
  const cached = brandLayers.get(geometry.brand)
  if (cached?.svg.parentElement === parent && cached.vector === vector) return cached
  for (const previous of root.querySelectorAll('[data-knc-brand-runtime]')) previous.remove()
  const svg = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('data-knc-brand-runtime', '')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'currentColor')
  svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100dvh;overflow:visible;pointer-events:none'
  const cloneWord = (original: SVGTextElement): SVGTextElement => {
    const copy = original.cloneNode(true) as SVGTextElement
    for (const attribute of [...copy.attributes]) {
      if (attribute.name === 'id' || attribute.name.startsWith('data-knc-')) copy.removeAttribute(attribute.name)
    }
    copy.style.removeProperty('opacity')
    copy.style.removeProperty('transform')
    return copy
  }
  const sourceWord = cloneWord(vector.word), targetWord = cloneWord(vector.finalWord)
  const paths = monogramPaths.map(() => root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'))
  for (const index of [0, 2, 1]) svg.append(paths[index]!)
  svg.append(sourceWord, targetWord)
  parent.append(svg)
  const layer = { vector, svg, sourceWord, targetWord, paths }
  brandLayers.set(geometry.brand, layer)
  return layer
}

/** Compatible contours are generated from the exact shipped fonts. The same three paths
 * change shape and position; no alternate BNB text is substituted during the movement. */
function paintMonogram(geometry: MobileBrandGeometry, paths: SVGPathElement[], travel: number, form: number): void {
  const { targetLeft, targetTop, targetUnit, sourceLeft, sourceTop, sourceUnit, vector } = geometry
  if (!vector || vector.emblemCharOrigins.length !== 3) return
  const sourceGlyphs = [
    { x: 174 - 0.672 * 150 / 2, y: 150, size: 150 },
    { x: 230 - 0.863 * 122 / 2, y: 156, size: 122 },
    { x: 286 - 0.672 * 150 / 2, y: 150, size: 150 },
  ]
  const startCenter = vector.sourceWordBounds.x + vector.sourceWordBounds.width / 2
  const endCenter = vector.targetWordBounds.x + vector.targetWordBounds.width / 2
  const startSize = vector.sourceWord.size * sourceUnit
  const endSize = vector.targetWord.size * targetUnit
  const frameSize = startSize + (endSize - startSize) * travel
  const startX = sourceLeft + startCenter * sourceUnit
  const startY = sourceTop + vector.sourceWord.y * sourceUnit
  const frameX = startX + (targetLeft + endCenter * targetUnit - startX) * travel
  const frameY = startY + (targetTop + vector.targetWord.y * targetUnit - startY) * travel
  for (const [index, contours] of monogramPaths.entries()) {
    const start = sourceGlyphs[index]!
    const end = vector.emblemCharOrigins[index]!
    const d = contours.map(({ from, to }) => {
      const points = []
      for (let point = 0; point < from.length; point += 2) {
        // The internal stacked-to-horizontal arrangement completes before the whole
        // brand reaches the header. Both phases share one moving wordmark baseline.
        const fromX = (start.x + from[point]! * start.size - startCenter) / vector.sourceWord.size
        const fromY = (start.y + from[point + 1]! * start.size - vector.sourceWord.y) / vector.sourceWord.size
        const toX = (end.x + to[point]! * 21 - endCenter) / vector.targetWord.size
        const toY = (end.y + to[point + 1]! * 21 - vector.targetWord.y) / vector.targetWord.size
        const x = frameX + (fromX + (toX - fromX) * form) * frameSize
        const y = frameY + (fromY + (toY - fromY) * form) * frameSize
        points.push(`${point === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
      }
      return points.join('') + 'Z'
    }).join('')
    paths[index]!.setAttribute('d', d)
  }
}

/** Scroll frames use cached geometry and transform/opacity writes only. Font layout is
 * measured when assets, fonts or real layout change, never after a scroll-frame write. */
export function paintMobileBrand(root: HTMLElement, collapse: number, viewportHeight: number, reduced = false): void {
  const geometry = getMobileBrandGeometry(root)
  if (!geometry) return
  const { hero, brand, mark, source, target, sourceLeft, sourceTop, sourceUnit, targetLeft, targetTop, targetUnit, vector, phone } = geometry
  const motion = mobileBrandMotion(collapse, viewportHeight, reduced)
  let detailsShift = 0
  const mix = (a: number, b: number): number => a + (b - a) * motion.travel
  rememberBrandBaseline(brand, ['translate', 'scale', 'opacity'])
  rememberBrandBaseline(mark, ['translate', 'scale', 'opacity'])
  brand.style.translate = vector && !reduced ? `0px ${collapse}px` : '0px 0px'
  brand.style.scale = '1'
  brand.style.opacity = vector ? '1' : String(motion.brand)
  mark.style.translate = '0px 0px'
  mark.style.scale = '1'
  mark.style.opacity = vector ? '1' : String(motion.banner)

  if (vector) {
    rememberBrandBaseline(source, ['overflow'])
    rememberBrandBaseline(target, ['overflow'])
    source.style.overflow = 'visible'
    target.style.overflow = 'visible'
    const { word, finalWord, sourceWord, targetWord, sourceWordBounds, targetWordBounds } = vector
    const startCenter = sourceWordBounds.x + sourceWordBounds.width / 2
    const endCenter = targetWordBounds.x + targetWordBounds.width / 2
    const center = mix(sourceLeft + startCenter * sourceUnit, targetLeft + endCenter * targetUnit)
    const baseline = mix(sourceTop + sourceWord.y * sourceUnit, targetTop + targetWord.y * targetUnit)
    detailsShift = baseline - (sourceTop + sourceWord.y * sourceUnit)
    const width = mix(sourceWordBounds.width * sourceUnit, targetWordBounds.width * targetUnit)
    const size = mix(sourceWord.size * sourceUnit, targetWord.size * targetUnit)
    const layer = brandLayer(root, geometry)
    rememberBrandBaseline(word, ['opacity'])
    rememberBrandBaseline(finalWord, ['opacity'])
    word.style.opacity = reduced ? String(motion.brand) : '0'
    finalWord.style.opacity = reduced ? String(motion.banner) : '0'
    if (layer) {
      layer.svg.style.display = reduced ? 'none' : ''
      for (const [node, metrics, box] of [
        [layer.sourceWord, sourceWord, sourceWordBounds],
        [layer.targetWord, targetWord, targetWordBounds],
      ] as const) {
        const sx = width / box.width, sy = size / metrics.size
        const x = center - (box.x + box.width / 2) * sx
        const y = baseline - metrics.y * sy
        node.style.transform = `matrix(${sx},0,0,${sy},${x},${y})`
      }
      layer.sourceWord.style.opacity = String(motion.brand)
      layer.targetWord.style.opacity = String(motion.banner)
      if (!reduced) paintMonogram(geometry, layer.paths, motion.travel, motion.form)
    }
    for (const node of vector.monogram) {
      rememberBrandBaseline(node, ['opacity'])
      node.style.opacity = reduced ? String(motion.brand) : '0'
    }
    for (const node of vector.emblem) {
      rememberBrandBaseline(node, ['opacity'])
      node.style.opacity = node.localName === 'line' ? String(motion.rules) : reduced ? String(motion.banner) : '0'
    }
    for (const node of source.children) {
      if (node === word || vector.monogram.includes(node as SVGGraphicsElement) || node.hasAttribute('data-knc-brand-runtime')) continue
      rememberBrandBaseline(node as SVGElement, ['opacity', 'transform'])
      ;(node as SVGElement).style.opacity = String(motion.actions)
      // Keep supporting text below the moving wordmark while it gradually fades.
      ;(node as SVGElement).style.transform = reduced ? 'none' : `translateY(${detailsShift / sourceUnit}px)`
    }
  }
  if (phone) {
    rememberBrandBaseline(phone, ['opacity'], true)
    phone.style.opacity = String(motion.phone)
    phone.inert = motion.phone === 0
  }
  const fade = (element: HTMLElement): void => {
    rememberBrandBaseline(element, ['opacity', 'translate'], true)
    element.style.translate = vector && !reduced ? `0px ${collapse + detailsShift}px` : '0px 0px'
    element.style.opacity = String(motion.actions)
    element.inert = motion.actions === 0
  }
  // display:contents HeroLinks needs its rendered children faded individually.
  for (const child of hero.children) if (child !== brand) {
    if (child.localName === 'div' && (child as HTMLElement).style.display === 'contents') {
      for (const item of child.children) fade(item as HTMLElement)
    } else fade(child as HTMLElement)
  }
}
