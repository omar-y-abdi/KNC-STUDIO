import type { Component } from 'grapesjs'

const controls = new Set(['input', 'select', 'textarea', 'option', 'form', 'label', 'fieldset'])
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
  const id = String(component.getAttributes()['id'] ?? '')
  return protectedIds.has(id)
}

export function configureComponent(component: Component): void {
  const tag = String(component.get('tagName') ?? '').toLowerCase()
  const protectedComponent = isProtected(component)
  component.set({
    removable: !protectedComponent,
    copyable: !protectedComponent,
    draggable: !protectedComponent,
    droppable: !protectedComponent,
    resizable: !protectedComponent && !controls.has(tag) && !svgLeaf.has(tag),
  })
}
