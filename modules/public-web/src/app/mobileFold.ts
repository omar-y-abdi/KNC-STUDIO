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
} {
  const limit = Math.max(0, viewportHeight - 112)
  const scrolled = Math.max(0, scrollTop)
  const collapse = privacyOpen ? (scrolled >= limit ? limit : 0) : Math.min(limit, scrolled)
  return { collapse, compact: collapse > 0 }
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

/** Content choreography over the fold progress. The panel height itself is the scroll position. */
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
    for (const property of ['opacity', 'transform', 'overflow']) {
      const original = baseline.styles[property]
      if (!original) continue
      if (original[0]) style.setProperty(property, original[0], original[1])
      else style.removeProperty(property)
    }
    if (baseline.inert !== undefined) element.toggleAttribute('inert', baseline.inert)
    element.removeAttribute(brandBaselineAttribute)
  }
}

const opacityBaselines = new WeakMap<
  HTMLElement | SVGElement,
  { value: string; priority: string; computed: number }
>()

function opacityBaseline(element: HTMLElement | SVGElement) {
  let baseline = opacityBaselines.get(element)
  if (!baseline) {
    baseline = {
      value: element.style.getPropertyValue('opacity'),
      priority: element.style.getPropertyPriority('opacity'),
      computed: Number(element.ownerDocument.defaultView?.getComputedStyle(element).opacity ?? 1),
    }
    opacityBaselines.set(element, baseline)
  }
  return baseline
}

/** Multiply the author's opacity during motion, restoring the original cascade at rest. */
function paintOpacity(element: HTMLElement | SVGElement, factor: number): void {
  const baseline = opacityBaseline(element)
  if (factor === 1) {
    if (baseline.value) element.style.setProperty('opacity', baseline.value, baseline.priority)
    else element.style.removeProperty('opacity')
  } else element.style.setProperty('opacity', String(baseline.computed * factor), 'important')
}

interface BrandLayer {
  vector: NonNullable<MobileBrandGeometry['vector']>
  svg: SVGSVGElement
  sourceWord: SVGTextElement
  targetWord: SVGTextElement
  paths: readonly [SVGPathElement, SVGPathElement, SVGPathElement]
}
const brandLayers = new WeakMap<HTMLElement, BrandLayer>()

/** The artwork lives in one private layer anchored to the sticky panel, so both word weights
 * share one frame while the panel shrinks with the scroll position. */
function brandLayer(root: HTMLElement, geometry: MobileBrandGeometry): BrandLayer | undefined {
  const vector = geometry.vector
  if (!vector) return
  const parent = root.querySelector('[data-knc-fold="panel"]')
  if (!parent) return
  const cached = brandLayers.get(geometry.brand)
  if (cached?.svg.parentElement === parent && cached.vector === vector) return cached
  for (const previous of root.querySelectorAll('[data-knc-brand-runtime]')) previous.remove()
  const svg = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('data-knc-brand-runtime', '')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'currentColor')
  svg.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100dvh;overflow:visible;pointer-events:none'
  const cloneWord = (original: SVGTextElement): SVGTextElement => {
    const copy = original.cloneNode(true) as SVGTextElement
    for (const attribute of [...copy.attributes]) {
      if (attribute.name === 'id' || attribute.name.startsWith('data-knc-'))
        copy.removeAttribute(attribute.name)
    }
    copy.style.removeProperty('opacity')
    copy.style.removeProperty('transform')
    return copy
  }
  const sourceWord = cloneWord(vector.word),
    targetWord = cloneWord(vector.finalWord)
  const path = (): SVGPathElement =>
    root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path')
  const paths = [path(), path(), path()] as const
  for (const index of [0, 2, 1] as const) svg.appendChild(paths[index])
  svg.appendChild(sourceWord)
  svg.appendChild(targetWord)
  parent.appendChild(svg)
  const layer = { vector, svg, sourceWord, targetWord, paths }
  brandLayers.set(geometry.brand, layer)
  return layer
}

/** Compatible contours are generated from the exact shipped fonts. The same three paths
 * change shape and position; no alternate BNB text is substituted during the movement. */
function paintMonogram(
  geometry: MobileBrandGeometry,
  sourceTop: number,
  paths: readonly [SVGPathElement, SVGPathElement, SVGPathElement],
  travel: number,
  form: number,
): void {
  const { targetLeft, targetTop, targetUnit, sourceLeft, sourceUnit, vector } = geometry
  if (!vector || vector.emblemCharOrigins.length !== 3) return
  const sourceGlyphs = [
    { x: 174 - (0.672 * 150) / 2, y: 150, size: 150 },
    { x: 230 - (0.863 * 122) / 2, y: 156, size: 122 },
    { x: 286 - (0.672 * 150) / 2, y: 150, size: 150 },
  ] as const
  const startCenter = vector.sourceWordBounds.x + vector.sourceWordBounds.width / 2
  const endCenter = vector.targetWordBounds.x + vector.targetWordBounds.width / 2
  const startSize = vector.sourceWord.size * sourceUnit
  const endSize = vector.targetWord.size * targetUnit
  const frameSize = startSize + (endSize - startSize) * travel
  const startX = sourceLeft + startCenter * sourceUnit
  const startY = sourceTop + vector.sourceWord.y * sourceUnit
  const frameX = startX + (targetLeft + endCenter * targetUnit - startX) * travel
  const frameY = startY + (targetTop + vector.targetWord.y * targetUnit - startY) * travel
  for (const index of [0, 1, 2] as const) {
    const contours = monogramPaths[index]
    const start = sourceGlyphs[index]
    const end = vector.emblemCharOrigins[index]
    if (!end) return
    const d = contours
      .map((contour) => {
        const points = []
        for (const [point, [sourceX, sourceY, targetX, targetY]] of contour.entries()) {
          // The internal stacked-to-horizontal arrangement completes before the whole
          // brand reaches the header. Both phases share one moving wordmark baseline.
          const fromX = (start.x + sourceX * start.size - startCenter) / vector.sourceWord.size
          const fromY =
            (start.y + sourceY * start.size - vector.sourceWord.y) / vector.sourceWord.size
          const toX = (end.x + targetX * 21 - endCenter) / vector.targetWord.size
          const toY = (end.y + targetY * 21 - vector.targetWord.y) / vector.targetWord.size
          const x = frameX + (fromX + (toX - fromX) * form) * frameSize
          const y = frameY + (fromY + (toY - fromY) * form) * frameSize
          points.push(`${point === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
        }
        return points.join('') + 'Z'
      })
      .join('')
    paths[index].setAttribute('d', d)
  }
}

/** Scroll frames use cached glyph geometry and write path coordinates, transforms and opacity
 * only. The hero is centered in the shrinking panel, so the brand's resting place moves with
 * every fold frame; that one vertical offset is read from layout here instead of the cache. */
export function paintMobileBrand(
  root: HTMLElement,
  collapse: number,
  viewportHeight: number,
  reduced = false,
): void {
  const geometry = getMobileBrandGeometry(root)
  if (!geometry) return
  const {
    hero,
    brand,
    mark,
    source,
    target,
    sourceLeft,
    sourceUnit,
    targetLeft,
    targetTop,
    targetUnit,
    vector,
    phone,
  } = geometry
  const motion = mobileBrandMotion(collapse, viewportHeight, reduced)
  const sourceTop = brand.offsetTop
  let detailsShift = 0
  const mix = (a: number, b: number): number => a + (b - a) * motion.travel
  rememberBrandBaseline(brand, ['opacity'])
  rememberBrandBaseline(mark, ['opacity'])
  paintOpacity(brand, vector ? 1 : motion.brand)
  // The wrapper's initial zero is motion state from MobileSite, not authored opacity.
  // Glyph/SVG presentation remains author-owned; never cache this wrapper as its baseline.
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
    const baseline = mix(
      sourceTop + sourceWord.y * sourceUnit,
      targetTop + targetWord.y * targetUnit,
    )
    detailsShift = baseline - (sourceTop + sourceWord.y * sourceUnit)
    const width = mix(sourceWordBounds.width * sourceUnit, targetWordBounds.width * targetUnit)
    const size = mix(sourceWord.size * sourceUnit, targetWord.size * targetUnit)
    const layer = brandLayer(root, geometry)
    rememberBrandBaseline(word, ['opacity'])
    rememberBrandBaseline(finalWord, ['opacity'])
    const atRest = collapse === 0
    paintOpacity(word, atRest ? 1 : reduced ? motion.brand : 0)
    paintOpacity(finalWord, reduced ? motion.banner : 0)
    if (layer) {
      layer.svg.style.display = reduced || atRest ? 'none' : ''
      const originalOpacity =
        opacityBaseline(hero).computed *
        opacityBaseline(brand).computed *
        opacityBaseline(source).computed
      const compactOpacity = opacityBaseline(target).computed
      layer.svg.style.opacity = String(mix(originalOpacity, compactOpacity))
      for (const [node, metrics, box] of [
        [layer.sourceWord, sourceWord, sourceWordBounds],
        [layer.targetWord, targetWord, targetWordBounds],
      ] as const) {
        const sx = width / box.width,
          sy = size / metrics.size
        const x = center - (box.x + box.width / 2) * sx
        const y = baseline - metrics.y * sy
        node.style.transform = `matrix(${sx},0,0,${sy},${x},${y})`
      }
      layer.sourceWord.style.opacity = String(opacityBaseline(word).computed * motion.brand)
      layer.targetWord.style.opacity = String(opacityBaseline(finalWord).computed * motion.banner)
      const targetEmblem = vector.emblem.find((node) => node.localName === 'text')
      const targetOpacity = targetEmblem ? opacityBaseline(targetEmblem).computed : 1
      for (const index of [0, 1, 2] as const) {
        const original = vector.monogram[[0, 2, 1][index] ?? index]
        const originalOpacity = original ? opacityBaseline(original).computed : 1
        layer.paths[index].style.opacity = String(
          originalOpacity + (targetOpacity - originalOpacity) * motion.form,
        )
      }
      if (!reduced) paintMonogram(geometry, sourceTop, layer.paths, motion.travel, motion.form)
    }
    for (const node of vector.monogram) {
      rememberBrandBaseline(node, ['opacity'])
      paintOpacity(node, atRest ? 1 : reduced ? motion.brand : 0)
    }
    for (const node of vector.emblem) {
      rememberBrandBaseline(node, ['opacity'])
      paintOpacity(node, node.localName === 'line' ? motion.rules : reduced ? motion.banner : 0)
    }
    for (const node of source.children) {
      if (
        node === word ||
        vector.monogram.includes(node as SVGGraphicsElement) ||
        node.hasAttribute('data-knc-brand-runtime')
      )
        continue
      rememberBrandBaseline(node as SVGElement, ['opacity', 'transform'])
      paintOpacity(node as SVGElement, motion.actions)
      // Keep supporting text below the moving wordmark while it gradually fades.
      ;(node as SVGElement).style.transform = reduced
        ? 'none'
        : `translateY(${detailsShift / sourceUnit}px)`
    }
  }
  if (phone) {
    rememberBrandBaseline(phone, ['opacity'], true)
    paintOpacity(phone, motion.phone)
    phone.inert = motion.phone === 0
  }
  const fade = (element: HTMLElement): void => {
    rememberBrandBaseline(element, ['opacity'], true)
    paintOpacity(element, motion.actions)
    element.inert = motion.actions === 0
  }
  // display:contents HeroLinks needs its rendered children faded individually.
  for (const child of hero.children)
    if (child !== brand) {
      if (child.localName === 'div' && (child as HTMLElement).style.display === 'contents') {
        for (const item of child.children) fade(item as HTMLElement)
      } else fade(child as HTMLElement)
    }
}
