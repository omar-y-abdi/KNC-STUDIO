import type { Component } from 'grapesjs'

const controls = new Set(['input', 'select', 'textarea', 'option', 'form', 'label', 'fieldset'])
const containers = new Set([
  'div',
  'main',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
])
const svgLeaf = new Set([
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'stop',
])
const protectedIds = new Set([
  'knc-about-runtime',
  'knc-booking-runtime',
  'knc-my-bookings-runtime',
  'legal-business-details-sv',
  'legal-business-details-en',
  'cancellation-policy-sv',
  'cancellation-policy-en',
])

export const styleSectors = [
  {
    id: 'layout',
    name: 'Layout & storlek',
    open: true,
    buildProps: [
      'display',
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'overflow',
      'flex-direction',
      'flex-wrap',
      'justify-content',
      'align-items',
      'gap',
      'row-gap',
      'column-gap',
      'grid-template-columns',
      'grid-template-rows',
      'grid-column',
      'grid-row',
      'order',
    ],
  },
  {
    id: 'typography',
    name: 'Typografi',
    open: true,
    buildProps: [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'text-decoration',
      'text-transform',
      'color',
    ],
  },
  { id: 'spacing', name: 'Avstånd', buildProps: ['margin', 'padding'] },
  {
    id: 'surface',
    name: 'Yta & kanter',
    buildProps: [
      'background-color',
      'background',
      'border',
      'outline',
      'border-radius',
      'box-shadow',
      'text-shadow',
      'opacity',
      'filter',
    ],
  },
  {
    id: 'position',
    name: 'Position & transform',
    buildProps: ['position', 'top', 'right', 'bottom', 'left', 'z-index', 'transform'],
  },
  {
    id: 'svg',
    name: 'SVG',
    buildProps: ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity'],
  },
]

export function isProtected(component: Component): boolean {
  let current: Component | undefined = component
  while (current) {
    const attrs = current.getAttributes()
    if (
      protectedIds.has(String(attrs['id'] ?? '')) ||
      attrs['data-knc-slot'] ||
      (current === component &&
        (attrs['data-knc-required'] === 'true' ||
          ['cms-site-shell', 'cms-site-content'].includes(String(attrs['id'] ?? ''))))
    )
      return true
    current = current.parent()
  }
  return false
}

/** A rendered preview without a native identity cannot be projected back into runtime. */
export function isReadOnlyPreview(component: Component): boolean {
  let chrome: Component | undefined = component
  while (chrome) {
    if (
      ['cms-site-header', 'cms-site-menu', 'cms-site-footer'].includes(
        String(chrome.getAttributes()['id'] ?? ''),
      )
    )
      return true
    chrome = chrome.parent()
  }
  const attrs = component.getAttributes()
  if (attrs['data-knc-source'] || attrs['data-knc-slot']) return false
  let parent = component.parent()
  while (parent) {
    if (parent.getAttributes()['data-knc-slot']) return true
    parent = parent.parent()
  }
  return false
}

export function configureComponent(component: Component): void {
  const tag = String(component.get('tagName') ?? '').toLowerCase()
  const attrs = component.getAttributes()
  const protectedComponent = isProtected(component)
  const readOnly = isReadOnlyPreview(component)
  const pageFrame = ['cms-site-shell', 'cms-site-content'].includes(String(attrs['id'] ?? ''))
  // The model search also works for text nodes and components not yet mounted in the canvas.
  const retainedChildren = component.findFirstType((child) => {
    const attributes = child.getAttributes()
    return Boolean(
      attributes['data-knc-slot'] ||
      attributes['data-knc-required'] === 'true' ||
      protectedIds.has(String(attributes['id'] ?? '')),
    )
  })
  component.set({
    ...(readOnly || pageFrame ? { editable: false, stylable: false } : {}),
    // GrapesJS hides inner SVG nodes by default, including the actual logo lettering.
    ...(!readOnly && component.is('svg-in')
      ? { selectable: true, hoverable: true, layerable: true, highlightable: true }
      : {}),
    removable: !readOnly && !protectedComponent && !retainedChildren && !attrs['data-knc-native'],
    copyable: !readOnly && !protectedComponent && !retainedChildren && !attrs['data-knc-native'],
    draggable: !readOnly && !protectedComponent && !attrs['data-knc-native'],
    droppable:
      attrs['id'] === 'cms-site-content' ||
      (!readOnly &&
        !attrs['data-knc-native'] &&
        (!protectedComponent || (Boolean(attrs['data-knc-surface']) && containers.has(tag)))),
    resizable:
      !readOnly &&
      (!protectedComponent || tag === 'svg' || tag === 'img') &&
      !controls.has(tag) &&
      !svgLeaf.has(tag),
  })
  if (readOnly) component.setTraits([])
  // The image inspector already owns the accessible alt-text field. Keep one
  // editor for that attribute instead of exposing a second, unsynchronized trait.
  else if (tag === 'img') component.removeTrait('alt')
}
