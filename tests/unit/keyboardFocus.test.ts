import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../../modules/public-web/src/ui/Dialog'
import {
  focusIntoCard,
  holdKeyboardFocus,
  settleFocusAfterClose,
  tabLeavesCard,
  tabStops,
} from '../../modules/public-web/src/ui/dialogFocus'
import {
  QUIET_FOCUS_ATTRIBUTE,
  focusIsStranded,
  focusIsWithin,
  hasSkipLink,
} from '../../modules/public-web/src/ui/pageFocus'
import { mount, nodes, ref, render, reset } from './helpers/fakeHooks'
import { matchesSelector, type SelectorSubject } from './helpers/fakeSelector'

// The dialog component is rendered as a plain function: its hooks are the fakes, its surface is the
// markup it returns, and a Studio source frame is a switch.
const studio = vi.hoisted(() => ({ sourceFrame: false }))
// The dialog focuses in its opening commit (a layout effect): `mount()` runs it as that commit.
vi.mock('preact/hooks', async () => {
  const hooks = await import('./helpers/fakeHooks')
  return { ...hooks, useLayoutEffect: hooks.useEffect }
})
vi.mock('../../modules/public-web/src/cms/NativeSurface', () => ({
  useNativeSurface: (node: unknown) => node,
  useNativeSource: () => studio.sourceFrame,
}))
vi.mock('../../modules/public-web/src/ui/reducedMotion', () => ({
  prefersReducedMotion: () => false,
}))

// A stand-in DOM: selectors are applied for real (helpers/fakeSelector.ts), while what takes focus
// is the stand-in's own knowledge of a browser, written apart from the selectors under test.

const FORM_CONTROLS: ReadonlySet<string> = new Set(['button', 'input', 'select', 'textarea'])

class FakeElement implements SelectorSubject {
  parent: FakeElement | null = null
  isConnected = true
  /** False for an element the page does not render (`display: none`): it refuses focus. */
  rendered = true
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly tag: string
  private readonly blurListeners = new Set<() => void>()

  constructor(tag = 'div', attributes: Readonly<Record<string, string>> = {}) {
    this.tag = tag
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value)
  }

  add<T extends FakeElement>(child: T): T {
    child.parent = this
    this.children.push(child)
    return child
  }

  remove(): void {
    const siblings = this.parent?.children
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1)
    this.parent = null
    this.isConnected = false
  }

  contains(node: unknown): boolean {
    for (let at = node instanceof FakeElement ? node : null; at !== null; at = at.parent)
      if (at === this) return true
    return false
  }

  matches(selector: string): boolean {
    return matchesSelector(this, selector)
  }

  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : (this.parent?.closest(selector) ?? null)
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'blur') this.blurListeners.add(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'blur') this.blurListeners.delete(listener)
  }

  /** A link with an address, a frame, an enabled control but a hidden input, or a `tabindex`; none
   * while unrendered, out of the document or in an inert or hidden part. */
  private takesFocus(): boolean {
    const control =
      (this.tag === 'a' && this.attributes.has('href')) ||
      this.tag === 'iframe' ||
      (FORM_CONTROLS.has(this.tag) &&
        !this.attributes.has('disabled') &&
        !(this.tag === 'input' && this.attributes.get('type') === 'hidden'))
    if (!control && !this.attributes.has('tabindex')) return false
    return this.rendered && this.isConnected && !this.dormant()
  }

  /** Inside a part that is inert or hidden, or such a part itself. */
  private dormant(): boolean {
    return (
      this.attributes.has('inert') ||
      this.attributes.has('hidden') ||
      (this.parent?.dormant() ?? false)
    )
  }

  readonly focus = vi.fn(() => {
    if (!this.takesFocus()) return
    const previous = page.activeElement
    if (previous === this) return
    page.activeElement = this
    if (previous !== null) for (const listener of [...previous.blurListeners]) listener()
  })
}

interface FakePage {
  activeElement: FakeElement | null
  readonly body: FakeElement
  readonly listeners: Map<string, (event: unknown) => void>
  readonly addEventListener: (type: string, listener: (event: unknown) => void) => void
  readonly removeEventListener: (type: string) => void
  readonly querySelector: (selector: string) => FakeElement | null
}

let page: FakePage
let releases: (() => void)[]

const element = (fake: FakeElement): HTMLElement => fake as unknown as HTMLElement

const box = (attributes: Readonly<Record<string, string>> = {}): FakeElement =>
  new FakeElement('div', attributes)
const button = (): FakeElement => new FakeElement('button')
const link = (): FakeElement => new FakeElement('a', { href: '/terms' })
const hiddenInput = (): FakeElement => new FakeElement('input', { type: 'hidden' })
const disabledButton = (): FakeElement => new FakeElement('button', { disabled: '' })
const unrendered = (): FakeElement => {
  const control = button()
  control.rendered = false
  return control
}
/** Turnstile's marked container (booking/Turnstile.tsx) with its response field; the frame itself
 * is in a closed shadow root, out of the document's sight. */
const challenge = (): FakeElement => {
  const container = box({ 'data-knc-widget': '' })
  container.add(hiddenInput())
  return container
}
const skipLink = (): FakeElement =>
  page.body.add(new FakeElement('a', { class: 'knc-skip-link', href: '#main' }))
const mainLandmark = (): FakeElement => page.body.add(new FakeElement('main'))

/** A dialog card: focusable from code, as `tabindex="-1"` makes the real one. */
const card = (...controls: FakeElement[]): FakeElement => {
  const dialog = page.body.add(box({ tabindex: '-1' }))
  for (const control of controls) dialog.add(control)
  return dialog
}

/** The very elements, in this order: two stand-ins of one shape are not each other. */
const expectElements = (actual: readonly HTMLElement[], expected: readonly FakeElement[]): void => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((node, index) => expect(node).toBe(expected[index]))
}

const hold = (dialog: FakeElement): (() => void) => {
  const release = holdKeyboardFocus(element(dialog))
  releases.push(release)
  return release
}

const focusLands = (target: FakeElement): void => {
  target.focus()
  page.listeners.get('focusin')?.({ target })
}

const pressTab = (shiftKey = false, key = 'Tab'): ReturnType<typeof vi.fn> => {
  const preventDefault = vi.fn()
  page.listeners.get('keydown')?.({ key, shiftKey, preventDefault })
  return preventDefault
}

beforeEach(() => {
  const listeners = new Map<string, (event: unknown) => void>()
  page = {
    activeElement: null,
    body: new FakeElement('body'),
    listeners,
    addEventListener: (type, listener) => {
      listeners.set(type, listener)
    },
    removeEventListener: (type) => {
      listeners.delete(type)
    },
    querySelector: (selector) => page.body.querySelectorAll(selector)[0] ?? null,
  }
  page.activeElement = page.body
  releases = []
  studio.sourceFrame = false
  vi.stubGlobal('document', page)
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('HTMLElement', FakeElement)
})

afterEach(async () => {
  for (const release of releases) release()
  // A closing dialog settles the focus in a microtask: it runs while the fake page still stands.
  await Promise.resolve()
  vi.unstubAllGlobals()
})

/** Mounts the dialog component over `dialog` as its card. `close` unmounts it; `keyDown` is the
 * key handler of its markup. */
const openDialog = (
  dialog: FakeElement,
): { readonly close: () => void; readonly keyDown: (event: object) => void } => {
  reset()
  const markup = render(() =>
    Dialog({
      titleId: 'title',
      onClose: vi.fn(),
      onBackdropClick: vi.fn(),
      backdropStyle: '',
      backdropClass: 'backdrop',
      cardStyle: {},
      cardClass: 'card',
      children: null,
    }),
  )
  ref(0, dialog)
  const close = mount()
  releases.push(close)
  const keyDown = nodes(markup)[0]?.props['onKeyDown']
  if (typeof keyDown !== 'function') throw new Error('The dialog markup has no key handler')
  return { close, keyDown: (event) => void Reflect.apply(keyDown, undefined, [event]) }
}

/** What the browser does when the dialog's tree leaves the document while it holds the focus. */
const leaveDocument = (dialog: FakeElement): void => {
  dialog.isConnected = false
  page.activeElement = page.body
}

describe('Dialog', () => {
  it('takes the focus on open and gives it back to its opener on close', () => {
    const opener = page.body.add(button())
    opener.focus()
    const dialog = card(button())
    const { close } = openDialog(dialog)
    expect(page.activeElement).toBe(dialog)
    close()
    expect(page.activeElement).toBe(opener)
  })

  it('wraps Shift+Tab from its first control to the last one that takes focus', () => {
    const first = button()
    const last = button()
    const dialog = card(first, last, hiddenInput())
    const { keyDown } = openDialog(dialog)
    first.focus()
    const preventDefault = vi.fn()
    keyDown({ key: 'Tab', shiftKey: true, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(last)
  })

  it('wraps Tab from its last usable control to its first, and leaves Tab alone in between', () => {
    const first = button()
    const last = button()
    const dialog = card(first, last, disabledButton())
    const { keyDown } = openDialog(dialog)
    first.focus()
    const between = vi.fn()
    keyDown({ key: 'Tab', shiftKey: false, preventDefault: between })
    expect(between).not.toHaveBeenCalled()
    last.focus()
    const preventDefault = vi.fn()
    keyDown({ key: 'Tab', shiftKey: false, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(first)
  })

  it('leaves Tab on its last control to the browser when the verification challenge follows', () => {
    // The booking details: close, the fields, the terms link, the challenge, and a Book button that
    // is disabled until the challenge has been solved. Tab from the terms link is the only way in.
    const close = button()
    const terms = link()
    const dialog = card(close, terms, challenge(), disabledButton())
    const { keyDown } = openDialog(dialog)
    terms.focus()
    const preventDefault = vi.fn()
    keyDown({ key: 'Tab', shiftKey: false, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(page.activeElement).toBe(terms)
    // Shift+Tab from the first control still wraps: nothing lies before it.
    close.focus()
    const backwards = vi.fn()
    keyDown({ key: 'Tab', shiftKey: true, preventDefault: backwards })
    expect(backwards).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(terms)
  })

  it('keeps the page behind out of reach while open, and lets go on close', () => {
    const behind = page.body.add(button())
    const dialog = card(button())
    const { close } = openDialog(dialog)
    focusLands(behind)
    expect(page.activeElement).toBe(dialog)
    close()
    expect(page.listeners.size).toBe(0)
  })

  it('in the public shell hands the focus to the main landmark when its opener is gone', async () => {
    skipLink()
    const main = mainLandmark()
    const opener = page.body.add(button())
    opener.focus()
    const dialog = card(button())
    const { close } = openDialog(dialog)
    opener.isConnected = false
    close()
    leaveDocument(dialog)
    expect(main.focus).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(page.activeElement).toBe(main)
  })

  it('on a page without a skip link closes as before: the opener or nothing', async () => {
    // The staff pages and Studio share this dialog; their <main> is never focused from code.
    const main = mainLandmark()
    const opener = page.body.add(button())
    opener.focus()
    const dialog = card(button())
    const { close } = openDialog(dialog)
    opener.isConnected = false
    close()
    leaveDocument(dialog)
    await Promise.resolve()
    expect(page.activeElement).toBe(page.body)
    expect(main.focus).not.toHaveBeenCalled()
  })

  it('holds no keyboard focus in a Studio source frame', () => {
    studio.sourceFrame = true
    const behind = page.body.add(button())
    const dialog = card(button())
    openDialog(dialog)
    expect(page.listeners.size).toBe(0)
    focusLands(behind)
    expect(page.activeElement).toBe(behind)
  })
})

describe('tabStops', () => {
  it('stops at each kind of control a dialog holds, in document order, and at nothing else', () => {
    const terms = link()
    const close = button()
    const note = new FakeElement('textarea')
    const email = new FakeElement('input', { type: 'email' })
    const choice = new FakeElement('select')
    const custom = box({ tabindex: '0' })
    const dialog = card(
      // An anchor without an address, a text, a container: no controls.
      new FakeElement('a'),
      terms,
      new FakeElement('span'),
      close,
      note,
      box(),
      email,
      choice,
      custom,
      // Focusable from code only.
      box({ tabindex: '-1' }),
    )
    expectElements(tabStops(element(dialog)), [terms, close, note, email, choice, custom])
  })

  it('leaves out what cannot take focus: a hidden input, a disabled field, an inert or hidden part', () => {
    const first = button()
    const inertPart = box({ inert: '' })
    const hiddenPart = box({ hidden: '' })
    inertPart.add(button())
    hiddenPart.add(button())
    const last = button()
    const dialog = card(
      first,
      disabledButton(),
      new FakeElement('input', { disabled: '' }),
      inertPart,
      hiddenPart,
      last,
      hiddenInput(),
    )
    expectElements(tabStops(element(dialog)), [first, last])
  })

  it('does not count an embedded widget, nor the hidden field it holds', () => {
    const only = button()
    const dialog = card(only, challenge(), new FakeElement('iframe'))
    expectElements(tabStops(element(dialog)), [only])
  })
})

describe('focusIntoCard', () => {
  it('enters backwards at the last control that takes focus when the last match is a hidden input', () => {
    const submit = button()
    const dialog = card(button(), submit, hiddenInput())
    focusIntoCard(element(dialog), true)
    expect(page.activeElement).toBe(submit)
  })

  it('enters backwards at the last control that takes focus when the last match is disabled', () => {
    const close = button()
    const dialog = card(close, disabledButton())
    focusIntoCard(element(dialog), true)
    expect(page.activeElement).toBe(close)
  })

  it('reaches the only usable control from either direction', () => {
    const only = button()
    const dialog = card(disabledButton(), only, hiddenInput())
    focusIntoCard(element(dialog), false)
    expect(page.activeElement).toBe(only)
    page.activeElement = page.body
    focusIntoCard(element(dialog), true)
    expect(page.activeElement).toBe(only)
  })

  it('passes over a control that refuses focus and tries the next in that direction', () => {
    const first = button()
    const second = button()
    const dialog = card(unrendered(), first, second, unrendered())
    focusIntoCard(element(dialog), true)
    expect(page.activeElement).toBe(second)
    focusIntoCard(element(dialog), false)
    expect(page.activeElement).toBe(first)
  })

  it('leaves the focus on the card when it has no usable control', () => {
    const dialog = card(disabledButton(), hiddenInput())
    focusIntoCard(element(dialog), true)
    expect(page.activeElement).toBe(dialog)
    const empty = card()
    focusIntoCard(element(empty), false)
    expect(page.activeElement).toBe(empty)
  })
})

describe('tabLeavesCard', () => {
  it('wraps forwards from the last usable control, not from the last match', () => {
    const first = button()
    const last = button()
    const dialog = card(first, last, hiddenInput())
    page.activeElement = last
    expect(tabLeavesCard(element(dialog), false)).toBe(true)
    page.activeElement = first
    expect(tabLeavesCard(element(dialog), false)).toBe(false)
  })

  it('wraps backwards from the first usable control and from the card itself', () => {
    const first = button()
    const last = button()
    const dialog = card(disabledButton(), first, last)
    page.activeElement = first
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
    page.activeElement = dialog
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
    page.activeElement = last
    expect(tabLeavesCard(element(dialog), true)).toBe(false)
  })

  it('lets Tab walk from the card into its first control', () => {
    const dialog = card(button(), button())
    page.activeElement = dialog
    expect(tabLeavesCard(element(dialog), false)).toBe(false)
  })

  it('always holds Tab in a card without a usable control', () => {
    const dialog = card(hiddenInput())
    page.activeElement = dialog
    expect(tabLeavesCard(element(dialog), false)).toBe(true)
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
  })
})

describe('tabLeavesCard beside an embedded widget', () => {
  it('does not wrap Tab from the last control when a widget follows it', () => {
    const close = button()
    const terms = link()
    const dialog = card(close, terms, challenge(), disabledButton())
    page.activeElement = terms
    expect(tabLeavesCard(element(dialog), false)).toBe(false)
    // Backwards nothing has changed: no widget lies before the first control.
    page.activeElement = close
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
  })

  it('does not wrap Shift+Tab from the first control when a widget precedes it', () => {
    const first = button()
    const last = button()
    const dialog = card(challenge(), first, last)
    page.activeElement = first
    expect(tabLeavesCard(element(dialog), true)).toBe(false)
    // Forwards nothing has changed: no widget lies after the last control.
    page.activeElement = last
    expect(tabLeavesCard(element(dialog), false)).toBe(true)
  })

  it('takes a frame for a widget without the mark', () => {
    const first = button()
    const last = button()
    const dialog = card(new FakeElement('iframe'), first, last, new FakeElement('iframe'))
    page.activeElement = last
    expect(tabLeavesCard(element(dialog), false)).toBe(false)
    page.activeElement = first
    expect(tabLeavesCard(element(dialog), true)).toBe(false)
  })

  it('wraps as before around a widget that lies between two controls', () => {
    const first = button()
    const last = button()
    const dialog = card(first, challenge(), last)
    page.activeElement = last
    expect(tabLeavesCard(element(dialog), false)).toBe(true)
    page.activeElement = first
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
  })

  it('does not count a widget in a part that is inert or hidden', () => {
    const first = button()
    const last = button()
    const inertPart = box({ inert: '' })
    const hiddenPart = box({ hidden: '' })
    hiddenPart.add(challenge())
    inertPart.add(challenge())
    const dialog = card(hiddenPart, first, last, inertPart)
    page.activeElement = last
    expect(tabLeavesCard(element(dialog), false)).toBe(true)
    page.activeElement = first
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
  })

  it('wraps Shift+Tab from the card itself whatever the card holds: all of it comes after', () => {
    const dialog = card(challenge(), button())
    page.activeElement = dialog
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
  })

  it('lets Tab into the widget of a card that has no control', () => {
    const dialog = card(challenge())
    page.activeElement = dialog
    expect(tabLeavesCard(element(dialog), false)).toBe(false)
    expect(tabLeavesCard(element(dialog), true)).toBe(true)
  })
})

describe('the focus guard of an open dialog', () => {
  it('returns focus that lands on the page behind to the topmost card, without scrolling', () => {
    const behind = page.body.add(button())
    const lower = card(button())
    const upper = card(button())
    hold(lower)
    hold(upper)
    focusLands(behind)
    expect(page.activeElement).toBe(upper)
    expect(upper.focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(lower.focus).not.toHaveBeenCalled()
  })

  it('returns focus from the dialog below to the one above it', () => {
    const inLower = button()
    const lower = card(inLower)
    const upper = card(button())
    hold(lower)
    hold(upper)
    focusLands(inLower)
    expect(page.activeElement).toBe(upper)
  })

  it('leaves focus inside the topmost card where it is', () => {
    const inside = button()
    const dialog = card(inside)
    hold(dialog)
    focusLands(inside)
    expect(page.activeElement).toBe(inside)
    expect(dialog.focus).not.toHaveBeenCalled()
  })

  it('leaves focus on a widget embedded in the card, and still returns focus that left the card', () => {
    const behind = page.body.add(button())
    const widget = challenge()
    const dialog = card(button(), widget)
    hold(dialog)
    // The frame took the focus. It sits in a closed shadow root, so the document names its host,
    // the marked container: an element of the card that is no control itself.
    page.activeElement = widget
    page.listeners.get('focusin')?.({ target: widget })
    expect(page.activeElement).toBe(widget)
    expect(dialog.focus).not.toHaveBeenCalled()
    // Tab reaches this document only when the widget does not take it: it stays the browser's.
    expect(pressTab()).not.toHaveBeenCalled()
    expect(page.activeElement).toBe(widget)
    focusLands(behind)
    expect(page.activeElement).toBe(dialog)
  })

  it('passes over a dialog left open in a part that has become inert', () => {
    const lower = card(button())
    const fold = page.body.add(box({ inert: '' }))
    const stranded = fold.add(box({ tabindex: '-1' }))
    const behind = page.body.add(button())
    hold(lower)
    hold(stranded)
    focusLands(behind)
    expect(page.activeElement).toBe(lower)
  })

  it('leaves focus inside a surface that covers the dialog (the lazy error overlay)', () => {
    const dialog = card(button())
    const overlay = page.body.add(box({ 'data-above-dialog': '' }))
    const reload = overlay.add(button())
    hold(dialog)
    focusLands(reload)
    expect(page.activeElement).toBe(reload)
    expect(dialog.focus).not.toHaveBeenCalled()
  })

  it('enters the card on Tab while focus is outside it: first control, or last with Shift', () => {
    const first = button()
    const last = button()
    const dialog = card(first, last, hiddenInput())
    hold(dialog)
    expect(pressTab()).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(first)
    page.activeElement = page.body
    expect(pressTab(true)).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(last)
  })

  it('leaves Tab pressed inside the covering surface to the browser', () => {
    const dialog = card(button())
    const overlay = page.body.add(box({ 'data-above-dialog': '' }))
    const reload = overlay.add(button())
    hold(dialog)
    page.activeElement = reload
    expect(pressTab()).not.toHaveBeenCalled()
    expect(pressTab(true)).not.toHaveBeenCalled()
    expect(page.activeElement).toBe(reload)
    expect(dialog.focus).not.toHaveBeenCalled()
  })

  it('leaves Tab inside the card and every other key to the page', () => {
    const inside = button()
    const dialog = card(inside, button())
    hold(dialog)
    page.activeElement = inside
    expect(pressTab()).not.toHaveBeenCalled()
    page.activeElement = page.body
    expect(pressTab(false, 'Enter')).not.toHaveBeenCalled()
    expect(page.activeElement).toBe(page.body)
  })

  it('lets go of the document when the last dialog closes', () => {
    const releaseLower = hold(card())
    const releaseUpper = hold(card())
    releaseUpper()
    expect(page.listeners.size).toBe(2)
    releaseLower()
    expect(page.listeners.size).toBe(0)
  })
})

describe('settleFocusAfterClose', () => {
  let main: FakeElement
  let skip: FakeElement

  beforeEach(() => {
    skip = skipLink()
    main = mainLandmark()
  })

  it('gives the focus back to the opener while it is in the document and takes focus', () => {
    const opener = page.body.add(button())
    const below = card()
    hold(below)
    settleFocusAfterClose(element(opener))
    expect(page.activeElement).toBe(opener)
    expect(below.focus).not.toHaveBeenCalled()
  })

  it('leaves focus that already rests on something', () => {
    const opener = page.body.add(button())
    const chosen = page.body.add(button())
    page.activeElement = chosen
    settleFocusAfterClose(element(opener))
    expect(page.activeElement).toBe(chosen)
    expect(opener.focus).not.toHaveBeenCalled()
  })

  it('gives it to the dialog below when the opener is gone', () => {
    const opener = button()
    opener.isConnected = false
    const below = card(button())
    hold(below)
    settleFocusAfterClose(element(opener))
    expect(page.activeElement).toBe(below)
    expect(below.focus).toHaveBeenLastCalledWith({ preventScroll: true })
  })

  it('gives it to the dialog below when the opener sits in a part that cannot hold focus', () => {
    const fold = page.body.add(box({ inert: '' }))
    const opener = fold.add(button())
    const below = card()
    hold(below)
    settleFocusAfterClose(element(opener))
    expect(page.activeElement).toBe(below)
  })

  it('gives it to the main landmark, without outline or scrolling, when no dialog is below', () => {
    settleFocusAfterClose(null)
    expect(page.activeElement).toBe(main)
    expect(main.focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(main.attributes.has(QUIET_FOCUS_ATTRIBUTE)).toBe(true)
    expect(main.attributes.get('tabindex')).toBe('-1')
  })

  it('does nothing on a page without a skip link: the staff pages, Studio, a Studio frame', () => {
    skip.remove()
    const opener = page.body.add(button())
    const below = card()
    hold(below)
    settleFocusAfterClose(element(opener))
    settleFocusAfterClose(null)
    expect(page.activeElement).toBe(page.body)
    expect(opener.focus).not.toHaveBeenCalled()
    expect(below.focus).not.toHaveBeenCalled()
    expect(main.focus).not.toHaveBeenCalled()
  })
})

describe('hasSkipLink', () => {
  it('tells the public shell, which renders the skip link, from every other page', () => {
    // Another link, and another element of that class, are not it.
    page.body.add(link())
    page.body.add(box({ class: 'knc-skip-link' }))
    expect(hasSkipLink()).toBe(false)
    skipLink()
    expect(hasSkipLink()).toBe(true)
  })
})

describe('focusIsStranded', () => {
  it('is when nothing holds the focus', () => {
    expect(focusIsStranded(null, page.body)).toBe(true)
    expect(focusIsStranded(page.body, page.body)).toBe(true)
  })

  it('is when what holds it sits in an inert part: the folded mobile hero, the closed fold', () => {
    const hero = page.body.add(box({ inert: '' }))
    const book = hero.add(box()).add(button())
    expect(focusIsStranded(book, page.body)).toBe(true)
  })

  it('is not while a usable control holds it: the desktop "Boka tid" toggle keeps the focus', () => {
    const toggle = page.body.add(button())
    expect(focusIsStranded(toggle, page.body)).toBe(false)
  })
})

describe('focusIsWithin', () => {
  // The mobile "Till startsidan" control hides once the hero is back: focus it holds is moved
  // before that (app/App.tsx).
  it('is when the part itself, or something inside it, holds the focus', () => {
    const control = page.body.add(button())
    const icon = control.add(new FakeElement('img'))
    expect(focusIsWithin(element(control), element(control))).toBe(true)
    expect(focusIsWithin(element(icon), element(control))).toBe(true)
  })

  it('is not when the focus is elsewhere, on nothing, or there is no such part', () => {
    const control = page.body.add(button())
    const other = page.body.add(button())
    expect(focusIsWithin(element(other), element(control))).toBe(false)
    expect(focusIsWithin(element(page.body), element(control))).toBe(false)
    expect(focusIsWithin(null, element(control))).toBe(false)
    expect(focusIsWithin(element(control), null)).toBe(false)
  })
})
