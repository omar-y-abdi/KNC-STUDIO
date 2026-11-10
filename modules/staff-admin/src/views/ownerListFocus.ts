// Where focus goes in the two Settings owner lists once an answer has rendered: the pressed
// control is often gone by then. Only `moveOwnerListFocus` touches the page.

import type { KeysetEntry } from './ownerLists'

export type RowControl = 'first' | 'visibility' | 'delete'

export type FocusTarget =
  /** The section's open/close button; always there. */
  | { readonly place: 'toggle' }
  | { readonly place: 'list' }
  | { readonly place: 'more' }
  | { readonly place: 'row'; readonly id: string; readonly control: RowControl }

function rowAt(entries: readonly KeysetEntry[], position: number): FocusTarget {
  const row = entries[Math.min(Math.max(position, 0), entries.length - 1)]
  return row === undefined ? { place: 'toggle' } : { place: 'row', id: row.id, control: 'first' }
}

/** `before` is what the list showed when the action started; `after` is null when the list could
 * not be read again. A gone row's focus goes to the row now in its place. */
export function focusAfterRowAction(
  before: readonly KeysetEntry[],
  after: readonly KeysetEntry[] | null,
  id: string,
  control: Exclude<RowControl, 'first'>,
): FocusTarget {
  if (after === null) return { place: 'list' }
  if (after.some((entry) => entry.id === id)) return { place: 'row', id, control }
  return rowAt(
    after,
    before.findIndex((entry) => entry.id === id),
  )
}

/** A failed read (`stillOffered`) keeps the focus on the button, so pressing again reads again. */
export function focusAfterMore(
  appended: readonly KeysetEntry[],
  shown: readonly KeysetEntry[],
  stillOffered: boolean,
): FocusTarget {
  const first = appended[0]
  if (first !== undefined) return { place: 'row', id: first.id, control: 'first' }
  if (stillOffered) return { place: 'more' }
  return rowAt(shown, shown.length - 1)
}

/** A control elsewhere that the owner moved to keeps the focus. */
export function focusIsOurs<T>(
  active: T | null,
  body: T | null,
  section: { contains(element: T): boolean } | null,
): boolean {
  if (active === null || active === body) return true
  return section !== null && section.contains(active)
}

export interface OwnerListScope {
  readonly section: HTMLElement | null
  readonly toggle: HTMLElement | null
  readonly list: HTMLElement | null
}

const ROW_ATTRIBUTE = 'data-owner-list-row'
const CONTROL_ATTRIBUTE = 'data-owner-list-control'

export const rowMark = (id: string) => ({ [ROW_ATTRIBUTE]: id })

export const controlMark = (control: Exclude<RowControl, 'first'> | 'more') => ({
  [CONTROL_ATTRIBUTE]: control,
})

function elementFor(target: FocusTarget, scope: OwnerListScope): HTMLElement | null {
  switch (target.place) {
    case 'toggle':
      return scope.toggle
    case 'list':
      return scope.list
    case 'more':
      return scope.list?.querySelector<HTMLElement>(`[${CONTROL_ATTRIBUTE}="more"]`) ?? null
    case 'row': {
      // Compared as text: an id is never written into a selector.
      const rows = scope.list?.querySelectorAll<HTMLElement>(`[${ROW_ATTRIBUTE}]`) ?? []
      const row = Array.from(rows).find(
        (candidate) => candidate.getAttribute(ROW_ATTRIBUTE) === target.id,
      )
      if (row === undefined) return null
      const control =
        target.control === 'first'
          ? row.querySelector<HTMLElement>('button')
          : row.querySelector<HTMLElement>(`[${CONTROL_ATTRIBUTE}="${target.control}"]`)
      // A row without buttons (an admin log entry) takes the focus itself.
      return control ?? row
    }
  }
}

export type MoveOwnerListFocus = (target: FocusTarget, scope: OwnerListScope) => void

export const moveOwnerListFocus: MoveOwnerListFocus = (target, scope) => {
  if (!focusIsOurs(document.activeElement, document.body, scope.section)) return
  const element = elementFor(target, scope) ?? scope.toggle
  element?.focus()
}
