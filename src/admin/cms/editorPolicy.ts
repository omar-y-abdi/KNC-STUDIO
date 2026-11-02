import { barberScalePeers } from './hierarchicalResize'
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
const contactSlotIds = new Set(['contact-title', 'contact-details', 'contact-hours'])
const contactSlotAttributes = ['data-business-name', 'data-business-city']
// The page each canvas shows, keyed by its wrapper. It stays outside the model,
// so exported HTML and project data never carry it.
const canvasPaths = new WeakMap<Component, string>()

// The marquee code moves these nodes or measures them; the individual transform
// properties are transforms too. The gallery loop math also owns its tile sizes.
// `all` resets every one of them, and Chromium keeps it as one CSSOM entry instead of longhands.
const marqueeMotion = [
  'all',
  'transform',
  'translate',
  'rotate',
  'scale',
  'zoom',
  'overflow',
  'overflow-x',
  'overflow-y',
  'display',
]
const gallerySize = [
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'flex-basis',
  'inline-size',
  'block-size',
  'min-inline-size',
  'min-block-size',
  'max-inline-size',
  'max-block-size',
]

export interface RuntimeOwnedRole {
  readonly denied: readonly string[]
  readonly resizable: boolean
}

// The strip loops at its gapless floor only while its cards sit in one row and its width does not
// follow them (gaplessLoopFloor in src/about/useBarberMarquee.ts).
const stripGeometry = [
  // max-content, fit-content and their kin size the strip by its cards.
  'width',
  'inline-size',
  'min-width',
  'min-inline-size',
  'max-width',
  'max-inline-size',
  // A float, or an absolute or fixed box, shrinks to fit its cards.
  'float',
  'position',
  // A column, a wrapped row or a vertical writing mode stacks cards that then overlap horizontally.
  'flex-direction',
  'flex-wrap',
  'flex-flow',
  'writing-mode',
]
// A card must neither overlap its neighbours nor end on a negative margin, and a min-width
// transition would hold back the inline floor while Embla measures it.
const cardGeometry = [
  'margin',
  'margin-left',
  'margin-right',
  'margin-inline',
  'margin-inline-start',
  'margin-inline-end',
  'position',
  'transition',
  'transition-property',
]

const stripRole: RuntimeOwnedRole = {
  denied: [...marqueeMotion, ...stripGeometry],
  resizable: true,
}
const cardRole: RuntimeOwnedRole = { denied: [...marqueeMotion, ...cardGeometry], resizable: true }
const galleryRole: RuntimeOwnedRole = {
  denied: [...marqueeMotion, ...gallerySize],
  resizable: false,
}
const runtimeOwnedFolds = new Map<string, RuntimeOwnedRole>([
  ['barber-marquee', stripRole],
  ['gallery-row', galleryRole],
  ['gallery-track', galleryRole],
  ['gallery-tile', galleryRole],
])

type Attributes = Readonly<Record<string, unknown>>

/** Runtime-owned properties of a marquee node; a barber card is a source child of the strip. */
export function runtimeOwnedRole(attrs: Attributes, parent?: Attributes): RuntimeOwnedRole | null {
  const role = runtimeOwnedFolds.get(String(attrs['data-knc-fold'] ?? ''))
  if (role) return role
  return parent?.['data-knc-fold'] === 'barber-marquee' && attrs['data-knc-source']
    ? cardRole
    : null
}

/** The first runtime-owned name among a declaration's property and its expanded longhands. */
export function deniedProperty(
  properties: readonly string[],
  role: RuntimeOwnedRole | null,
): string | undefined {
  return role ? properties.find((property) => role.denied.includes(property)) : undefined
}

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

/** Records the page a canvas shows. Studio sets it on every page apply, before configuring. */
export function setCanvasPagePath(wrapper: Component, path: string): void {
  canvasPaths.set(wrapper, path)
}

/** The page of the canvas holding this component, or undefined when no canvas recorded its root. */
function canvasPath(component: Component): string | undefined {
  let root = component
  let parent = root.parent()
  while (parent) {
    root = parent
    parent = root.parent()
  }
  return canvasPaths.get(root)
}

/** A Contact slot the Worker fills on every /contact request. The heading, details and hours ids
 * count only on the /contact canvas. The name and city count only inside the Contact page, because
 * the legal pages carry the same attributes and stay editable. This runs for every component on
 * load, so it reads the raw attributes; getAttributes also resolves styles and ids. */
function isContactSlot(component: Component): boolean {
  const attrs = component.get('attributes') ?? {}
  if (contactSlotIds.has(String(attrs['id'] ?? ''))) return canvasPath(component) === '/contact'
  if (!contactSlotAttributes.some((name) => attrs[name] !== undefined)) return false
  let parent = component.parent()
  while (parent) {
    if (parent.getAttributes()['data-business-contact-page'] === '1') return true
    parent = parent.parent()
  }
  return false
}

/** Filled by the Worker: the component or one of its ancestors is a Contact slot. */
export function isServerOwned(component: Component): boolean {
  let current: Component | undefined = component
  while (current) {
    if (isContactSlot(current)) return true
    current = current.parent()
  }
  return false
}

export function isProtected(component: Component): boolean {
  let current: Component | undefined = component
  while (current) {
    const attrs = current.getAttributes()
    if (
      protectedIds.has(String(attrs['id'] ?? '')) ||
      attrs['data-knc-slot'] ||
      isContactSlot(current) ||
      (current === component && attrs['data-knc-required'] === 'true')
    )
      return true
    current = current.parent()
  }
  return false
}

/** A rendered preview without a native identity cannot be projected back into runtime. */
export function isReadOnlyPreview(component: Component): boolean {
  const attrs = component.getAttributes()
  if (attrs['data-knc-source'] || attrs['data-knc-slot']) return false
  let parent = component.parent()
  while (parent) {
    if (parent.getAttributes()['data-knc-slot']) return true
    parent = parent.parent()
  }
  return false
}

export function configureComponent(component: Component, options: { silent?: boolean } = {}): void {
  const tag = String(component.get('tagName') ?? '').toLowerCase()
  const attrs = component.getAttributes()
  const compositionBoundary =
    Boolean(attrs['data-editor-about-slot']) ||
    Boolean(component.parent()?.getAttributes()['data-editor-about-slot'])
  const protectedComponent = isProtected(component) || compositionBoundary
  const readOnly = isReadOnlyPreview(component)
  // Every server-owned component is protected, so the others skip this second ancestor walk.
  const serverOwned = protectedComponent && isServerOwned(component)
  const role = runtimeOwnedRole(attrs, component.parent()?.getAttributes())
  // The model search also works for text nodes and components not yet mounted in the canvas.
  const retainedChildren = component.findFirstType((child) => {
    const attributes = child.getAttributes()
    return Boolean(
      attributes['data-knc-slot'] ||
      attributes['data-knc-required'] === 'true' ||
      protectedIds.has(String(attributes['id'] ?? '')) ||
      isContactSlot(child),
    )
  })
  // A paragraph holding a slot would drop rich-text edits on its span, which the Worker overwrites.
  const holdsSlot = retainedChildren && isContactSlot(retainedChildren)
  component.set(
    {
      // An unstylable array overrides stylable:false in GrapesJS; never set it on previews.
      ...(readOnly ? { editable: false, stylable: false } : {}),
      ...(serverOwned || holdsSlot ? { editable: false } : {}),
      ...(!readOnly && role ? { unstylable: [...role.denied] } : {}),
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
        role?.resizable !== false &&
        (!protectedComponent ||
          tag === 'svg' ||
          tag === 'img' ||
          barberScalePeers(component).length > 0) &&
        !controls.has(tag) &&
        !svgLeaf.has(tag),
    },
    options,
  )
  if (readOnly || serverOwned) component.setTraits([])
  // The image inspector already owns the accessible alt-text field. Keep one
  // editor for that attribute instead of exposing a second, unsynchronized trait.
  else if (tag === 'img') component.removeTrait('alt')
}
