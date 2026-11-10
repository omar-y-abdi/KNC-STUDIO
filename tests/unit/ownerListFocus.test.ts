import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  controlMark,
  focusAfterMore,
  focusAfterRowAction,
  focusIsOurs,
  moveOwnerListFocus,
  rowMark,
  type OwnerListScope,
} from '../../modules/staff-admin/src/views/ownerListFocus'

const entry = (id: string) => ({ id, createdAt: '2026-11-10T13:05:00.654321+00:00' })
const a = entry('a')
const b = entry('b')
const c = entry('c')

const toggle = { place: 'toggle' }
const firstOf = (id: string) => ({ place: 'row', id, control: 'first' })

describe('focus after an action on a row', () => {
  it.each(['visibility', 'delete'] as const)(
    'stays on the %s button of a row that is still shown',
    (control) => {
      expect(focusAfterRowAction([a, b, c], [a, b, c], 'b', control)).toEqual({
        place: 'row',
        id: 'b',
        control,
      })
    },
  )

  it('goes to the first button of the row that now stands where the row was', () => {
    expect(focusAfterRowAction([a, b, c], [a, c], 'b', 'delete')).toEqual(firstOf('c'))
    expect(focusAfterRowAction([a, b, c], [b, c], 'a', 'delete')).toEqual(firstOf('b'))
  })

  it('goes to the row before when the last row is gone', () => {
    expect(focusAfterRowAction([a, b, c], [a, b], 'c', 'delete')).toEqual(firstOf('b'))
  })

  it('goes to the section’s own button when the only row is gone', () => {
    expect(focusAfterRowAction([a], [], 'a', 'delete')).toEqual(toggle)
  })

  it('treats a row that a hide or publish found gone like a deleted one', () => {
    expect(focusAfterRowAction([a, b], [b], 'a', 'visibility')).toEqual(firstOf('b'))
  })

  it('finds the place by where the row was, also in a list that was read again', () => {
    const d = entry('d')
    const e = entry('e')
    expect(focusAfterRowAction([a, b, c], [d, e], 'b', 'delete')).toEqual(firstOf('e'))
    expect(focusAfterRowAction([a, b, c], [d, e], 'a', 'delete')).toEqual(firstOf('d'))
    expect(focusAfterRowAction([a, b, c], [d, b], 'b', 'visibility')).toEqual({
      place: 'row',
      id: 'b',
      control: 'visibility',
    })
  })

  it('goes to the first row for a row the list never showed', () => {
    expect(focusAfterRowAction([a, b], [a, b], 'z', 'delete')).toEqual(firstOf('a'))
  })

  it('goes to the list itself when it could not be read again', () => {
    expect(focusAfterRowAction([a, b], null, 'a', 'delete')).toEqual({ place: 'list' })
    expect(focusAfterRowAction([a, b], null, 'a', 'visibility')).toEqual({ place: 'list' })
  })
})

describe('focus after "show more"', () => {
  it('goes to the first of the rows that arrived', () => {
    expect(focusAfterMore([b, c], [a], false)).toEqual(firstOf('b'))
    // Also when the server says still more exist.
    expect(focusAfterMore([b], [a], true)).toEqual(firstOf('b'))
  })

  it('stays on the button when nothing arrived and it is still offered', () => {
    expect(focusAfterMore([], [a, b], true)).toEqual({ place: 'more' })
  })

  it('goes to the last row when nothing arrived and the list has ended', () => {
    expect(focusAfterMore([], [a, b], false)).toEqual(firstOf('b'))
  })

  it('goes to the section’s own button when nothing arrived and nothing is shown', () => {
    expect(focusAfterMore([], [], false)).toEqual(toggle)
  })
})

describe('whose the focus is', () => {
  const inside = { name: 'inside' }
  const outside = { name: 'outside' }
  const body = { name: 'body' }
  const section = { contains: (element: { name: string }) => element === inside }

  it('is ours when it rests nowhere or on the page itself', () => {
    expect(focusIsOurs(null, body, section)).toBe(true)
    expect(focusIsOurs(body, body, section)).toBe(true)
  })

  it('is ours when it rests inside the section', () => {
    expect(focusIsOurs(inside, body, section)).toBe(true)
  })

  it('is not ours when it rests on a control elsewhere', () => {
    expect(focusIsOurs(outside, body, section)).toBe(false)
  })

  it('is not ours on a control when the section is not on the page', () => {
    expect(focusIsOurs(inside, body, null)).toBe(false)
    expect(focusIsOurs(null, body, null)).toBe(true)
  })
})

interface FakeElement {
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly FakeElement[]
  readonly focus: ReturnType<typeof vi.fn<() => void>>
  getAttribute(name: string): string | null
  querySelector(selector: string): FakeElement | null
  querySelectorAll(selector: string): FakeElement[]
  contains(other: unknown): boolean
}

/** The selectors the focus code uses: a tag name, `[name]` and `[name="value"]`. */
function matches(element: FakeElement, selector: string): boolean {
  if (!selector.startsWith('[')) return element.tag === selector
  const [name = '', quoted] = selector.slice(1, -1).split('=')
  const held = element.attributes[name]
  if (held === undefined) return false
  return quoted === undefined || quoted === `"${held}"`
}

function element(
  tag: string,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly FakeElement[] = [],
): FakeElement {
  const below = (): FakeElement[] =>
    children.flatMap((child) => [child, ...child.querySelectorAll('*')])
  const self: FakeElement = {
    tag,
    attributes,
    children,
    focus: vi.fn<() => void>(),
    getAttribute: (name) => attributes[name] ?? null,
    querySelector: (selector) => self.querySelectorAll(selector)[0] ?? null,
    querySelectorAll: (selector) =>
      selector === '*' ? below() : below().filter((child) => matches(child, selector)),
    contains: (other) => other === self || below().some((child) => child === other),
  }
  return self
}

// The fakes have only the methods the focus code calls.
const onPage = (fake: FakeElement): HTMLElement => fake as unknown as HTMLElement

function page() {
  const hide = element('button', controlMark('visibility'))
  const remove = element('button', controlMark('delete'))
  const reviewRow = element('li', rowMark('r1'), [element('span'), hide, remove])
  const publish = element('button', controlMark('visibility'))
  const otherRow = element('li', rowMark('r2'), [publish, element('button', controlMark('delete'))])
  // An admin log entry: a row without buttons.
  const logRow = element('li', rowMark('a1'), [element('span')])
  const more = element('button', controlMark('more'))
  const list = element('div', {}, [element('ul', {}, [reviewRow, otherRow, logRow]), more])
  const toggleButton = element('button')
  const section = element('section', {}, [toggleButton, list])
  const elsewhere = element('input')
  const body = element('body', {}, [section, elsewhere])
  const scope: OwnerListScope = {
    section: onPage(section),
    toggle: onPage(toggleButton),
    list: onPage(list),
  }
  const all = [hide, remove, reviewRow, publish, otherRow, logRow, more, list, toggleButton]
  const focused = () => all.filter((candidate) => candidate.focus.mock.calls.length > 0)
  const focusRestsOn = (active: FakeElement | null): void => {
    vi.stubGlobal('document', { activeElement: active, body })
  }
  return {
    hide,
    remove,
    reviewRow,
    publish,
    logRow,
    more,
    list,
    toggleButton,
    elsewhere,
    body,
    scope,
    focused,
    focusRestsOn,
  }
}

describe('moving the focus on the page', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('focuses the button of the row that holds the named action', () => {
    const ui = page()
    ui.focusRestsOn(ui.body)

    moveOwnerListFocus({ place: 'row', id: 'r1', control: 'delete' }, ui.scope)
    expect(ui.focused()).toEqual([ui.remove])
  })

  it('tells the rows apart by their id', () => {
    const ui = page()
    ui.focusRestsOn(ui.body)

    moveOwnerListFocus({ place: 'row', id: 'r2', control: 'visibility' }, ui.scope)
    expect(ui.focused()).toEqual([ui.publish])
  })

  it('focuses the first button of a row, and the row itself when it has none', () => {
    const ui = page()
    ui.focusRestsOn(null)

    moveOwnerListFocus({ place: 'row', id: 'r1', control: 'first' }, ui.scope)
    moveOwnerListFocus({ place: 'row', id: 'a1', control: 'first' }, ui.scope)

    expect(ui.focused()).toEqual([ui.hide, ui.logRow])
  })

  it('focuses the "show more" button, the list and the section’s own button by their place', () => {
    const ui = page()
    ui.focusRestsOn(ui.body)

    moveOwnerListFocus({ place: 'more' }, ui.scope)
    expect(ui.focused()).toEqual([ui.more])
    moveOwnerListFocus({ place: 'list' }, ui.scope)
    expect(ui.focused()).toEqual([ui.more, ui.list])
    moveOwnerListFocus({ place: 'toggle' }, ui.scope)
    expect(ui.focused()).toEqual([ui.more, ui.list, ui.toggleButton])
  })

  it('falls back to the section’s own button for a place that is not on the page', () => {
    const ui = page()
    ui.focusRestsOn(ui.body)

    moveOwnerListFocus({ place: 'row', id: 'gone', control: 'first' }, ui.scope)
    expect(ui.focused()).toEqual([ui.toggleButton])

    moveOwnerListFocus({ place: 'more' }, { ...ui.scope, list: null })
    moveOwnerListFocus({ place: 'list' }, { ...ui.scope, list: null })
    expect(ui.toggleButton.focus).toHaveBeenCalledTimes(3)
  })

  it('moves the focus that rests inside the section', () => {
    const ui = page()
    ui.focusRestsOn(ui.remove)

    moveOwnerListFocus({ place: 'row', id: 'r2', control: 'first' }, ui.scope)
    expect(ui.focused()).toEqual([ui.publish])
  })

  it('never takes the focus from a control elsewhere on the page', () => {
    const ui = page()
    ui.focusRestsOn(ui.elsewhere)

    moveOwnerListFocus({ place: 'row', id: 'r1', control: 'delete' }, ui.scope)
    moveOwnerListFocus({ place: 'toggle' }, ui.scope)
    moveOwnerListFocus({ place: 'list' }, ui.scope)

    expect(ui.focused()).toEqual([])
  })
})
