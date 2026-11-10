import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { generate, parse as parseCss, walk, type CssNode } from 'css-tree'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BUSINESS } from '../../modules/public-web/src/site/business'
import worker, { PublicContent } from '../../supabase/worker/index'

// The plain files the site serves: static pages, icons, manifest, public/info.css's skip link and
// paper styles, and the social defaults (checklist items 1, 11, 39, 43 and 91).

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const file = (path: string): URL => new URL(`../../${path}`, import.meta.url)
const read = (path: string): string => readFileSync(file(path), 'utf8')
const flat = (value: string): string => value.replace(/\s+/g, ' ').trim()

const elements = (node: Node): Element[] => [
  ...('tagName' in node ? [node] : []),
  ...('childNodes' in node ? node.childNodes.flatMap(elements) : []),
]
const attr = (element: Element, name: string): string | undefined =>
  element.attrs.find((item) => item.name === name)?.value
const text = (node: Node): string =>
  'value' in node && node.nodeName === '#text'
    ? node.value
    : 'childNodes' in node
      ? node.childNodes.map(text).join('')
      : ''
const tagged = (all: readonly Element[], tag: string): Element[] =>
  all.filter((element) => element.tagName === tag)
/** The only element `predicate` accepts. */
function only(all: readonly Element[], predicate: (element: Element) => boolean): Element {
  const found = all.filter(predicate)
  if (found.length !== 1 || !found[0])
    throw new Error(`Expected one element, found ${found.length}`)
  return found[0]
}
const metaContent = (all: readonly Element[], name: string, value: string): string | undefined =>
  all
    .filter((element) => element.tagName === 'meta' && attr(element, name) === value)
    .map((element) => attr(element, 'content'))[0]

const STATIC_PAGES = [
  '404',
  '500',
  'maintenance',
  'contact',
  'terms',
  'privacy',
  'google-calendar',
] as const
const document = (name: (typeof STATIC_PAGES)[number]): Element[] =>
  elements(parse(read(`public/${name}.html`)))
const shell = (): Element[] => elements(parse(read('index.html')))

/** The pixels of an 8-bit RGB or RGBA PNG without interlacing, as Chromium's screenshots are. */
function decodePng(png: Buffer): {
  readonly width: number
  readonly height: number
  /** No pixel lets anything through: there is no alpha channel, or it is 255 throughout. */
  readonly opaque: boolean
  /** Red, green, blue and alpha as eight hex digits; `ff` where the image has no alpha channel. */
  readonly pixel: (x: number, y: number) => string
} {
  const data: Buffer[] = []
  let width = 0
  let height = 0
  let channels = 0
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    const type = png.toString('latin1', at + 4, at + 8)
    const chunk = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      const colourType = chunk.readUInt8(9)
      expect([chunk.readUInt8(8), chunk.readUInt8(12)], 'bit depth and interlace').toEqual([8, 0])
      expect([2, 6], 'colour type').toContain(colourType)
      channels = colourType === 6 ? 4 : 3
    } else if (type === 'IDAT') data.push(chunk)
    at += 12 + length
  }
  const stride = width * channels
  const filtered = inflateSync(Buffer.concat(data))
  const pixels = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = filtered.readUInt8(y * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels.readUInt8(y * stride + x - channels) : 0
      const up = y > 0 ? pixels.readUInt8((y - 1) * stride + x) : 0
      const upLeft = x >= channels && y > 0 ? pixels.readUInt8((y - 1) * stride + x - channels) : 0
      const nearest = [left, up, upLeft]
        .map((value) => ({ value, distance: Math.abs(left + up - upLeft - value) }))
        .reduce((best, next) => (next.distance < best.distance ? next : best)).value
      const predicted = [0, left, up, (left + up) >> 1, nearest][filter]
      if (predicted === undefined) throw new Error(`Unknown PNG filter ${filter}`)
      pixels.writeUInt8(
        (filtered.readUInt8(y * (stride + 1) + 1 + x) + predicted) & 255,
        y * stride + x,
      )
    }
  }
  return {
    width,
    height,
    opaque:
      channels === 3 ||
      pixels.every((value: number, index: number) => index % 4 !== 3 || value === 255),
    pixel: (x, y) =>
      pixels.toString('hex', y * stride + x * channels, y * stride + (x + 1) * channels) +
      (channels === 3 ? 'ff' : ''),
  }
}

interface StyleRule {
  readonly selector: string
  /** The media query the rule sits in; null at the top level. */
  readonly media: string | null
  readonly declarations: ReadonlyMap<string, string>
}

/** Every style rule of `css`, one entry per selector of a selector list. */
function styleRules(css: string): StyleRule[] {
  const rules: StyleRule[] = []
  const media: string[] = []
  walk(parseCss(css), {
    enter(node: CssNode) {
      if (node.type === 'Atrule' && node.name === 'media')
        media.push(node.prelude === null ? '' : generate(node.prelude))
      if (node.type !== 'Rule') return
      const declarations = new Map<string, string>()
      walk(node.block, {
        visit: 'Declaration',
        enter(declaration) {
          declarations.set(declaration.property, generate(declaration.value).trim())
        },
      })
      for (const selector of generate(node.prelude).split(','))
        rules.push({ selector, media: media.at(-1) ?? null, declarations })
    },
    leave(node: CssNode) {
      if (node.type === 'Atrule' && node.name === 'media') media.pop()
    },
  })
  return rules
}

const ICON_LINKS = [
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  { rel: 'manifest', href: '/site.webmanifest' },
]
/** The shell's light theme-color (index.html): the surface of the one opaque icon. */
const lightSurface = (): string => {
  const colour = shell()
    .filter(
      (element) =>
        element.tagName === 'meta' &&
        attr(element, 'name') === 'theme-color' &&
        attr(element, 'media') === '(prefers-color-scheme: light)',
    )
    .map((element) => attr(element, 'content'))[0]
  if (colour === undefined) throw new Error('index.html has no light theme-color')
  return colour
}

describe('site icons and web app manifest', () => {
  it.each(['index.html', ...STATIC_PAGES.map((name) => `public/${name}.html`)])(
    '%s links the SVG icon first, then the ICO, the touch icon and the manifest',
    (path) => {
      const links = tagged(elements(parse(read(path))), 'link')
        .map((link) => Object.fromEntries(link.attrs.map(({ name, value }) => [name, value])))
        .filter(({ rel }) => ICON_LINKS.some((link) => link.rel === rel))
      expect(links).toEqual(ICON_LINKS)
      for (const { href } of ICON_LINKS) expect(existsSync(file(`public${href}`)), href).toBe(true)
    },
  )

  // No colour member: the static documents have no theme-color of their own, so a manifest colour
  // could tint a browser's chrome or first paint light over a page shown in the dark scheme.
  it('describes the site and its two icons in the manifest, and names no colour', () => {
    const manifest = JSON.parse(read('public/site.webmanifest')) as unknown
    expect(manifest).toEqual({
      name: DEFAULT_BUSINESS.name,
      short_name: DEFAULT_BUSINESS.name,
      lang: 'sv',
      start_url: '/',
      scope: '/',
      display: 'browser',
      icons: [192, 512].map((size) => ({
        src: `/icons/icon-${size}.png`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: 'any',
      })),
    })
  })

  // The rasters are generated by tools/brand/render-icons.mjs. `mark` is the share of the canvas the
  // SVG's 64-unit box takes; the probe is a pixel inside the pole's outline, left of its body.
  it.each([
    { path: 'public/icons/icon-192.png', size: 192, mark: 1, opaque: false },
    { path: 'public/icons/icon-512.png', size: 512, mark: 1, opaque: false },
    { path: 'public/apple-touch-icon.png', size: 180, mark: 0.8, opaque: true },
  ])('$path is the favicon mark at $size px', ({ path, size, mark, opaque }) => {
    const outline = /<rect x="16\.5" y="10\.5"[^>]*fill="#([0-9a-f]{6})"/.exec(
      read('public/favicon.svg'),
    )?.[1]
    expect(outline, 'the outline colour of public/favicon.svg').toBeDefined()
    const image = decodePng(readFileSync(file(path)))
    expect([image.width, image.height]).toEqual([size, size])
    const at = (unit: number): number =>
      Math.floor((size * (1 - mark)) / 2 + (unit * size * mark) / 64)
    expect(image.pixel(at(17.25), at(32))).toBe(`${outline}ff`)
    // iOS paints transparency black, so the touch icon is opaque on the shell's light theme colour,
    // however its encoder stores that; the others are transparent around the mark.
    expect(image.opaque).toBe(opaque)
    for (const [x, y] of [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ] as const)
      expect(image.pixel(x, y)).toBe(opaque ? `${lightSurface().slice(1)}ff` : '00000000')
  })

  it('takes the surface of the opaque icon from the shell, in the generator too', () => {
    // tools/brand/render-icons.mjs reads the same tag as lightSurface() and names no colour itself.
    const generator = read('tools/brand/render-icons.mjs')
    expect(generator).toContain("new URL('../../index.html', import.meta.url)")
    expect(generator).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(lightSurface()).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('wraps one 32 px PNG in favicon.ico', () => {
    const ico = readFileSync(file('public/favicon.ico'))
    // ICONDIR: reserved, type 1 (icon), one image. ICONDIRENTRY: 32 by 32, then size and offset.
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1])
    expect([ico.readUInt8(6), ico.readUInt8(7)]).toEqual([32, 32])
    expect([ico.readUInt32LE(14), ico.readUInt32LE(18)]).toEqual([ico.length - 22, 22])
    const image = decodePng(ico.subarray(22))
    expect([image.width, image.height]).toEqual([32, 32])
    expect(image.pixel(0, 0)).toBe('00000000')
    expect(image.pixel(16, 16).slice(6)).toBe('ff')
  })
})

describe('error and maintenance documents', () => {
  const contactLinks = (all: readonly Element[]): string[] =>
    tagged(all, 'a')
      .filter((link) => /^(?:tel|mailto):/.test(attr(link, 'href') ?? ''))
      .map((link) => `${attr(link, 'href')} ${flat(text(link))}`)
      .sort()

  it.each(['500', 'maintenance'] as const)(
    '%s.html is a complete bilingual document without script',
    (name) => {
      const source = read(`public/${name}.html`)
      const all = document(name)
      expect(source.startsWith('<!doctype html>\n<html lang="sv">')).toBe(true)
      expect(source).toContain('<meta charset="utf-8" />')
      expect(metaContent(all, 'name', 'viewport')).toBe('width=device-width, initial-scale=1')
      expect(metaContent(all, 'name', 'robots')).toBe('noindex, nofollow')
      expect(flat(text(only(all, (element) => element.tagName === 'title')))).toContain(
        DEFAULT_BUSINESS.name,
      )
      const main = only(all, (element) => element.tagName === 'main')
      expect(tagged(all, 'h1')).toHaveLength(1)
      expect(tagged(elements(main), 'h1')).toHaveLength(1)
      const ids = all.flatMap((element) => attr(element, 'id') ?? [])
      expect(new Set(ids).size).toBe(ids.length)
      const english = only(elements(main), (element) => attr(element, 'lang') === 'en')
      expect(english.tagName).toBe('p')
      // A way home in each language.
      for (const part of [main, english])
        expect(tagged(elements(part), 'a').map((link) => attr(link, 'href'))).toContain('/')
      for (const tag of ['script', 'style', 'img', 'iframe', 'object', 'embed', 'form'])
        expect(tagged(all, tag), tag).toEqual([])
      expect(all.filter((element) => attr(element, 'style') !== undefined)).toEqual([])
    },
  )

  it.each(['500', 'maintenance'] as const)(
    '%s.html loads only files the asset layer serves without the Worker',
    (name) => {
      const all = document(name)
      expect(all.filter((element) => attr(element, 'src') !== undefined)).toEqual([])
      const linked = [...ICON_LINKS.map(({ href }) => href), '/tokens.css', '/info.css']
      expect(tagged(all, 'link').map((link) => attr(link, 'href'))).toEqual(linked)
      // Every other URL is a link the visitor follows: home, the skip target, phone and e-mail.
      for (const link of tagged(all, 'a'))
        expect(attr(link, 'href')).toMatch(/^(?:\/|#main|tel:[0-9]+|mailto:[^@\s]+@[^@\s]+)$/)
      // Each linked file, and the font the two sheets name, is excluded from the Worker.
      const source = read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')
      const config = JSON.parse(source.replace(/,\s*([}\]])/g, '$1')) as {
        readonly assets: { readonly run_worker_first: readonly string[] }
      }
      for (const path of [...linked, '/fonts/*'])
        expect(config.assets.run_worker_first).toContain(`!${path}`)
      const urls: string[] = []
      for (const sheet of ['public/tokens.css', 'public/info.css'])
        walk(parseCss(read(sheet)), { visit: 'Url', enter: (node) => void urls.push(node.value) })
      expect(urls).toEqual(['/fonts/InterVariable-Latin.woff2'])
      for (const url of urls) expect(existsSync(file(`public${url}`)), url).toBe(true)
    },
  )

  it.each(['500', 'maintenance'] as const)(
    '%s.html gives the phone and e-mail the Contact page holds, in both languages',
    (name) => {
      const contact = document('contact')
      const defaults = contactLinks(
        elements(only(contact, (element) => attr(element, 'id') === 'contact-details')),
      )
      expect(defaults).toHaveLength(2)
      const all = document(name)
      const main = only(all, (element) => element.tagName === 'main')
      const english = only(elements(main), (element) => attr(element, 'lang') === 'en')
      expect(contactLinks(elements(english))).toEqual(defaults)
      expect([...new Set(contactLinks(all))]).toEqual(defaults)
      expect(contactLinks(all)).toHaveLength(4)
    },
  )
})

describe('skip link of the static documents', () => {
  const focusable = (element: Element): boolean =>
    (element.tagName === 'a' && attr(element, 'href') !== undefined) ||
    ['button', 'input', 'select', 'textarea', 'summary'].includes(element.tagName) ||
    (attr(element, 'tabindex') !== undefined && attr(element, 'tabindex') !== '-1')

  it.each([
    ['404', 'Hoppa till innehållet / Skip to content'],
    ['500', 'Hoppa till innehållet / Skip to content'],
    ['maintenance', 'Hoppa till innehållet / Skip to content'],
    ['google-calendar', 'Skip to content'],
  ] as const)('%s.html starts with a skip link to its main', (name, label) => {
    const all = document(name)
    const body = elements(only(all, (element) => element.tagName === 'body'))
    const [first] = body.filter(focusable)
    if (!first) throw new Error('The document has no focusable element')
    expect(first.attrs).toEqual([
      { name: 'class', value: 'bb-skip bb-btn' },
      { name: 'href', value: '#main' },
    ])
    expect(flat(text(first))).toBe(label)
    // The words of the other language are marked as such.
    const root = only(all, (element) => element.tagName === 'html')
    expect(
      tagged(elements(first), 'span').map((span) => [attr(span, 'lang'), flat(text(span))]),
    ).toEqual(attr(root, 'lang') === 'en' ? [] : [['en', 'Skip to content']])
    const target = only(all, (element) => attr(element, 'id') === 'main')
    expect(target).toBe(only(all, (element) => element.tagName === 'main'))
    expect(attr(target, 'tabindex')).toBe('-1')
  })

  it('keeps the link above the viewport until it has focus', () => {
    const rules = styleRules(read('public/info.css')).filter(({ media }) => media === null)
    const declared = (selector: string): ReadonlyMap<string, string> | undefined =>
      rules.find((rule) => rule.selector === selector)?.declarations
    expect(declared('.bb-skip')?.get('position')).toBe('absolute')
    expect(declared('.bb-skip')?.get('transform')).toBe('translateY(-200%)')
    expect(declared('.bb-skip:focus')?.get('transform')).toBe('none')
    // Its target is focusable only to receive that focus, and draws no ring around the document.
    expect(declared('.bb-doc:focus')?.get('outline')).toBe('none')
  })
})

describe('paper styles of the static documents', () => {
  const rules = styleRules(read('public/info.css'))
  const print = rules.filter(({ media }) => media === 'print')
  const PAPER = new Map([
    ['--bb-bg', '#fff'],
    ['--bb-text', '#000'],
    ['--bb-muted', '#000'],
    ['--bb-line', '#000'],
    ['--bb-surface', '#fff'],
  ])

  it('prints black on white, without the navigation and with link addresses', () => {
    expect(print.find(({ selector }) => selector === ':root')?.declarations).toEqual(PAPER)
    // Only the document's own breadcrumb and footer: this file is inlined into CMS pages, where a
    // nav or footer further in is the owner's content.
    expect(
      print
        .filter(({ declarations }) => declarations.get('display') === 'none')
        .map(({ selector }) => selector),
    ).toEqual(['.bb-skip', '.bb-doc>nav', '.bb-doc>footer'])
    // Every shipped document keeps its breadcrumb and footer there, the Studio's English Contact
    // template included.
    const shipped = [
      ...STATIC_PAGES.map((name) => `public/${name}.html`),
      'modules/studio/src/contact.en.html',
    ]
    for (const path of shipped) {
      const all = elements(parse(read(path)))
      const main = only(all, (element) => element.tagName === 'main')
      for (const element of all.filter(({ tagName }) => tagName === 'nav' || tagName === 'footer'))
        expect(element.parentNode, `${path}: <${element.tagName}>`).toBe(main)
    }
    const addresses = print.filter(({ selector }) => selector.endsWith('::after'))
    expect(addresses.map(({ selector }) => selector)).toEqual([
      '.bb-doc a[href^="/"]::after',
      '.bb-doc a[href^="http"]::after',
    ])
    for (const { declarations } of addresses)
      expect(declarations.get('content')).toContain('attr(href)')
    const page: string[] = []
    walk(parseCss(read('public/info.css')), {
      visit: 'Atrule',
      enter(node) {
        if (node.name !== 'page' || node.block === null) return
        walk(node.block, { visit: 'Declaration', enter: (item) => void page.push(item.property) })
      },
    })
    expect(page).toEqual(['margin'])
  })

  // public/info.css before the skip link and paper styles (`git show 93ff3298:public/info.css`):
  // those bytes still open the file, so everything added since comes after them.
  const EARLIER = {
    bytes: 1550,
    sha256: '95d68144ad1f9d9a19e5f3f72f22a665332394dcb20c4877052be9a2f28cc7c3',
  }
  // All that the addition may hold outside `@media print` and `@page`: rules that match nothing but
  // the skip link and a document that has focus.
  const ON_SCREEN = [
    [
      '.bb-skip',
      [
        'position: absolute',
        'top: 0.75rem',
        'left: 0.75rem',
        'max-width: calc(100% - 1.5rem)',
        'transform: translateY(-200%)',
      ],
    ],
    [
      '.bb-skip:focus',
      ['transform: none', 'outline: 3px solid var(--bb-text)', 'outline-offset: 4px'],
    ],
    ['.bb-doc:focus', ['outline: none']],
  ]

  it('changes nothing on screen: outside print it adds only the skip link rules', () => {
    const sheet = readFileSync(file('public/info.css'))
    expect(
      createHash('sha256').update(sheet.subarray(0, EARLIER.bytes)).digest('hex'),
      'the rules the documents had before',
    ).toBe(EARLIER.sha256)
    const added = parseCss(sheet.subarray(EARLIER.bytes).toString('utf8'))
    if (added.type !== 'StyleSheet') throw new Error('The addition is not a style sheet')
    // Every other at-rule, a media query that is not exactly `print` included, applies on screen.
    const paper = (node: CssNode): boolean =>
      node.type === 'Atrule' &&
      (node.name === 'page' ||
        (node.name === 'media' && node.prelude !== null && generate(node.prelude) === 'print'))
    const onScreen = added.children
      .toArray()
      .filter((node) => !paper(node))
      .map((node) =>
        node.type === 'Rule'
          ? [
              generate(node.prelude),
              node.block.children
                .toArray()
                .map((item) =>
                  item.type === 'Declaration'
                    ? `${item.property}: ${generate(item.value).trim()}${item.important ? ' !important' : ''}`
                    : generate(item),
                ),
            ]
          : generate(node),
      )
    expect(onScreen).toEqual(ON_SCREEN)
  })

  it('redefines every colour token the documents paint with', () => {
    const sources = [
      read('public/info.css'),
      ...STATIC_PAGES.map((name) => read(`public/${name}.html`)),
    ]
    const used = new Set(
      sources.flatMap((source) =>
        [...source.matchAll(/var\((--bb-[a-z-]+)/g)].map((match) => match[1] ?? ''),
      ),
    )
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter((token) => token !== '--bb-font' && !PAPER.has(token))).toEqual([])
    // The accent pair paints only .bb-btn (/tokens.css), which on these documents is the skip link
    // that print hides.
    for (const name of STATIC_PAGES)
      for (const element of document(name))
        if ((attr(element, 'class') ?? '').split(/\s+/).includes('bb-btn'))
          expect(attr(element, 'class'), name).toBe('bb-skip bb-btn')
  })
})

describe('social defaults', () => {
  afterEach(() => vi.restoreAllMocks())

  const SHELL_TAGS = [
    ['business-og-site-name', 'property', 'og:site_name'],
    ['business-og-title', 'property', 'og:title'],
    ['business-og-image-alt', 'property', 'og:image:alt'],
    ['business-twitter-title', 'name', 'twitter:title'],
  ] as const
  /** The content of the four tags by their id, after checking each still carries its property. */
  function shellTags(all: readonly Element[]): Record<(typeof SHELL_TAGS)[number][0], string> {
    const content = (id: string, name: string, value: string): string => {
      const tag = only(all, (element) => attr(element, 'id') === id)
      expect([tag.tagName, attr(tag, name)]).toEqual(['meta', value])
      return attr(tag, 'content') ?? ''
    }
    return {
      'business-og-site-name': content(...SHELL_TAGS[0]),
      'business-og-title': content(...SHELL_TAGS[1]),
      'business-og-image-alt': content(...SHELL_TAGS[2]),
      'business-twitter-title': content(...SHELL_TAGS[3]),
    }
  }
  const title = (all: readonly Element[]): string =>
    flat(text(only(all, (element) => attr(element, 'id') === 'business-title')))

  it('names the business and repeats the shell title where the shell had generic words', () => {
    const all = shell()
    expect(title(all).startsWith(DEFAULT_BUSINESS.name)).toBe(true)
    expect(shellTags(all)).toEqual({
      'business-og-site-name': DEFAULT_BUSINESS.name,
      'business-og-title': title(all),
      'business-og-image-alt': DEFAULT_BUSINESS.name,
      'business-twitter-title': title(all),
    })
  })

  it('still lets the Worker fill the four tags from Företag & SEO', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      return url.endsWith('/rpc/public_business_discovery')
        ? Response.json({
            settings: { business_name: 'Gate name' },
            barbers: [],
            services: [],
            schedules: [],
          })
        : new Response(null, { status: 503 })
    })
    const env = {
      SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_ANON_KEY: 'fixture-anon-key',
      ASSETS: {
        fetch: async (input: Request | URL | string): Promise<Response> =>
          new URL(input instanceof Request ? input.url : input).pathname === '/index.html'
            ? new Response(read('index.html'), { headers: { 'Content-Type': 'text/html' } })
            : new Response('Not found', { status: 404 }),
      },
    }
    const publicContent = new PublicContent({} as never, env)
    const response = await worker.fetch(
      new Request('https://bladeblendstudio.se/', { headers: { Accept: 'text/html' } }),
      env,
      { exports: { PublicContent: { fetch: (request: Request) => publicContent.fetch(request) } } },
    )
    expect(response.status).toBe(200)
    const all = elements(parse(await response.text()))
    expect(title(all)).toContain('Gate name')
    expect(shellTags(all)).toEqual({
      'business-og-site-name': 'Gate name',
      'business-og-title': title(all),
      'business-og-image-alt': 'Gate name',
      'business-twitter-title': title(all),
    })
  })

  it('gives the Contact fallback the image tags of the legal fallbacks', () => {
    const tags = (name: 'contact' | 'terms' | 'privacy'): (string | undefined)[] => {
      const all = document(name)
      return [metaContent(all, 'property', 'og:image'), metaContent(all, 'name', 'twitter:card')]
    }
    expect(tags('contact')).toEqual([
      'https://bladeblendstudio.se/og-image.png',
      'summary_large_image',
    ])
    expect(tags('terms')).toEqual(tags('contact'))
    expect(tags('privacy')).toEqual(tags('contact'))
    expect(existsSync(file('public/og-image.png'))).toBe(true)
    // The image's description names the business, so no fallback hard-codes it: each carries the
    // same neutral default under an id of its own head's naming, for the Worker to fill.
    const alt = (name: 'contact' | 'terms' | 'privacy'): (string | undefined)[] => {
      const tag = only(
        document(name),
        (element) => element.tagName === 'meta' && attr(element, 'property') === 'og:image:alt',
      )
      return [attr(tag, 'id'), attr(tag, 'content')]
    }
    expect(alt('terms')).toEqual(['legal-image-alt', 'Salongen'])
    expect(alt('privacy')).toEqual(alt('terms'))
    expect(alt('contact')).toEqual(['contact-image-alt', 'Salongen'])
    const ids = document('contact').flatMap((element) => attr(element, 'id') ?? [])
    expect(ids.filter((id) => id === 'contact-image-alt')).toHaveLength(1)
  })
})
