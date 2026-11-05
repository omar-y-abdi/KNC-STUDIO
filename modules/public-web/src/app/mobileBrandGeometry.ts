/** Geometry for the decorative mobile brand. Scroll painting only reads this cache. */
export interface BrandBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrandWordMetrics {
  x: number
  y: number
  size: number
  weight: number
  spacing: number
  advance: number
}

export interface MobileBrandGeometry {
  hero: HTMLElement
  brand: HTMLElement
  mark: HTMLElement
  source: SVGSVGElement | HTMLImageElement
  target: SVGSVGElement | HTMLImageElement
  phone: HTMLElement | null
  sourceLeft: number
  sourceTop: number
  sourceUnit: number
  targetLeft: number
  targetTop: number
  targetUnit: number
  sourceWidth: number
  sourceHeight: number
  targetWidth: number
  targetHeight: number
  vector: {
    word: SVGTextElement
    finalWord: SVGTextElement
    sourceWord: BrandWordMetrics
    targetWord: BrandWordMetrics
    sourceWordBounds: BrandBounds
    targetWordBounds: BrandBounds
    monogram: SVGGraphicsElement[]
    emblem: SVGGraphicsElement[]
    monogramBounds: BrandBounds
    emblemBounds: BrandBounds
    emblemCharOrigins: { x: number; y: number }[]
  } | null
}

const geometries = new WeakMap<HTMLElement, MobileBrandGeometry>()

export function getMobileBrandGeometry(root: HTMLElement): MobileBrandGeometry | undefined {
  return geometries.get(root)
}

function bounds(nodes: SVGGraphicsElement[]): BrandBounds {
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

function wordMetrics(node: SVGTextElement): BrandWordMetrics {
  const value = (name: string): number => Number(node.getAttribute(name))
  return {
    x: value('x'),
    y: value('y'),
    size: value('font-size'),
    weight: value('font-weight'),
    spacing: value('letter-spacing'),
    advance: node.getComputedTextLength(),
  }
}

export function refreshMobileBrandGeometry(root: HTMLElement, fontsChanged = false): void {
  const hero = root.querySelector<HTMLElement>('[data-knc-fold="hero"]')
  const brand = hero?.querySelector<HTMLElement>('h1')
  const mark = root.querySelector<HTMLElement>('[data-knc-fold="mark"]')
  const source = brand?.querySelector<SVGSVGElement | HTMLImageElement>('svg,img')
  const target = mark?.querySelector<SVGSVGElement | HTMLImageElement>('svg,img')
  const win = root.ownerDocument?.defaultView
  if (!hero || !brand || !mark || !source || !target || !win) {
    geometries.delete(root)
    return
  }
  const sourceStyle = win.getComputedStyle(source)
  const targetStyle = win.getComputedStyle(target)
  const sourceWidth = Number.parseFloat(sourceStyle.width) || source.clientWidth
  const sourceHeight = Number.parseFloat(sourceStyle.height) || source.clientHeight
  const targetWidth = Number.parseFloat(targetStyle.width) || target.clientWidth
  const targetHeight = Number.parseFloat(targetStyle.height) || target.clientHeight
  if (!(sourceWidth > 0 && sourceHeight > 0 && targetWidth > 0 && targetHeight > 0)) {
    geometries.delete(root)
    return
  }
  const previous = geometries.get(root)
  let vector = previous?.vector ?? null
  if (fontsChanged || previous?.source !== source || previous?.target !== target) {
    vector = null
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
    if (
      source.getAttribute('viewBox') === '0 0 460 330' &&
      target.getAttribute('viewBox') === '0 0 322 48' &&
      monogram.map((node) => node.textContent).join('') === 'BB&' &&
      word && finalWord && monogram.length && emblem.length
    ) {
      vector = {
        word,
        finalWord,
        sourceWord: wordMetrics(word),
        targetWord: wordMetrics(finalWord),
        sourceWordBounds: bounds([word]),
        targetWordBounds: bounds([finalWord]),
        monogram,
        emblem,
        monogramBounds: bounds(monogram),
        emblemBounds: bounds(emblem),
        emblemCharOrigins: (() => {
          const text = emblem.find((node) => node.localName === 'text') as SVGTextElement | undefined
          return text ? Array.from({ length: text.getNumberOfChars() }, (_, index) => {
            const point = text.getStartPositionOfChar(index)
            return { x: point.x, y: point.y }
          }) : []
        })(),
      }
    }
  }
  geometries.set(root, {
    hero,
    brand,
    mark,
    source,
    target,
    phone: root.querySelector<HTMLElement>('[data-knc-fold="phone"]')
      ?? root.querySelector<HTMLElement>('[data-knc-fold="controls"] a[href^="tel:"]'),
    sourceLeft: brand.offsetLeft + (brand.offsetWidth - sourceWidth) / 2,
    sourceTop: brand.offsetTop,
    sourceUnit: sourceWidth / 460,
    targetLeft: mark.offsetLeft,
    targetTop: mark.offsetTop,
    targetUnit: targetWidth / 322,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    vector,
  })
}

/** Watch actual layout/font changes, never scroll events or animated style mutations. */
export function observeMobileBrandGeometry(root: HTMLElement, repaint: () => void): () => void {
  const win = root.ownerDocument?.defaultView
  if (!win) return () => undefined
  let disposed = false
  let frame = 0
  let fontsChanged = false
  const observed = new Set<Element>()
  const refresh = (): void => {
    frame = 0
    refreshMobileBrandGeometry(root, fontsChanged)
    fontsChanged = false
    const geometry = geometries.get(root)
    // The existing compact-header margin transition can resize the hero without resizing root.
    for (const element of [
      root,
      geometry?.hero,
      geometry?.source,
      geometry?.target,
      root.querySelector('[data-knc-fold="controls"]')?.parentElement,
    ]) {
      if (element && !observed.has(element)) {
        observed.add(element)
        observer.observe(element)
      }
    }
    repaint()
  }
  const schedule = (): void => {
    if (!disposed && !frame) frame = win.requestAnimationFrame(refresh)
  }
  const fontReady = (): void => {
    if (disposed) return
    fontsChanged = true
    schedule()
  }
  const observer = new ResizeObserver(schedule)
  root.addEventListener('load', schedule, true)
  root.ownerDocument.fonts?.addEventListener('loadingdone', fontReady)
  void root.ownerDocument.fonts?.ready.then(fontReady)
  refresh()
  return () => {
    disposed = true
    win.cancelAnimationFrame(frame)
    observer.disconnect()
    root.removeEventListener('load', schedule, true)
    root.ownerDocument.fonts?.removeEventListener('loadingdone', fontReady)
    geometries.delete(root)
  }
}
