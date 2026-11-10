// Where the keyboard focus goes in the two owner lists of Settings (review moderation and the admin
// log) once an answer has rendered. The control the owner pressed is often gone by then: a deleted
// row, a "show more" button after the last page, a "try again" button once the read starts. Without
// a place to go the focus falls to the page, and the next Tab starts from the top.
//
// The decisions are pure (`focusAfterRowAction`, `focusAfterMore`, `focusIsOurs`); the one function
// that touches the page is `moveOwnerListFocus`, which the sections call after they have rendered.

import type { KeysetEntry } from './ownerLists'

/** Which control of a row: its first button, or the one that holds a named action. */
export type RowControl = 'first' | 'visibility' | 'delete'

/** A place in a section that can take the focus. */
export type FocusTarget =
  /** The button that opens and closes the section; it is always there. */
  | { readonly place: 'toggle' }
  /** The list container, which holds whatever the list shows: rows, a failure, nothing yet. */
  | { readonly place: 'list' }
  /** The "show more" button. */
  | { readonly place: 'more' }
  | { readonly place: 'row'; readonly id: string; readonly control: RowControl }

/** The row that stands at `position` now, else the last row, else the section's own button. */
function rowAt(entries: readonly KeysetEntry[], position: number): FocusTarget {
  const row = entries[Math.min(Math.max(position, 0), entries.length - 1)]
  return row === undefined ? { place: 'toggle' } : { place: 'row', id: row.id, control: 'first' }
}

/**
 * Where the focus goes after an action on the row `id` was answered.
 *   - the row is still shown: its button that holds the action now (`control`)
 *   - the row is gone: the first button of the row that stands in its place, else of the row
 *     before it, else the section's own button
 *   - the list could not be read again (`after` is `null`): the list container, which says so
 * `before` is what the list showed when the action started, `after` what it shows now.
 */
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

/**
 * Where the focus goes after "show more" was answered.
 *   - rows arrived: the first of them
 *   - none arrived and the button is still offered (the read failed): the button itself, so that
 *     pressing again reads again and acts on no row
 *   - none arrived and the list has ended: the last row, else the section's own button
 * `shown` is what the list shows now.
 */
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

/**
 * Whether the focus is ours to move: it rests nowhere, on the page itself, or inside the section.
 * A control elsewhere that the owner moved to keeps it.
 */
export function focusIsOurs<T>(
  active: T | null,
  body: T | null,
  section: { contains(element: T): boolean } | null,
): boolean {
  if (active === null || active === body) return true
  return section !== null && section.contains(active)
}

/** The parts of a section on the page. Each is `null` until it is rendered. */
export interface OwnerListScope {
  readonly section: HTMLElement | null
  readonly toggle: HTMLElement | null
  readonly list: HTMLElement | null
}

const ROW_ATTRIBUTE = 'data-owner-list-row'
const CONTROL_ATTRIBUTE = 'data-owner-list-control'

/** The attribute that marks a row with its id, for `moveOwnerListFocus` to find it by. */
export const rowMark = (id: string) => ({ [ROW_ATTRIBUTE]: id })

/** The attribute that marks a control with what it holds: a row's action, or "show more". */
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

/** How a section moves the focus; a test passes its own. */
export type MoveOwnerListFocus = (target: FocusTarget, scope: OwnerListScope) => void

/**
 * Move the focus to `target`, when it is ours to move. A target that is not on the page falls back
 * to the section's own button.
 */
export const moveOwnerListFocus: MoveOwnerListFocus = (target, scope) => {
  if (!focusIsOurs(document.activeElement, document.body, scope.section)) return
  const element = elementFor(target, scope) ?? scope.toggle
  element?.focus()
}
