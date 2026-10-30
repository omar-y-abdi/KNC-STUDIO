import type { Component, Editor } from 'grapesjs'
import { generate, parse, walk } from 'css-tree'

/** Only the repeated barber presentation participates; never names, data or callbacks. */
export function barberScalePeers(component: Component): Component[] {
  let card = component
  let group: Component | undefined = component
  while (group) {
    const attrs = group.getAttributes()
    if (attrs['data-knc-fold'] === 'barber-marquee' && attrs['data-knc-source']) break
    card = group
    group = group.parent()
  }
  if (!group) return []
  if (component === group) return [group]
  const cards = group
    .components()
    .filter((child: Component) => child.getAttributes()['data-knc-source'])
  if (component === card) return cards
  const photo = (item: Component): Component | undefined => {
    const first = item.components().at(0)
    return first?.getAttributes()['data-knc-slot'] ? first.components().at(0) : first
  }
  if (component !== photo(card)) return []
  return cards.map(photo).filter((item): item is Component => Boolean(item))
}

const isStrip = (component: Component): boolean => {
  const attrs = component.getAttributes()
  return attrs['data-knc-fold'] === 'barber-marquee' && Boolean(attrs['data-knc-source'])
}

/** The cards when the selection is the strip or one of its cards; never for their photos. */
function barberStripCards(component: Component): Component[] {
  const strip = isStrip(component) ? component : component.parent()
  if (!strip || !isStrip(strip)) return []
  if (strip !== component && !component.getAttributes()['data-knc-source']) return []
  return strip
    .components()
    .filter((child: Component) => Boolean(child.getAttributes()['data-knc-source']))
}

/** The runtime mobile card width (AboutSection), scaled. */
export function marqueeCardWidth(scale: number): string {
  return `calc((100vw - 24px) * ${scale})`
}

/** The smallest card scale at which Embla keeps looping `cards` mobile slides at every mobile
 * width up to 768 px. Embla drops `loop` (and AutoScroll halts at the end) unless the other slides
 * cover the view (SlideLooper.canLoop): an edge slide measures its card plus one 24 px margin, an
 * inner slide its card plus both. A single card never animates. */
export function minLoopScale(cards: number): number {
  if (cards < 2) return 0.1
  const view = 768
  const width = cards === 2 ? view - 24 : (view + 48) / (cards - 1) - 48
  return Math.max(0.1, Math.ceil((width / (view - 24)) * 100) / 100)
}

/** Embla positions mobile slides from their layout width; zoom would only scale their paint. */
export function marqueeCardStyle(
  style: ReturnType<Component['getStyle']>,
  scale: number,
): ReturnType<Component['getStyle']> {
  const next = { ...style, width: marqueeCardWidth(scale), 'flex-basis': marqueeCardWidth(scale) }
  Reflect.deleteProperty(next, 'zoom')
  return next
}

/** Keep the existing grid track and the card's box model while zoom scales its contents. */
export function desktopMarqueeCardStyle(
  style: ReturnType<Component['getStyle']>,
  scale: number,
  geometry: {
    width: string
    zoom: number
    horizontalInset: number
    horizontalMargin: number
    stretch: boolean
  },
): ReturnType<Component['getStyle']> {
  const factor = scale / geometry.zoom
  const sourceWidth = geometry.width.replace(/\s*!important\s*$/i, '').trim()
  const important = /!important\s*$/i.test(geometry.width) ? '!important' : ''
  let width: string | undefined
  if (
    sourceWidth &&
    !['auto', 'initial', 'unset', 'revert', 'revert-layer'].includes(sourceWidth.toLowerCase())
  ) {
    const value = parse(sourceWidth, { context: 'value' })
    let changed = false
    walk(value, {
      visit: 'Percentage',
      enter(node) {
        node.value = String(Number((Number(node.value) * factor).toFixed(6)))
        changed = true
      },
    })
    // Absolute lengths already scale with zoom. Percentage terms resolve against the track
    // before zoom, so adjust only those, including on a second resize of our generated calc().
    width = changed ? `${generate(value)}${important}` : geometry.width
  } else if (geometry.stretch) {
    const percent = `${Number((factor * 100).toFixed(6))}%`
    const inset = geometry.horizontalInset + geometry.horizontalMargin
    width = `${inset ? `calc(${percent} - ${Number(inset.toFixed(6))}px)` : percent}${important}`
  }
  return {
    ...style,
    ...(width === undefined ? {} : { width }),
    zoom: String(scale),
  }
}

export function scaledZoom(zoom: number, before: number, requested: number): number {
  if (![zoom, before, requested].every((value) => Number.isFinite(value) && value > 0)) return zoom
  return Math.max(0.1, Math.min(4, Number(((zoom * requested) / before).toFixed(6))))
}

/** CSS zoom participates in layout, unlike transform:scale. Keep intrinsic child
 * geometry and let the browser scale text, portraits, padding and subsequent flow.
 * The mobile strip is the exception: its cards are Embla slides and get a layout width. */
export function connectHierarchicalResize(editor: Editor, disabled: () => boolean): () => void {
  let snapshot:
    | {
        component: Component
        style: ReturnType<Component['getStyle']>
        width: number
        height: number
        zoom: number
        cardScale: number
      }
    | undefined
  let updating = false
  let frame = 0
  let viewport: Window | null = null
  const capture = (): void => {
    if (disabled() || updating) return
    const component = editor.getSelected()
    const element = component?.getEl()
    if (!component || !element || !barberScalePeers(component).length) {
      snapshot = undefined
      return
    }
    const rect = element.getBoundingClientRect()
    const view = element.ownerDocument.defaultView
    const cards = barberStripCards(component)
    const card = cards.includes(component) ? component : cards[0]
    // Desktop group edits scale its cards, so repeated edits start from their current zoom.
    const zoomElement = editor.getDevice() !== 'Mobile' && card ? card.getEl() : element
    const rawZoom = view?.getComputedStyle(zoomElement ?? element).zoom ?? '1'
    const zoom = (parseFloat(rawZoom) || 1) / (rawZoom.endsWith('%') ? 100 : 1)
    const cardWidth = card?.getEl()?.getBoundingClientRect().width ?? 0
    snapshot = {
      component,
      // Component-first styling reads the existing device rule without creating one.
      style: { ...component.getStyle() },
      width: rect.width,
      height: rect.height,
      zoom,
      cardScale: view && cardWidth > 0 ? cardWidth / (view.innerWidth - 24) : 1,
    }
  }
  const remember = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(capture)
  }
  const watchViewport = (): void => {
    viewport?.removeEventListener('resize', remember)
    viewport = editor.Canvas.getFrameEl()?.contentWindow ?? null
    viewport?.addEventListener('resize', remember)
    remember()
  }
  const change = (model: unknown, property: string): void => {
    const before = snapshot
    if (updating || disabled() || !before || editor.getSelected() !== before.component) return
    // An actual style change already has its target; do not retain a rule from a former device.
    const target = editor.getSelectedToStyle()
    if (!target || model !== target) return
    if (property !== 'width' && property !== 'height') {
      remember()
      return
    }
    const value = String(target.getStyle()[property] ?? '')
      .replace(/!important$/, '')
      .trim()
    // Only dimension controls in pixels participate; arbitrary CSS units keep their CSS meaning.
    const raw = value.endsWith('px') ? value.slice(0, -2).trim() : value
    const requested = /^[0-9.]+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isFinite(requested) || requested <= 0) {
      remember()
      return
    }
    const cards = barberStripCards(before.component)
    const mobile = editor.getDevice() === 'Mobile'
    const requestedScale = scaledZoom(
      cards.length && mobile ? before.cardScale : before.zoom,
      before[property],
      requested,
    )
    // A short roster keeps its cards wide enough to loop; a frozen strip is never a valid size.
    const scale =
      cards.length && mobile ? Math.max(minLoopScale(cards.length), requestedScale) : requestedScale
    if (!Number.isFinite(scale) || before[property] <= 0) return
    updating = true
    try {
      const style = { ...target.getStyle() }
      // The new size is represented by layout zoom or card width, not a clipping height.
      for (const axis of ['width', 'height'] as const) {
        if (before.style[axis] === undefined) Reflect.deleteProperty(style, axis)
        else style[axis] = before.style[axis]
      }
      target.setStyle(style)
      if (cards.length)
        for (const card of cards) {
          const currentStyle = card.getStyle()
          if (mobile) {
            card.setStyle(marqueeCardStyle(currentStyle, scale))
            continue
          }
          const element = card.getEl()
          const computed = element?.ownerDocument.defaultView?.getComputedStyle(element)
          const sourceWidth = currentStyle.width ?? card.getStyle({ mediaText: '' }).width
          const rawZoom = computed?.zoom ?? '1'
          const alignment =
            computed?.justifySelf === 'auto'
              ? element?.parentElement &&
                element.ownerDocument.defaultView?.getComputedStyle(element.parentElement)
                  .justifyItems
              : computed?.justifySelf
          const horizontalInset =
            computed && computed.boxSizing !== 'border-box'
              ? [
                  computed.paddingLeft,
                  computed.paddingRight,
                  computed.borderLeftWidth,
                  computed.borderRightWidth,
                ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
              : 0
          card.setStyle(
            desktopMarqueeCardStyle(currentStyle, scale, {
              width: String(
                (Array.isArray(sourceWidth) ? sourceWidth.at(-1) : sourceWidth) ?? 'auto',
              ),
              zoom: (parseFloat(rawZoom) || 1) / (rawZoom.endsWith('%') ? 100 : 1),
              horizontalInset,
              horizontalMargin:
                (parseFloat(computed?.marginLeft ?? '') || 0) +
                (parseFloat(computed?.marginRight ?? '') || 0),
              stretch: !alignment || alignment === 'normal' || alignment === 'stretch',
            }),
          )
        }
      else
        for (const peer of barberScalePeers(before.component))
          peer.addStyle({ zoom: String(scale) })
    } finally {
      updating = false
    }
    editor.refresh()
    remember()
  }
  editor.on('component:selected component:resize:start', capture)
  editor.on('styleable:change', change)
  editor.on('undo redo canvas:frame:load', remember)
  editor.on('load canvas:frame:load', watchViewport)
  watchViewport()
  return () => {
    cancelAnimationFrame(frame)
    editor.off('component:selected component:resize:start', capture)
    editor.off('styleable:change', change)
    editor.off('undo redo canvas:frame:load', remember)
    editor.off('load canvas:frame:load', watchViewport)
    viewport?.removeEventListener('resize', remember)
  }
}
