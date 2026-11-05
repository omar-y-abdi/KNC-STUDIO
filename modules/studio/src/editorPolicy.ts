import { barberScalePeers } from './hierarchicalResize'
import {
  ANY_BUSINESS_SLOT,
  businessSlots,
  CANCELLATION_SLOT_IDS,
  isSlotElement,
} from '@bladeblend/public-web/business-slots'
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
])
const cancellationSlotIds: readonly string[] = CANCELLATION_SLOT_IDS
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
// follow them (gaplessLoopFloor in modules/public-web/src/about/useBarberMarquee.ts).
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

/** A slot the Worker fills on every request for the page this canvas shows, from the same
 * definitions (modules/public-web/src/site/businessSlots.ts), so the lock and the fill cannot drift apart. On /contact
 * these are the heading, details, hours, name and city, with or without the Contact marker; on
 * /privacy and /terms the business details, the cancellation window and the name, controller and
 * contact spans. Every other page serves the same markup as authored and keeps it editable. This
 * runs for every component on load, so it reads the raw attributes, and only a component naming
 * some slot walks to its canvas root; getAttributes also resolves styles and ids. */
function isBusinessSlot(component: Component): boolean {
  const attrs = component.get('attributes') ?? {}
  if (!isSlotElement(ANY_BUSINESS_SLOT, attrs)) return false
  const slots = businessSlots(canvasPath(component))
  return slots !== undefined && isSlotElement(slots, attrs)
}

/** Filled by the Worker: the component or one of its ancestors is a slot of its page. */
export function isServerOwned(component: Component): boolean {
  let current: Component | undefined = component
  while (current) {
    if (isBusinessSlot(current)) return true
    current = current.parent()
  }
  return false
}

/** Where the owner sets what the Worker puts into this server-owned component. */
export function slotSource(component: Component): string {
  let current: Component | undefined = component
  while (current) {
    const id = String(current.get('attributes')?.['id'] ?? '')
    if (cancellationSlotIds.includes(id) && isBusinessSlot(current))
      return 'Avbokningsfrist under Inställningar'
    current = current.parent()
  }
  return canvasPath(component) === '/contact'
    ? 'Företag & SEO och bokningsschemat'
    : 'Företag & SEO'
}

/** Styling of its own, which the Worker drops when it regenerates the slot holding the component:
 * an id, a class, or a rule on its id, where GrapesJS also keeps an inline style. */
function ownStyling(component: Component): boolean {
  return (
    component.get('attributes')?.['id'] !== undefined ||
    component.getClasses().length > 0 ||
    component.em.Css.getComponentRules(component).length > 0
  )
}

/** The Worker fills a slot with plain markup, so styling stored inside it reaches only Studio. Such
 * content is rebuilt without ids, classes or styles; removing the old components drops their id
 * rules, as any removal does. Studio configures a canvas before its checkpoint, so this is no owner
 * edit and leaves no undo step. */
function plainSlotContent(slot: Component): void {
  if (!slot.findFirstType(ownStyling)) return
  const attributes = (_: Component, attrs: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(attrs).filter(([name]) => !['id', 'class', 'style'].includes(name)),
    )
  const html = slot
    .components()
    .map((child: Component) => child.toHTML({ attributes }))
    .join('')
  slot.em.UndoManager.skip(() => slot.components(html))
}

export function isProtected(component: Component): boolean {
  let current: Component | undefined = component
  while (current) {
    const attrs = current.getAttributes()
    if (
      protectedIds.has(String(attrs['id'] ?? '')) ||
      attrs['data-knc-slot'] ||
      isBusinessSlot(current) ||
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
  if (isBusinessSlot(component)) plainSlotContent(component)
  const tag = String(component.get('tagName') ?? '').toLowerCase()
  const attrs = component.getAttributes()
  const compositionBoundary =
    Boolean(attrs['data-editor-about-slot']) ||
    Boolean(component.parent()?.getAttributes()['data-editor-about-slot'])
  const protectedComponent = isProtected(component) || compositionBoundary
  const readOnly = isReadOnlyPreview(component)
  // Every server-owned component is protected, so the others skip this second ancestor walk.
  const serverOwned = protectedComponent && isServerOwned(component)
  // The Worker regenerates everything inside a slot, so nothing there takes styling of its own.
  const parent = component.parent()
  const slotContent = serverOwned && parent !== undefined && isServerOwned(parent)
  const role = runtimeOwnedRole(attrs, component.parent()?.getAttributes())
  // The model search also works for text nodes and components not yet mounted in the canvas.
  const retainedChildren = component.findFirstType((child) => {
    const attributes = child.getAttributes()
    return Boolean(
      attributes['data-knc-slot'] ||
      attributes['data-knc-required'] === 'true' ||
      protectedIds.has(String(attributes['id'] ?? '')) ||
      isBusinessSlot(child),
    )
  })
  // A paragraph holding a slot would drop rich-text edits on its span, which the Worker overwrites.
  const holdsSlot = retainedChildren && isBusinessSlot(retainedChildren)
  component.set(
    {
      // An unstylable array overrides stylable:false in GrapesJS; never set it on previews or
      // slot content.
      ...(readOnly ? { editable: false, stylable: false } : {}),
      ...(serverOwned || holdsSlot ? { editable: false } : {}),
      ...(slotContent ? { stylable: false } : {}),
      ...(!readOnly && !slotContent && role ? { unstylable: [...role.denied] } : {}),
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
