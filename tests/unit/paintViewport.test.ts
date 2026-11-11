import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLayoutEffect } from 'preact/hooks'
import { LazyLoadingMessage } from '../../modules/public-web/src/ui/LazySurface'
import {
  compositeOver,
  dimViewportEdges,
  edgeTintPaint,
  paintEdgeTints,
  paintViewport,
  reportLowerEdge,
  showEdgeTints,
  type EdgeColors,
} from '../../modules/public-web/src/ui/paintViewport'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))

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

// The dialog backdrop (bookingStyles.ts `sheetBackdropStyle`) as written and as computed.
const BACKDROP = 'rgba(10,10,12,.42)'
const COMPUTED_BACKDROP = 'rgba(10, 10, 12, 0.42)'

describe('compositeOver', () => {
  it('paints the backdrop over each opaque edge colour as the opaque colour the viewer sees', () => {
    expect(
      ['#f4f3f0', '#242427', 'rgb(255, 255, 255)', 'rgb(28, 28, 30)'].map((base) =>
        compositeOver(base, [BACKDROP]),
      ),
    ).toEqual(['rgb(146, 145, 144)', 'rgb(25, 25, 28)', 'rgb(152, 152, 153)', 'rgb(20, 20, 22)'])
    expect(compositeOver('#ffffff', [COMPUTED_BACKDROP])).toBe('rgb(152, 152, 153)')
  })

  it('stacks dims in order without rounding between them', () => {
    // 4.2 + 0.58 × (4.2 + 0.58 × 244) = 88.7176 for red; one rounding at the end.
    expect(compositeOver('#f4f3f0', [BACKDROP, COMPUTED_BACKDROP])).toBe('rgb(89, 88, 89)')
    expect(compositeOver('#242427', [BACKDROP, BACKDROP])).toBe('rgb(19, 19, 21)')
    expect(compositeOver('#ffffff', [BACKDROP, BACKDROP])).toBe('rgb(92, 92, 94)')
    expect(compositeOver('#1c1c1e', [BACKDROP, BACKDROP])).toBe('rgb(16, 16, 18)')
  })

  it('reads a channel as digits with an optional fraction, or a bare fraction, and nothing else', () => {
    for (const alpha of ['0.42', '.42', ' 0.42 '])
      expect(compositeOver('#ffffff', [`rgba(10, 10, 12,${alpha})`]), alpha).toBe(
        'rgb(152, 152, 153)',
      )
    for (const alpha of ['1.', '.', '0..5', '0.4.2', '1e0', '+1', ''])
      expect(compositeOver('#ffffff', [`rgba(10, 10, 12,${alpha})`]), alpha).toBe('#ffffff')
    // Linear in its length: a quadratic pattern needs seconds for this one.
    const digits = `rgba(${'0'.repeat(200_000)}x, 0, 0, 1)`
    const started = performance.now()
    expect(compositeOver('#ffffff', [digits])).toBe('#ffffff')
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('treats a clear overlay as no dim and an opaque one as the whole colour', () => {
    expect(compositeOver('#f4f3f0', ['rgba(0, 0, 0, 0)'])).toBe('rgb(244, 243, 240)')
    expect(compositeOver('#f4f3f0', ['rgb(10, 10, 12)'])).toBe('rgb(10, 10, 12)')
  })

  it('leaves the base untouched without a dim or when a colour cannot be read', () => {
    expect(compositeOver('#f4f3f0', [])).toBe('#f4f3f0')
    for (const [base, overlay] of [
      ['#f4f3f0', 'oklch(0.2 0 0 / 0.42)'],
      ['#f4f3f0', 'rgba(10, 10, 12, 1.5)'],
      ['color(display-p3 1 1 1)', BACKDROP],
      ['rgba(244, 243, 240, 0.5)', BACKDROP],
      ['#f4f3f', BACKDROP],
      ['#fff', BACKDROP],
      ['rgb(244, 243)', BACKDROP],
    ] as const)
      expect(compositeOver(base, [overlay])).toBe(base)
  })
})

const light: EdgeColors = {
  top: 'rgb(244, 243, 240)',
  bottom: {
    panel: 'rgb(244, 243, 240)',
    section: 'rgb(255, 255, 255)',
    document: 'rgb(250, 250, 250)',
  },
}
const dark: EdgeColors = {
  top: 'rgb(36, 36, 39)',
  bottom: { panel: 'rgb(36, 36, 39)', section: 'rgb(28, 28, 30)', document: 'rgb(30, 30, 30)' },
}

describe('edgeTintPaint', () => {
  it('takes the lower colour from what meets the lower edge', () => {
    expect(
      (['panel', 'section', 'document'] as const).map((edge) => edgeTintPaint(light, edge, [])),
    ).toEqual([
      { top: 'rgb(244, 243, 240)', bottom: 'rgb(244, 243, 240)', zIndex: 20 },
      { top: 'rgb(244, 243, 240)', bottom: 'rgb(255, 255, 255)', zIndex: 20 },
      { top: 'rgb(244, 243, 240)', bottom: 'rgb(250, 250, 250)', zIndex: 20 },
    ])
  })

  it('rises one level above the topmost open dim, never below its resting level', () => {
    const dim = (zIndex: number) => ({ color: BACKDROP, zIndex })
    expect(edgeTintPaint(dark, 'section', [dim(60), dim(40)]).zIndex).toBe(61)
    expect(edgeTintPaint(dark, 'section', [dim(80)]).zIndex).toBe(81)
    expect(edgeTintPaint(dark, 'section', [dim(0)]).zIndex).toBe(20)
    expect(edgeTintPaint(dark, 'section', [dim(40)])).toEqual({
      top: 'rgb(25, 25, 28)',
      bottom: 'rgb(20, 20, 22)',
      zIndex: 41,
    })
  })
})

const painted = (body: FakeContainer) =>
  body.children.map((tint) => [
    tint.getAttribute('data-viewport-edge'),
    tint.style.declared.get('background-color'),
    tint.style.declared.get('z-index'),
  ])

describe('showEdgeTints', () => {
  it('follows the reported lower edge with fresh strips, and only when it changes', () => {
    const { body } = installServedDocument()
    const hide = showEdgeTints(light)
    expect(painted(body)).toEqual([
      ['top', 'rgb(244, 243, 240)', '20'],
      ['bottom', 'rgb(255, 255, 255)', '20'],
    ])
    let previous = [...body.children]
    for (const [edge, bottom] of [
      ['panel', 'rgb(244, 243, 240)'],
      ['section', 'rgb(255, 255, 255)'],
      ['document', 'rgb(250, 250, 250)'],
      ['panel', 'rgb(244, 243, 240)'],
    ] as const) {
      reportLowerEdge(edge)
      expect(painted(body)).toEqual([
        ['top', 'rgb(244, 243, 240)', '20'],
        ['bottom', bottom, '20'],
      ])
      expect(body.children.some((tint) => previous.includes(tint))).toBe(false)
      previous = [...body.children]
      // A repeated report (a scroll frame within the same fold state) keeps the strips.
      reportLowerEdge(edge)
      expect(body.children.filter((tint) => previous.includes(tint))).toHaveLength(2)
    }
    hide()
    expect(body.children).toEqual([])
  })

  it('keeps the lower edge across a mode switch, so the new colours apply at once', () => {
    const { body } = installServedDocument()
    reportLowerEdge('document')
    showEdgeTints(light)()
    showEdgeTints(dark)
    expect(painted(body)).toEqual([
      ['top', 'rgb(36, 36, 39)', '20'],
      ['bottom', 'rgb(30, 30, 30)', '20'],
    ])
  })

  it('composites a stack of dims above the topmost backdrop and restores each level on close', () => {
    const { body } = installServedDocument()
    reportLowerEdge('panel')
    showEdgeTints(light)
    const closeDetails = dimViewportEdges({ color: COMPUTED_BACKDROP, zIndex: 40 })
    expect(painted(body)).toEqual([
      ['top', 'rgb(146, 145, 144)', '41'],
      ['bottom', 'rgb(146, 145, 144)', '41'],
    ])
    const closeMyBookings = dimViewportEdges({ color: COMPUTED_BACKDROP, zIndex: 60 })
    expect(painted(body)).toEqual([
      ['top', 'rgb(89, 88, 89)', '61'],
      ['bottom', 'rgb(89, 88, 89)', '61'],
    ])
    closeDetails()
    expect(painted(body)).toEqual([
      ['top', 'rgb(146, 145, 144)', '61'],
      ['bottom', 'rgb(146, 145, 144)', '61'],
    ])
    const afterClose = [...body.children]
    closeDetails()
    expect(body.children.filter((tint) => afterClose.includes(tint))).toHaveLength(2)
    closeMyBookings()
    expect(painted(body)).toEqual([
      ['top', 'rgb(244, 243, 240)', '20'],
      ['bottom', 'rgb(244, 243, 240)', '20'],
    ])
  })

  it('paints nothing without shown colours, and a dim opened before them still applies', () => {
    const { body } = installServedDocument()
    reportLowerEdge('section')
    const close = dimViewportEdges({ color: BACKDROP, zIndex: 50 })
    expect(body.children).toEqual([])
    const hide = showEdgeTints(dark)
    expect(painted(body)).toEqual([
      ['top', 'rgb(25, 25, 28)', '51'],
      ['bottom', 'rgb(20, 20, 22)', '51'],
    ])
    hide()
    expect(body.children).toEqual([])
    close()
    expect(body.children).toEqual([])
    showEdgeTints(dark)
    expect(painted(body)).toEqual([
      ['top', 'rgb(36, 36, 39)', '20'],
      ['bottom', 'rgb(28, 28, 30)', '20'],
    ])
  })
})

describe('LazySurface overlay', () => {
  /** The layout effect the loading surface registers when rendered with `overlay`. */
  const overlayEffect = (overlay: boolean) => {
    vi.mocked(useLayoutEffect).mockClear()
    LazyLoadingMessage({ label: 'Laddar', overlay, minHeight: '100vh' })
    const effect = vi.mocked(useLayoutEffect).mock.calls[0]?.[0]
    if (effect === undefined) throw new Error('The loading surface registers no layout effect')
    return effect
  }

  it('dims both strips one level above the overlay while it is up', () => {
    const { body } = installServedDocument()
    reportLowerEdge('section')
    showEdgeTints(light)
    const release = overlayEffect(true)()
    expect(painted(body)).toEqual([
      ['top', 'rgb(146, 145, 144)', '81'],
      ['bottom', 'rgb(152, 152, 153)', '81'],
    ])
    if (typeof release !== 'function') throw new Error('The overlay dim has no release')
    release()
    expect(painted(body)).toEqual([
      ['top', 'rgb(244, 243, 240)', '20'],
      ['bottom', 'rgb(255, 255, 255)', '20'],
    ])
  })

  it('leaves the strips alone when the surface is inline', () => {
    const { body } = installServedDocument()
    reportLowerEdge('section')
    showEdgeTints(light)
    const before = [...body.children]
    expect(overlayEffect(false)()).toBeUndefined()
    expect(body.children.filter((tint) => before.includes(tint))).toHaveLength(2)
  })
})
