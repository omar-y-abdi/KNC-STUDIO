import type { Component } from 'grapesjs'

const controls = new Set(['input', 'select', 'textarea', 'option', 'form', 'label', 'fieldset'])
const containers = new Set(['div', 'main', 'section', 'article', 'aside', 'header', 'footer', 'nav'])
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
      (current === component && attrs['data-knc-required'] === 'true')
    )
      return true
    current = current.parent()
  }
  return false
}

export function configureComponent(component: Component): void {
  const tag = String(component.get('tagName') ?? '').toLowerCase()
  const attrs = component.getAttributes()
  const protectedComponent = isProtected(component)
  const retainedChildren =
    component.find('[data-knc-slot],[data-knc-required="true"]').length > 0 ||
    [...protectedIds].some((id) => component.find(`#${id}`).length > 0)
  component.set({
    removable: !protectedComponent && !retainedChildren && !attrs['data-knc-native'],
    copyable: !protectedComponent && !retainedChildren && !attrs['data-knc-native'],
    draggable: !protectedComponent && !attrs['data-knc-native'],
    droppable:
      !attrs['data-knc-native'] &&
      (!protectedComponent || (Boolean(attrs['data-knc-surface']) && containers.has(tag))),
    resizable: !protectedComponent && !controls.has(tag) && !svgLeaf.has(tag),
  })
}
