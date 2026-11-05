import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'

/** A page's server-owned slots: the elements the Worker refills on every request from Företag & SEO,
 * the booking schedule and the cancellation window, found by their id or by an attribute. Studio
 * locks exactly these on the same page (modules/studio/src/editorPolicy.ts), so a slot is filled and
 * locked, or neither. */
export interface BusinessSlots {
  readonly ids: readonly string[]
  readonly attributes: readonly string[]
}

/** The markup the Worker puts into every slot of one definition. */
export type SlotContent<S extends BusinessSlots> = Readonly<
  Record<S['ids'][number] | S['attributes'][number], string>
>

export const CONTACT_SLOTS = {
  ids: ['contact-title', 'contact-details', 'contact-hours'],
  attributes: ['data-business-name', 'data-business-city'],
} as const satisfies BusinessSlots

/** The legal slots holding the cancellation window, which the owner sets under Inställningar. */
export const CANCELLATION_SLOT_IDS = ['cancellation-policy-sv', 'cancellation-policy-en'] as const

export const LEGAL_SLOTS = {
  ids: ['legal-business-details-sv', 'legal-business-details-en', ...CANCELLATION_SLOT_IDS],
  attributes: ['data-business-name', 'data-business-controller', 'data-business-contact'],
} as const satisfies BusinessSlots

const pageSlots = new Map<string, BusinessSlots>([
  ['/contact', CONTACT_SLOTS],
  ['/privacy', LEGAL_SLOTS],
  ['/terms', LEGAL_SLOTS],
])

/** The slots the Worker fills on the page at this path; every other page has none. */
export function businessSlots(path: string | undefined): BusinessSlots | undefined {
  return path === undefined ? undefined : pageSlots.get(path)
}

/** Every page's slots together: an element naming none of them is a slot on no page. */
export const ANY_BUSINESS_SLOT: BusinessSlots = {
  ids: [...new Set([...pageSlots.values()].flatMap((slots) => slots.ids))],
  attributes: [...new Set([...pageSlots.values()].flatMap((slots) => slots.attributes))],
}

/** Whether the element with these attributes is one of the slots: its id, or a slot attribute. */
export function isSlotElement(
  slots: BusinessSlots,
  attributes: Readonly<Record<string, unknown>>,
): boolean {
  return (
    slots.ids.includes(String(attributes['id'] ?? '')) ||
    slots.attributes.some((name) => attributes[name] !== undefined)
  )
}

/** Studio may add attributes or nested markup to a slot. Match its identity in the parsed tree,
 * retaining the owner's element and styling while replacing only the authoritative content. */
export function fillSlots<S extends BusinessSlots>(
  html: string,
  slots: S,
  content: SlotContent<S>,
): string {
  const markup = new Map<string, string>(Object.entries(content))
  const fragment = parseFragment(html)
  const visit = (node: DefaultTreeAdapterMap['node']): void => {
    if ('attrs' in node) {
      const value = node.attrs
        .map((attr) =>
          attr.name === 'id'
            ? slots.ids.includes(attr.value)
              ? markup.get(attr.value)
              : undefined
            : slots.attributes.includes(attr.name)
              ? markup.get(attr.name)
              : undefined,
        )
        .find((value) => value !== undefined)
      if (value !== undefined) {
        node.childNodes = parseFragment(value).childNodes
        for (const child of node.childNodes) child.parentNode = node
        return
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(fragment)
  return serialize(fragment)
}
