import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBookingStyles,
  palette,
  sheetBackdropStyle,
} from '../../modules/public-web/src/booking/bookingStyles'
import type { HomeScreenGuideProps } from '../../modules/public-web/src/onboarding/HomeScreenGuide'
import { nodes, type RenderedNode } from './helpers/fakeHooks'

// The home-screen guide as the design spec (section 3) and the decided steps lay it out, and the
// ways out of it. Each render here is a fresh mount; the page-load record lives in the module.

const frame = vi.hoisted(() => ({ value: null as null | { readonly source: boolean } }))
vi.mock('preact/hooks', () => ({
  useState: (initial: unknown) => [
    typeof initial === 'function' ? initial() : initial,
    () => undefined,
  ],
  useContext: () => frame.value,
}))
vi.mock('../../modules/public-web/src/ui/Dialog', () => ({ Dialog: () => null }))

const safari = (version: string): string =>
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 ' +
  `(KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`
const CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'

interface Visit {
  readonly userAgent?: string
  readonly standalone?: boolean
}

function visit({ userAgent = safari('27.0'), standalone }: Visit = {}): void {
  vi.stubGlobal('navigator', standalone === undefined ? { userAgent } : { userAgent, standalone })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
}

async function guide() {
  vi.resetModules()
  const module = await import('../../modules/public-web/src/onboarding/HomeScreenGuide')
  const onClose = vi.fn()
  const render = (overrides: Partial<HomeScreenGuideProps> = {}): RenderedNode | null =>
    module.HomeScreenGuide({
      mode: 'light',
      lang: 'sv',
      businessName: 'Blade & Blend Studio',
      bookings: 3,
      onClose,
      ...overrides,
    })
  return { render, onClose }
}

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''
  return text((node as RenderedNode).props?.children)
}

function shown(root: RenderedNode | null): RenderedNode {
  if (root === null) throw new Error('The guide rendered nothing')
  return root
}

const all = (root: RenderedNode | null): RenderedNode[] => nodes(shown(root))
const byType = (root: RenderedNode | null, type: string): RenderedNode[] =>
  all(root).filter((node) => node.type === type)

/** Each step as its number, its words with Apple's labels in `**`, and its glyph. */
function steps(root: RenderedNode | null): string[][] {
  return byType(root, 'li').map((row) => {
    const [badge, words, tile] = row.props.children as readonly (RenderedNode | null)[]
    const parts = ([words?.props.children].flat(2) as readonly unknown[]).map((part) =>
      typeof part === 'string' ? part : `**${text(part)}**`,
    )
    const glyph =
      tile === null
        ? 'none'
        : String(nodes(tile).find((node) => node.props['glyph'])?.props['glyph'])
    return [text(badge), parts.join(''), glyph]
  })
}

const click = (node: RenderedNode | undefined): void => (node?.props['onClick'] as () => void)()
const WAYS_OUT = [
  ['the × button', (root: RenderedNode) => click((root.props.children as RenderedNode[])[0])],
  [
    'the Okej button',
    (root: RenderedNode) => click(nodes((root.props.children as RenderedNode[])[4])[1]),
  ],
  ['Escape', (root: RenderedNode) => (root.props['onClose'] as () => void)()],
  [
    'a click on the backdrop',
    (root: RenderedNode) => {
      const backdrop = {}
      ;(root.props['onBackdropClick'] as (event: unknown) => void)({
        target: backdrop,
        currentTarget: backdrop,
      })
    },
  ],
] as const

/** A device with this consent cookie: its localStorage a map, sessionStorage and cookie writes spied. */
function deviceWith(cookie: string) {
  const local = new Map<string, string>()
  const session = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
  const cookieWrites = vi.fn()
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => {
        local.set(key, value)
      },
      removeItem: (key: string) => {
        local.delete(key)
      },
    },
  })
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('document', {
    get cookie() {
      return cookie
    },
    set cookie(value: string) {
      cookieWrites(value)
    },
  })
  return { local: () => [...local], session, cookieWrites }
}

beforeEach(() => {
  frame.value = null
  visit()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const STEPS_A_SV = [
  ['1', 'Tryck på symbolen till vänster i adressfältet', 'page-menu'],
  ['2', 'Välj **Dela**', 'share'],
  ['3', 'Rulla ned och välj **Lägg till på hemskärmen**', 'add-to-home-screen'],
  ['4', 'Låt **Öppna som webbapp** vara på och tryck på **Lägg till**', 'none'],
]
const STEPS_A_EN = [
  ['1', 'Tap the icon at the left of the address field', 'page-menu'],
  ['2', 'Choose **Share**', 'share'],
  ['3', 'Scroll down and choose **Add to Home Screen**', 'add-to-home-screen'],
  ['4', 'Leave **Open as Web App** on and tap **Add**', 'none'],
]

describe('home-screen guide content', () => {
  it.each([
    ['27.0', 'sv', STEPS_A_SV],
    ['27.0', 'en', STEPS_A_EN],
    [
      '26.0',
      'sv',
      [
        ['1', 'Tryck på knappen med tre punkter till höger om adressfältet', 'more'],
        ...STEPS_A_SV.slice(1),
      ],
    ],
    [
      '26.0',
      'en',
      [
        ['1', 'Tap the button with three dots to the right of the address field', 'more'],
        ...STEPS_A_EN.slice(1),
      ],
    ],
    [
      '18.6',
      'sv',
      [
        ['1', 'Tryck på **Dela** längst ned i Safari', 'share'],
        ['2', 'Rulla ned och välj **Lägg till på hemskärmen**', 'add-to-home-screen'],
        ['3', 'Tryck på **Lägg till**', 'none'],
      ],
    ],
    [
      '18.6',
      'en',
      [
        ['1', 'Tap **Share** at the bottom of Safari', 'share'],
        ['2', 'Scroll down and choose **Add to Home Screen**', 'add-to-home-screen'],
        ['3', 'Tap **Add**', 'none'],
      ],
    ],
  ] as const)('lists the steps for Safari %s in %s', async (version, lang, expected) => {
    visit({ userAgent: safari(version) })
    const { render } = await guide()
    expect(steps(render({ lang }))).toEqual(expected)
  })

  it.each([
    ['27.0', 'sv', 'Syns delningssymbolen redan längst ned i Safari? Börja på steg 2.'],
    ['26.0', 'sv', 'Syns delningssymbolen redan längst ned i Safari? Börja på steg 2.'],
    ['27.0', 'en', 'Is the Share icon already at the bottom of Safari? Start at step 2.'],
    ['26.0', 'en', 'Is the Share icon already at the bottom of Safari? Start at step 2.'],
    ['18.6', 'sv', null],
    ['18.6', 'en', null],
  ] as const)('gives Safari %s in %s its footnote: %s', async (version, lang, footnote) => {
    visit({ userAgent: safari(version) })
    const { render } = await guide()
    const notes = byType(render({ lang }), 'p')
    expect(notes.map(text)).toEqual(footnote === null ? [] : [footnote])
  })

  it.each([
    [
      'sv',
      'Lägg till på hemskärmen',
      'Då har du Blade & Blend Studio ett tryck bort och bokar nästa tid snabbare.',
      'Okej',
      'Stäng',
    ],
    [
      'en',
      'Add to your Home Screen',
      'Keep Blade & Blend Studio one tap away and book your next appointment faster.',
      'Got it',
      'Close',
    ],
  ] as const)('heads the guide in %s', async (lang, title, sub, ok, close) => {
    const { render } = await guide()
    const root = render({ lang })
    const [closeButton, hero, , , footer] = shown(root).props.children as readonly RenderedNode[]
    const [tile, name, heading, subLine] = hero?.props.children as readonly RenderedNode[]
    expect(tile?.props).toMatchObject({
      src: '/apple-touch-icon.png',
      alt: '',
      class: 'knc-guide-tile',
    })
    expect(text(name)).toBe('Blade & Blend Studio')
    expect(heading?.props).toMatchObject({
      id: 'knc-home-screen-title',
      role: 'heading',
      'aria-level': 2,
    })
    expect(text(heading)).toBe(title)
    expect(text(subLine)).toBe(sub)
    expect(closeButton?.props['aria-label']).toBe(close)
    expect(text(closeButton)).toBe('×')
    expect(text(footer)).toBe(ok)
  })

  it.each([
    ['light', 'sv'],
    ['dark', 'en'],
  ] as const)(
    'uses the booking sheets in %s mode, themed for that mode and %s',
    async (mode, lang) => {
      const { render } = await guide()
      const root = shown(render({ mode, lang }))
      const s = buildBookingStyles(palette(mode === 'dark'), mode === 'dark', false)
      expect(root.props).toMatchObject({
        titleId: 'knc-home-screen-title',
        backdropClass: 'knc-sheet-backdrop',
        backdropStyle: sheetBackdropStyle(40),
        cardClass: 'knc-sheet-card',
        cardStyle: s.overlayCardStyle,
      })
      // The surface name the dialog would take anyway; only the theme's mode and language change.
      expect(root.props['cms']).toEqual({ surface: 'dialog-knc-home-screen-title', lang, mode })
      const [closeButton, , , , footer] = root.props.children as readonly RenderedNode[]
      expect(closeButton?.props['style']).toEqual(s.confirmCloseStyle)
      expect(nodes(footer)[1]?.props['style']).toEqual(s.resetBtnStyle)
      for (const row of byType(root, 'li'))
        expect((row.props.children as readonly RenderedNode[])[0]?.props['style']).toEqual(
          s.badgeStyle,
        )
    },
  )
})

describe('home-screen guide design values', () => {
  it('lays out the hero, the steps box and the footer as specified', async () => {
    const c = palette(false)
    const { render } = await guide()
    const root = shown(render())
    const [, hero, list, footnote, footer] = root.props.children as readonly RenderedNode[]
    const [tile, name, heading, sub] = hero?.props.children as readonly RenderedNode[]
    expect(hero?.props['style']).toEqual({ padding: '28px 22px 18px', textAlign: 'center' })
    expect(tile?.props['style']).toEqual({
      width: '64px',
      height: '64px',
      borderRadius: '15px',
      boxShadow: `0 6px 16px rgba(0,0,0,.18), 0 0 0 .5px ${c.line}`,
      display: 'block',
      margin: '0 auto',
    })
    expect(name?.props['style']).toEqual({
      fontSize: '11px',
      fontWeight: 500,
      opacity: 0.75,
      margin: '6px 0 16px',
    })
    expect(heading?.props['style']).toEqual({
      fontFamily: "'Inter Variable'",
      fontWeight: 600,
      fontSize: '20px',
      marginBottom: '6px',
    })
    expect(sub?.props['style']).toEqual({
      fontSize: '13.5px',
      opacity: 0.6,
      lineHeight: 1.45,
      maxWidth: '300px',
      margin: '0 auto',
    })
    expect(list?.type).toBe('ol')
    expect(list?.props).toMatchObject({
      role: 'list',
      style: {
        margin: '0 18px',
        padding: 0,
        listStyle: 'none',
        background: c.subtle,
        borderRadius: '12px',
        overflow: 'hidden',
      },
    })
    const row = { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px' }
    expect(byType(root, 'li').map((li) => [li.props['class'], li.props['style']])).toEqual([
      ['knc-guide-step', { ...row, animationDelay: '180ms' }],
      ['knc-guide-step', { ...row, borderTop: `.5px solid ${c.line}`, animationDelay: '250ms' }],
      ['knc-guide-step', { ...row, borderTop: `.5px solid ${c.line}`, animationDelay: '320ms' }],
      ['knc-guide-step', { ...row, borderTop: `.5px solid ${c.line}`, animationDelay: '390ms' }],
    ])
    const [, words, tileBox] = byType(root, 'li')[1]?.props.children as readonly RenderedNode[]
    expect(words?.props['style']).toEqual({
      flex: 1,
      fontSize: '14px',
      fontWeight: 500,
      lineHeight: 1.35,
      textAlign: 'left',
    })
    expect(byType(root, 'b').map((label) => label.props['style'])).toContainEqual({
      fontWeight: 600,
    })
    expect(tileBox?.props['style']).toEqual({
      width: '30px',
      height: '30px',
      borderRadius: '8px',
      background: c.bg,
      boxShadow: `0 0 0 .5px ${c.line}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 'none',
    })
    expect(nodes(tileBox).find((node) => node.props['glyph'])?.props['style']).toEqual({
      color: c.text,
    })
    expect(footnote?.props['style']).toEqual({
      margin: '10px 22px 0',
      fontSize: '12px',
      lineHeight: 1.45,
      opacity: 0.55,
      textAlign: 'center',
      textWrap: 'balance',
    })
    expect(footer?.props['style']).toEqual({ padding: '16px 18px 18px' })
  })

  it.each([
    ['page-menu', [['path', { d: 'M4 7h16M4 12h16M4 17h10' }]]],
    [
      'more',
      [5, 12, 19].map((cx) => [
        'circle',
        { cx, cy: '12', r: '1.4', fill: 'currentColor', stroke: 'none' },
      ]),
    ],
    [
      'share',
      [
        [
          'path',
          { d: 'M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1' },
        ],
        ['path', { d: 'M12 14V3M8.5 6.5 12 3l3.5 3.5' }],
      ],
    ],
    [
      'add-to-home-screen',
      [
        ['rect', { x: '4', y: '4', width: '16', height: '16', rx: '4' }],
        ['path', { d: 'M12 8.5v7M8.5 12h7' }],
      ],
    ],
  ] as const)('draws the %s glyph', async (glyph, shapes) => {
    vi.resetModules()
    const { GlyphIcon } = await import('../../modules/public-web/src/onboarding/glyphs')
    const svg = GlyphIcon({ glyph, style: { color: '#123' } }) as unknown as RenderedNode
    expect(svg.type).toBe('svg')
    expect(svg.props).toMatchObject({
      viewBox: '0 0 24 24',
      width: '18',
      height: '18',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      style: { color: '#123' },
    })
    const drawn = nodes(svg.props.children).filter((node) => typeof node.type === 'string')
    expect(
      drawn.map((node) => [
        node.type,
        Object.fromEntries(Object.entries(node.props).filter(([key]) => key !== 'children')),
      ]),
    ).toEqual(shapes)
  })
})

describe('home-screen guide visits', () => {
  it.each([
    ['the × button', (root: RenderedNode) => (shown(root).props.children as RenderedNode[])[0]],
    [
      'the Okej button',
      (root: RenderedNode) => nodes((shown(root).props.children as RenderedNode[])[4])[1],
    ],
  ])('closes once through %s, and not again in this page load', async (_label, control) => {
    const { render, onClose } = await guide()
    const button = control(shown(render()))
    ;(button?.props['onClick'] as () => void)()
    expect(onClose).toHaveBeenCalledOnce()
    expect(render()).toBeNull()
  })

  it('closes through Escape (the dialog’s own close) and on the backdrop itself only', async () => {
    const { render, onClose } = await guide()
    const root = shown(render())
    const backdrop = {}
    ;(root.props['onBackdropClick'] as (event: unknown) => void)({
      target: {},
      currentTarget: backdrop,
    })
    expect(onClose).not.toHaveBeenCalled()
    ;(root.props['onBackdropClick'] as (event: unknown) => void)({
      target: backdrop,
      currentTarget: backdrop,
    })
    expect(onClose).toHaveBeenCalledOnce()
    expect(render()).toBeNull()

    const again = await guide()
    ;(shown(again.render()).props['onClose'] as () => void)()
    expect(again.onClose).toHaveBeenCalledOnce()
    expect(again.render()).toBeNull()
  })

  it.each(WAYS_OUT)(
    'with optional storage on, leaves exactly its note when closed through %s; a later page load shows nothing',
    async (_label, leave) => {
      const device = deviceWith('bladeblend_storage_preferences=functional')
      const { render } = await guide()
      leave(shown(render()))
      expect(device.local()).toEqual([['bladeblend_home_screen_guide', 'shown']])
      expect(device.session.setItem).not.toHaveBeenCalled()
      expect(device.cookieWrites).not.toHaveBeenCalled()
      expect((await guide()).render()).toBeNull()
    },
  )

  it.each([
    ['essential storage only', 'bladeblend_storage_preferences=essential'],
    ['no storage choice yet', ''],
  ])('with %s, stores nothing, so a later page load shows it again', async (_label, cookie) => {
    const device = deviceWith(cookie)
    const { render } = await guide()
    ;(shown(render()).props['onClose'] as () => void)()
    expect(device.local()).toEqual([])
    expect(device.session.setItem).not.toHaveBeenCalled()
    expect(device.cookieWrites).not.toHaveBeenCalled()
    expect((await guide()).render()).not.toBeNull()
  })

  it('counts a storage that throws as no note, and still closes for this page load', async () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
      get localStorage(): Storage {
        throw new Error('SecurityError: the operation is insecure')
      },
    })
    vi.stubGlobal('document', { cookie: 'bladeblend_storage_preferences=functional' })
    const { render, onClose } = await guide()
    const root = shown(render())
    expect(() => (root.props['onClose'] as () => void)()).not.toThrow()
    expect(onClose).toHaveBeenCalledOnce()
    expect(render()).toBeNull()
  })

  it.each([
    ['in Chrome on iPhone', { userAgent: CHROME }, 3],
    ['from the Home Screen', { standalone: true }, 3],
    ['with two bookings', {}, 2],
  ] as const)('renders nothing %s', async (_label, arrival, bookings) => {
    visit(arrival)
    const { render, onClose } = await guide()
    expect(render({ bookings })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders nothing in a Studio source or capture frame', async () => {
    frame.value = { source: true }
    const { render } = await guide()
    expect(render()).toBeNull()
  })
})
