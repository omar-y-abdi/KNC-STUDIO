import type { Component, Editor } from 'grapesjs'

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

export function scaledZoom(zoom: number, before: number, requested: number): number {
  if (![zoom, before, requested].every((value) => Number.isFinite(value) && value > 0)) return zoom
  return Math.max(0.1, Math.min(4, Number(((zoom * requested) / before).toFixed(6))))
}

/** CSS zoom participates in layout, unlike transform:scale. Keep intrinsic child
 * geometry and let the browser scale text, portraits, padding and subsequent flow. */
export function connectHierarchicalResize(editor: Editor, disabled: () => boolean): () => void {
  type Styled = NonNullable<ReturnType<Editor['getSelectedToStyle']>>
  let snapshot:
    | {
        component: Component
        model: Styled
        style: ReturnType<Component['getStyle']>
        width: number
        height: number
        zoom: number
      }
    | undefined
  let updating = false
  let frame = 0
  const capture = (): void => {
    if (disabled() || updating) return
    const component = editor.getSelected()
    const model = editor.getSelectedToStyle()
    const element = component?.getEl()
    if (!component || !model || !element || !barberScalePeers(component).length) {
      snapshot = undefined
      return
    }
    const rect = element.getBoundingClientRect()
    const rawZoom = element.ownerDocument.defaultView?.getComputedStyle(element).zoom ?? '1'
    const zoom = (parseFloat(rawZoom) || 1) / (rawZoom.endsWith('%') ? 100 : 1)
    snapshot = {
      component,
      model,
      style: { ...model.getStyle() },
      width: rect.width,
      height: rect.height,
      zoom,
    }
  }
  const remember = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(capture)
  }
  const change = (model: unknown, property: string): void => {
    const before = snapshot
    if (updating || disabled() || !before || model !== before.model) return
    if (property !== 'width' && property !== 'height') {
      remember()
      return
    }
    const value = String(before.model.getStyle()[property] ?? '')
      .replace(/!important$/, '')
      .trim()
    // Only dimension controls in pixels participate; arbitrary CSS units keep their CSS meaning.
    const raw = value.endsWith('px') ? value.slice(0, -2).trim() : value
    const requested = /^[0-9.]+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isFinite(requested) || requested <= 0) {
      remember()
      return
    }
    const zoom = scaledZoom(before.zoom, before[property], requested)
    if (!Number.isFinite(zoom) || before[property] <= 0) return
    updating = true
    try {
      const style = { ...before.model.getStyle() }
      // The new size is represented by layout zoom, not a clipping height.
      for (const axis of ['width', 'height'] as const) {
        if (before.style[axis] === undefined) Reflect.deleteProperty(style, axis)
        else style[axis] = before.style[axis]
      }
      before.model.setStyle(style)
      for (const peer of barberScalePeers(before.component)) peer.addStyle({ zoom: String(zoom) })
    } finally {
      updating = false
    }
    editor.refresh()
    remember()
  }
  editor.on('component:selected component:resize:start', capture)
  editor.on('styleable:change', change)
  editor.on('undo redo canvas:frame:load', remember)
  return () => {
    cancelAnimationFrame(frame)
    editor.off('component:selected component:resize:start', capture)
    editor.off('styleable:change', change)
    editor.off('undo redo canvas:frame:load', remember)
  }
}
