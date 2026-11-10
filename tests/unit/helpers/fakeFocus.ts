import { vi } from 'vitest'

// Stand-ins for the DOM that focus code touches (`focusQuietly`, a control's `.focus()`).
// As in a browser, a control always takes the focus, a text only while it carries a `tabindex`.

type Listener = () => void
type Focus = (options?: { readonly preventScroll?: boolean }) => void

export interface FakeElement {
  readonly attributes: Map<string, string>
  readonly hasAttribute: (name: string) => boolean
  readonly setAttribute: (name: string, value: string) => void
  readonly removeAttribute: (name: string) => void
  readonly addEventListener: (
    type: string,
    listener: Listener,
    options?: { readonly once?: boolean },
  ) => void
  readonly removeEventListener: (type: string, listener: Listener) => void
  readonly focus: ReturnType<typeof vi.fn<Focus>>
  /** What the browser's blur event does: runs the blur listeners, a `once` listener one time. */
  readonly loseFocus: () => void
}

export interface FakePage {
  activeElement: FakeElement | null
}

/** Install a fake page as the global `document`. `vi.unstubAllGlobals()` removes it. */
export function installFakePage(): FakePage {
  const page: FakePage = { activeElement: null }
  vi.stubGlobal('document', page)
  return page
}

/** An element of `page`: a `control` takes the focus as a button does, a `text` only with a
 * `tabindex`. Moving the focus elsewhere blurs the element that had it. */
export function fakeElement(page: FakePage, kind: 'control' | 'text' = 'text'): FakeElement {
  const attributes = new Map<string, string>()
  const blurListeners = new Map<Listener, boolean>()
  const element: FakeElement = {
    attributes,
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => {
      attributes.set(name, value)
    },
    removeAttribute: (name) => {
      attributes.delete(name)
    },
    addEventListener: (type, listener, options) => {
      if (type === 'blur') blurListeners.set(listener, options?.once === true)
    },
    removeEventListener: (type, listener) => {
      if (type === 'blur') blurListeners.delete(listener)
    },
    focus: vi.fn<Focus>(() => {
      if (kind === 'text' && !attributes.has('tabindex')) return
      const previous = page.activeElement
      if (previous === element) return
      page.activeElement = element
      previous?.loseFocus()
    }),
    loseFocus: () => {
      for (const [listener, once] of [...blurListeners]) {
        if (once) blurListeners.delete(listener)
        listener()
      }
    },
  }
  return element
}
