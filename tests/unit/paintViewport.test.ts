import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintEdgeTints, paintViewport } from '../../modules/public-web/src/ui/paintViewport'

// Stand-ins for the document members the viewport paint touches.

class FakeStyle {
  readonly declared = new Map<string, string>()
  colorScheme = ''
  background = ''
  setProperty(name: string, value: string): void {
    this.declared.set(name, value)
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>()
  readonly style = new FakeStyle()
  parent: FakeContainer | null = null
  readonly tagName: string
  constructor(tagName: string) {
    this.tagName = tagName
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  remove(): void {
    this.parent?.detach(this)
  }
}

class FakeContainer {
  readonly children: FakeElement[] = []
  readonly style = new FakeStyle()
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node)
  }
  appendChild(node: FakeElement): FakeElement {
    node.remove()
    node.parent = this
    this.children.push(node)
    return node
  }
  detach(node: FakeElement): void {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parent = null
  }
}

function meta(name: string, content: string, media?: string): FakeElement {
  const element = new FakeElement('meta')
  element.setAttribute('name', name)
  element.setAttribute('content', content)
  if (media !== undefined) element.setAttribute('media', media)
  return element
}

/** The served head of `index.html`: OS-specific theme colours and both colour schemes. */
function installServedDocument() {
  const html = new FakeContainer()
  const head = new FakeContainer()
  const body = new FakeContainer()
  head.append(
    meta('color-scheme', 'light dark'),
    meta('theme-color', '#f4f3f0', '(prefers-color-scheme: light)'),
    meta('theme-color', '#242427', '(prefers-color-scheme: dark)'),
  )
  const named = (selector: string): FakeElement[] => {
    const name = /^meta\[name="([^"]+)"\]$/.exec(selector)?.[1]
    if (name === undefined) throw new Error(`unsupported selector ${selector}`)
    return head.children.filter(
      (element) => element.tagName === 'meta' && element.getAttribute('name') === name,
    )
  }
  vi.stubGlobal('document', {
    documentElement: html,
    head,
    body,
    createElement: (tagName: string) => new FakeElement(tagName),
    querySelector: (selector: string) => named(selector)[0] ?? null,
    querySelectorAll: (selector: string) => named(selector),
  })
  return { html, head, body, named }
}

const px = (value: string | undefined): number => Number(/^(\d+)px$/.exec(value ?? '')?.[1])

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('paintViewport', () => {
  it('paints html and body, both colour schemes and exactly one unconditional theme-color', () => {
    const { html, body, named } = installServedDocument()

    paintViewport('rgb(255, 255, 255)', 'rgb(244, 243, 240)', 'light')

    expect([html.style.background, body.style.background]).toEqual([
      'rgb(255, 255, 255)',
      'rgb(255, 255, 255)',
    ])
    expect([html.style.colorScheme, body.style.colorScheme]).toEqual(['light', 'light'])
    expect(named('meta[name="color-scheme"]').map((m) => m.getAttribute('content'))).toEqual([
      'light',
    ])
    const themes = named('meta[name="theme-color"]')
    expect(themes.map((m) => [m.getAttribute('content'), m.getAttribute('media')])).toEqual([
      ['rgb(244, 243, 240)', null],
    ])
    // The staff panel paints through this call alone: it never adds edge tints.
    expect(body.children).toEqual([])
  })
})

describe('paintEdgeTints', () => {
  it('places one fixed tint on the top edge and one on the bottom edge in their colours', () => {
    const { body } = installServedDocument()

    paintEdgeTints('rgb(244, 243, 240)', 'rgb(255, 255, 255)')

    expect(body.children.map((tint) => tint.getAttribute('data-viewport-edge'))).toEqual([
      'top',
      'bottom',
    ])
    const [top, bottom] = body.children
    expect(top?.style.declared.get('top')).toBe('0')
    expect(top?.style.declared.has('bottom')).toBe(false)
    expect(top?.style.declared.get('background-color')).toBe('rgb(244, 243, 240)')
    expect(bottom?.style.declared.get('bottom')).toBe('0')
    expect(bottom?.style.declared.has('top')).toBe(false)
    expect(bottom?.style.declared.get('background-color')).toBe('rgb(255, 255, 255)')
  })

  it('keeps each tint where Safari samples it and nowhere the visitor can see or touch', () => {
    const { body } = installServedDocument()

    paintEdgeTints('rgb(36, 36, 39)', 'rgb(28, 28, 30)')

    expect(body.children).toHaveLength(2)
    for (const tint of body.children) {
      const style = tint.style.declared
      expect(tint.tagName).toBe('div')
      expect(tint.getAttribute('aria-hidden')).toBe('true')
      expect(style.get('position')).toBe('fixed')
      // Full width; Safari ignores a background on a box 10px thin or less.
      expect([style.get('left'), style.get('right')]).toEqual(['0', '0'])
      expect(px(style.get('height'))).toBeGreaterThan(10)
      // Above the folding panel (z-index 10), below the privacy banner and every dialog (30+).
      expect(Number(style.get('z-index'))).toBeGreaterThan(10)
      expect(Number(style.get('z-index'))).toBeLessThan(30)
      expect(style.get('pointer-events')).toBe('none')
      expect(style.get('mask-image')).toBe('linear-gradient(transparent, transparent)')
      expect(style.get('-webkit-mask-image')).toBe('linear-gradient(transparent, transparent)')
      expect(style.has('opacity')).toBe(false)
      expect(style.has('visibility')).toBe(false)
    }
  })

  it('replaces both tints on every paint instead of accumulating them', () => {
    const { body } = installServedDocument()
    let remove = paintEdgeTints('rgb(36, 36, 39)', 'rgb(36, 36, 39)')
    let previous = [...body.children]

    for (const [top, bottom] of [
      ['rgb(244, 243, 240)', 'rgb(244, 243, 240)'],
      ['rgb(244, 243, 240)', 'rgb(255, 255, 255)'],
      ['rgb(36, 36, 39)', 'rgb(28, 28, 30)'],
    ] as const) {
      remove()
      expect(body.children).toEqual([])
      remove = paintEdgeTints(top, bottom)
      expect(body.children).toHaveLength(2)
      expect(body.children.some((tint) => previous.includes(tint))).toBe(false)
      expect(body.children.map((tint) => tint.style.declared.get('background-color'))).toEqual([
        top,
        bottom,
      ])
      previous = [...body.children]
    }

    remove()
    expect(body.children).toEqual([])
  })
})
