import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parse, parseFragment, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emptyDocument,
  validateDocument,
  type CmsLang,
  type CmsPage,
  type CmsPresentation,
} from '../../shared/cms'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup'
import { createSitePage, isFrozenSitePage, type SiteContact } from '../../shared/site-page'
import { previewSitePage } from '../../src/admin/cms/LivePreview'
import worker from '../../src/worker'

// Created pages through the real Worker: the homepage logo the live header copies, and pages an
// earlier Studio stored with their own frozen header.
const shell = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const tokens = readFileSync(new URL('../../public/tokens.css', import.meta.url), 'utf8')
const env = {
  SUPABASE_URL: 'https://fixture.invalid',
  SUPABASE_ANON_KEY: 'fixture-anon-key',
  ASSETS: {
    fetch: async (input: Request | URL | string): Promise<Response> => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === '/index.html')
        return new Response(shell, { headers: { 'Content-Type': 'text/html' } })
      if (path === '/tokens.css')
        return new Response(tokens, { headers: { 'Content-Type': 'text/css' } })
      return new Response('Not found', { status: 404 })
    },
  },
}
const noPublicContent = {
  exports: {
    PublicContent: {
      fetch: () => Promise.reject(new Error('Unexpected PublicContent export call')),
    },
  },
}
// The publication policy for revision 56, whose uploads live on the e2e storage origin.
const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://admin-harness.invalid',
  builtAssets: CMS_BUILT_ASSETS,
}
const contact: SiteContact = {
  phoneTel: '0701234567',
  phoneDisplay: '070-123 45 67',
  mapsHref: 'https://maps.example.test/?q=Salongen',
}

// Production revision 56: the homepage the owner publishes, with its native header.
const published = (): CmsPresentation =>
  JSON.parse(
    gunzipSync(
      readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
    ).toString('utf8'),
  ).presentation

/** The app's own publication validators accept the document. */
function expectValid(presentation: CmsPresentation): void {
  const document = { ...emptyDocument(), presentation: structuredClone(presentation) }
  expect(() => {
    validateDocument(document)
    validateDocumentMarkupPlacements(document, policy)
  }).not.toThrow()
}

async function serve(presentation: CmsPresentation, path: string): Promise<string> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).endsWith('/rpc/public_cms_presentation')
      ? Response.json({ revision: 56, presentation })
      : new Response(null, { status: 503 }),
  )
  const response = await worker.fetch(
    new Request(`https://bladeblendstudio.se${path}`),
    env,
    noPublicContent,
  )
  expect(response.status).toBe(200)
  return response.text()
}

function sheet(html: string, id: string): string {
  const start = html.indexOf(`<style id="${id}"`)
  if (start < 0) return ''
  const content = html.indexOf('>', start) + 1
  return html.slice(content, html.indexOf('</style>', content))
}

type Element = DefaultTreeAdapterMap['element']
type TreeNode = DefaultTreeAdapterMap['node']
const children = (node: TreeNode): Element[] =>
  'childNodes' in node
    ? node.childNodes.filter((child): child is Element => 'tagName' in child)
    : []
const descendants = (node: TreeNode): Element[] =>
  children(node).flatMap((child) => [child, ...descendants(child)])
const value = (node: Element, name: string): string | undefined =>
  node.attrs.find((item) => item.name === name)?.value
function withId(root: TreeNode, id: string): Element {
  const found = descendants(root).find((node) => value(node, 'id') === id)
  if (!found) throw new Error(`No #${id}`)
  return found
}

function createdPage(): CmsPage {
  return createSitePage({
    id: '20000000-0000-4000-8000-000000000003',
    path: '/hemsida',
    name: { sv: 'Ny sida', en: 'New page' },
  })
}

describe('a created page under a homepage logo whose text contains URL(', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The desktop logo of revision 56, which the live header copies.
  const logoId = 'id="knc-knc-desktop-home-0-i0-i0-i0-0"'
  function withEditedLogo(edit: (logo: string) => string): {
    presentation: CmsPresentation
    page: CmsPage
  } {
    const presentation = published()
    const home = presentation.pages.find((item) => item.path === '/')
    if (!home) throw new Error('The fixture has no homepage')
    for (const lang of ['sv', 'en'] as const) {
      const html = home.content[lang].html
      const at = html.indexOf(logoId)
      if (at < 0) throw new Error('The fixture has no desktop logo')
      const start = html.lastIndexOf('<svg', at)
      const end = html.indexOf('</svg>', at) + '</svg>'.length
      const logo = html.slice(start, end)
      const edited = edit(logo)
      if (edited === logo) throw new Error('The logo edit changed nothing')
      home.content[lang].html = html.slice(0, start) + edited + html.slice(end)
    }
    const page = createdPage()
    presentation.pages.push(page)
    return { presentation, page }
  }
  const upload =
    'https://admin-harness.invalid/storage/v1/object/public/cms-library/images/33333333-3333-4333-8333-333333333333.webp'

  it.each<{ label: string; edit: (logo: string) => string; text: string }>([
    {
      label: 'an SVG aria-label',
      edit: (logo) =>
        logo.replace(
          'aria-label="Blade &amp; Blend Studio"',
          'aria-label="Salong URL(front desk)"',
        ),
      text: 'aria-label="Salong URL(front desk)"',
    },
    {
      label: 'an image alt',
      edit: () => `<img src="${upload}" alt="Studio URL(north entrance)">`,
      text: 'alt="Studio URL(north entrance)"',
    },
    {
      label: 'an SVG title',
      edit: (logo) => logo.replace(' role="img"', ' role="img" title="Studio URL(north entrance)"'),
      text: 'title="Studio URL(north entrance)"',
    },
    {
      label: 'an SVG aria-roledescription',
      edit: (logo) =>
        logo.replace(' role="img"', ' role="img" aria-roledescription="Logo URL(our shop)"'),
      text: 'aria-roledescription="Logo URL(our shop)"',
    },
  ])('is served, and previewed, with $label kept as text', async ({ edit, text }) => {
    const { presentation, page } = withEditedLogo(edit)
    expectValid(presentation)
    for (const lang of ['sv', 'en'] as const) {
      const html = await serve(presentation, `/hemsida?lang=${lang}`)
      expect(serializeOuter(withId(parse(html), 'cms-site-header'))).toContain(text)
      expect(previewSitePage(presentation, page, lang, 'light', contact).html).toContain(text)
    }
  })

  /** Revision 56 whose homepage desktop brand graphic is `logo`, plus a created page. */
  function withLogo(logo: string): CmsPresentation {
    const presentation = published()
    const home = presentation.pages.find((item) => item.path === '/')
    if (!home) throw new Error('The fixture has no homepage')
    const html = `<div data-knc-native="1"><div data-knc-surface="desktop-home"><div><h1>${logo}</h1></div></div></div>`
    home.content = { sv: { ...home.content.sv, html }, en: { ...home.content.en, html } }
    presentation.pages.push(createdPage())
    return presentation
  }
  const gradient = '<linearGradient id="paint"><stop offset="0"></stop></linearGradient>'

  it('keeps a label naming a logo id as text while the logo paint follows the rename', async () => {
    const presentation = withLogo(
      `<svg aria-label="Gradient url(#paint)" viewBox="0 0 10 10">${gradient}<rect width="10" height="10" fill="url(#paint)"></rect></svg>`,
    )
    expectValid(presentation)
    const header = withId(parse(await serve(presentation, '/hemsida?lang=sv')), 'cms-site-header')
    const svg = descendants(header).find((node) => node.tagName === 'svg')
    const rect = descendants(header).find((node) => node.tagName === 'rect')
    if (!svg || !rect) throw new Error('The served logo is missing')
    expect(value(svg, 'aria-label')).toBe('Gradient url(#paint)')
    expect(withId(header, 'cms-logo-paint').tagName).toBe('linearGradient')
    expect(value(rect, 'fill')).toBe('url(#cms-logo-paint)')
  })

  it('keeps clip-path and mask references to the logo working under the renamed ids', async () => {
    const presentation = withLogo(
      '<svg viewBox="0 0 10 10"><defs><clipPath id="clip"><rect width="5" height="5"></rect></clipPath><mask id="fade"><rect width="10" height="10" fill="white"></rect></mask></defs><rect width="10" height="10" clip-path="url(#clip)" mask="url(#fade)"></rect></svg>',
    )
    expectValid(presentation)
    const header = withId(parse(await serve(presentation, '/hemsida?lang=sv')), 'cms-site-header')
    expect(withId(header, 'cms-logo-clip').tagName).toBe('clipPath')
    expect(withId(header, 'cms-logo-fade').tagName).toBe('mask')
    const masked = descendants(header).find((node) => value(node, 'clip-path') !== undefined)
    if (!masked) throw new Error('The served logo lost its clipped shape')
    expect(value(masked, 'clip-path')).toBe('url(#cms-logo-clip)')
    expect(value(masked, 'mask')).toBe('url(#cms-logo-fade)')
  })

  it.each(['url(#paint)!important', 'url(#paint);color:red'])(
    'serves a logo paint value the validators accept but a bare CSS value parse rejects: %s',
    async (fill) => {
      const presentation = withLogo(
        `<svg viewBox="0 0 10 10">${gradient}<rect width="10" height="10" fill="${fill}"></rect></svg>`,
      )
      expectValid(presentation)
      const header = withId(parse(await serve(presentation, '/hemsida?lang=sv')), 'cms-site-header')
      expect(withId(header, 'cms-logo-paint').tagName).toBe('linearGradient')
      // As the validators read the attribute, its url(#paint) names the logo's own gradient.
      const references = descendants(header).flatMap((node) =>
        node.attrs.flatMap((item) =>
          [...item.value.matchAll(/url\(#([^)]+)\)/gi)].map((match) => match[1]),
        ),
      )
      expect(references).toEqual(['cms-logo-paint'])
    },
  )

  // Of the SVG attributes that can name an id with url(), the validators accept only fill, stroke,
  // clip-path and mask on a logo (style and data-knc-* are stripped from it), so only those four
  // are renamed. Allowing one of these means renaming it too.
  it.each(['filter', 'marker-start', 'marker-mid', 'marker-end', 'cursor'])(
    'cannot publish a logo whose %s names one of its ids',
    (name) => {
      const presentation = withLogo(
        `<svg viewBox="0 0 10 10">${gradient}<rect width="10" height="10" ${name}="url(#paint)"></rect></svg>`,
      )
      const document = { ...emptyDocument(), presentation }
      expect(() => {
        validateDocument(document)
        validateDocumentMarkupPlacements(document, policy)
      }).toThrow(`Unsupported attribute ${name}`)
    },
  )
})

// A created page as main (93ff329) stored it: `html` is main's createSitePage output, byte for byte,
// for the Studio's default new page under the revision 56 homepage. `css` keeps only the first rule
// of each stored sheet; the whole sheets are 59 to 87 kB. Main's Worker retargeted the language and
// theme actions of this header on every response.
const LEGACY_HTML: Readonly<Record<CmsLang, string>> = {
  sv: `<div id="cms-site-shell"><header id="cms-site-header"><div id="knc-desktop-home-0-i0" class="cms-site-chrome"><a id="knc-desktop-home-0-i0-i0" href="/?lang=sv&amp;mode=light" class="cms-site-brand"><div id="knc-desktop-home-0-i0-i0-i0"><svg viewBox="0 0 322 48" height="30" width="201.25" role="img" aria-label="Blade &amp; Blend Studio" fill="currentColor" id="knc-knc-desktop-home-0-i0-i0-i0-0"><line x1="6" y1="9" x2="52" y2="9" stroke="currentColor" stroke-width="1.6" id="knc-knc-desktop-home-0-i0-i0-i0-0-i0"></line><text x="29" y="33" text-anchor="middle" font-family="'Playfair Display'" font-weight="400" font-size="21" letter-spacing="4" id="knc-knc-desktop-home-0-i0-i0-i0-0-i1">BNB</text><line x1="6" y1="40" x2="52" y2="40" stroke="currentColor" stroke-width="1.6" id="knc-knc-desktop-home-0-i0-i0-i0-0-i2"></line><text x="70" y="32" text-anchor="start" font-family="'Playfair Display'" font-weight="700" font-size="22" letter-spacing="3" id="knc-knc-desktop-home-0-i0-i0-i0-0-i3">BLADE &amp; BLEND</text></svg></div></a><div id="knc-desktop-home-0-i0-i1" class="cms-site-controls"><a href="https://maps.apple.com/?q=Geijersgatan%2010,%20G%C3%B6teborg" target="_blank" rel="noopener noreferrer" id="knc-desktop-home-0-i0-i1-i0" class="cms-site-directions"><img src="/icons/mappin.circle.fill.svg" alt="" id="knc-desktop-home-0-i0-i1-i0-i0">Hitta oss</a><a href="tel:0793043671" id="knc-desktop-home-0-i0-i1-i1" class="cms-site-phone"><img src="/icons/phone.svg" alt="Ring" id="knc-desktop-home-0-i0-i1-i1-i0">079‑304 36 71</a><a id="knc-desktop-home-0-i0-i1-i2" href="/hemsida?lang=en&amp;mode=light" aria-label="Byt språk till engelska" class="cms-site-action-language"><span id="knc-desktop-home-0-i0-i1-i2-i0">SV</span><span id="knc-desktop-home-0-i0-i1-i2-i1">EN</span></a><a title="Växla ljust/mörkt" aria-label="Växla ljust/mörkt" id="knc-desktop-home-0-i0-i1-i3" href="/hemsida?lang=sv&amp;mode=dark" class="cms-site-action-theme"><img src="/icons/moon.svg" alt="" id="knc-desktop-home-0-i0-i1-i3-i0"><span id="knc-desktop-home-0-i0-i1-i3-i1"><img src="/icons/sun.max.svg" alt="" id="knc-desktop-home-0-i0-i1-i3-i1-i0"></span></a></div></div></header><nav id="cms-site-menu" aria-label="Sidmeny"><a href="/?lang=sv&amp;mode=light">Hem</a><a href="/booking?lang=sv&amp;mode=light">Boka tid</a><a href="/about?lang=sv&amp;mode=light">Om oss</a></nav><div id="cms-site-content"><main id="cms-page-20000000-0000-4000-8000-000000000002-sv-0"><h1 id="cms-page-20000000-0000-4000-8000-000000000002-sv-1">Ny sida</h1><p id="cms-page-20000000-0000-4000-8000-000000000002-sv-2">Skriv din text här.</p></main></div><footer id="cms-site-footer"><div id="knc-desktop-home-0-i1-i0-i5"><span id="knc-desktop-home-0-i1-i0-i5-i0">Öppet Mån–Lör 09–18 · Sön stängt</span><span id="knc-desktop-home-0-i1-i0-i5-i1">Geijersgatan 10, 411 34 Göteborg</span></div><footer id="knc-about-0-i1"><a href="/terms" id="knc-about-0-i1-i0" class="scp0">Villkor</a><a href="/privacy" id="knc-about-0-i1-i1" class="scp0">Integritetspolicy</a><a href="/#privacy-preferences" aria-label="Hantera integritetsinställningar" id="knc-about-0-i1-i2" class="scp0">Integritet</a></footer></footer></div>`,
  en: `<div id="cms-site-shell"><header id="cms-site-header"><div id="knc-desktop-home-0-i0" class="cms-site-chrome"><a id="knc-desktop-home-0-i0-i0" href="/?lang=en&amp;mode=light" class="cms-site-brand"><div id="knc-desktop-home-0-i0-i0-i0"><svg viewBox="0 0 322 48" height="30" width="201.25" role="img" aria-label="Blade &amp; Blend Studio" fill="currentColor" id="knc-knc-desktop-home-0-i0-i0-i0-0"><line x1="6" y1="9" x2="52" y2="9" stroke="currentColor" stroke-width="1.6" id="knc-knc-desktop-home-0-i0-i0-i0-0-i0"></line><text x="29" y="33" text-anchor="middle" font-family="'Playfair Display'" font-weight="400" font-size="21" letter-spacing="4" id="knc-knc-desktop-home-0-i0-i0-i0-0-i1">BNB</text><line x1="6" y1="40" x2="52" y2="40" stroke="currentColor" stroke-width="1.6" id="knc-knc-desktop-home-0-i0-i0-i0-0-i2"></line><text x="70" y="32" text-anchor="start" font-family="'Playfair Display'" font-weight="700" font-size="22" letter-spacing="3" id="knc-knc-desktop-home-0-i0-i0-i0-0-i3">BLADE &amp; BLEND</text></svg></div></a><div id="knc-desktop-home-0-i0-i1" class="cms-site-controls"><a href="https://maps.apple.com/?q=Geijersgatan%2010,%20G%C3%B6teborg" target="_blank" rel="noopener noreferrer" id="knc-desktop-home-0-i0-i1-i0" class="cms-site-directions"><img src="/icons/mappin.circle.fill.svg" alt="" id="knc-desktop-home-0-i0-i1-i0-i0">Find us</a><a href="tel:0793043671" id="knc-desktop-home-0-i0-i1-i1" class="cms-site-phone"><img src="/icons/phone.svg" alt="Call" id="knc-desktop-home-0-i0-i1-i1-i0">079‑304 36 71</a><a id="knc-desktop-home-0-i0-i1-i2" href="/hemsida?lang=sv&amp;mode=light" aria-label="Switch language to Swedish" class="cms-site-action-language"><span id="knc-desktop-home-0-i0-i1-i2-i0">SV</span><span id="knc-desktop-home-0-i0-i1-i2-i1">EN</span></a><a title="Toggle light/dark" aria-label="Toggle light/dark" id="knc-desktop-home-0-i0-i1-i3" href="/hemsida?lang=en&amp;mode=dark" class="cms-site-action-theme"><img src="/icons/moon.svg" alt="" id="knc-desktop-home-0-i0-i1-i3-i0"><span id="knc-desktop-home-0-i0-i1-i3-i1"><img src="/icons/sun.max.svg" alt="" id="knc-desktop-home-0-i0-i1-i3-i1-i0"></span></a></div></div></header><nav id="cms-site-menu" aria-label="Pages"><a href="/?lang=en&amp;mode=light">Home</a><a href="/booking?lang=en&amp;mode=light">Book</a><a href="/about?lang=en&amp;mode=light">About</a></nav><div id="cms-site-content"><main id="cms-page-20000000-0000-4000-8000-000000000002-en-0"><h1 id="cms-page-20000000-0000-4000-8000-000000000002-en-1">Ny sida</h1><p id="cms-page-20000000-0000-4000-8000-000000000002-en-2">Write your page here.</p></main></div><footer id="cms-site-footer"><div id="knc-desktop-home-0-i1-i0-i5"><span id="knc-desktop-home-0-i1-i0-i5-i0">Open Mon–Sat 09–18 · Sun closed</span><span id="knc-desktop-home-0-i1-i0-i5-i1">Geijersgatan 10, 411 34 Göteborg</span></div><footer id="knc-about-0-i1"><a href="/terms" id="knc-about-0-i1-i0" class="scp0">Terms</a><a href="/privacy" id="knc-about-0-i1-i1" class="scp0">Privacy policy</a><a href="/#privacy-preferences" aria-label="Manage privacy preferences" id="knc-about-0-i1-i2" class="scp0">Privacy</a></footer></footer></div>`,
}
const LEGACY_CSS = {
  light:
    '[id="cms-site-shell"]{min-height:100vh;display:flex;flex-direction:column;background:var(--knc-background,rgb(255,255,255));color:var(--knc-text,rgb(28,28,30));font-family:var(--knc-fontFamily,"Inter Variable",-apple-system,system-ui,sans-serif);-webkit-font-smoothing:antialiased;padding-bottom:var(--privacy-overlay-space, 0px)}',
  dark: '[id="cms-site-shell"]{min-height:100vh;display:flex;flex-direction:column;background:var(--knc-background,rgb(28,28,30));color:var(--knc-text,rgb(245,245,247));font-family:var(--knc-fontFamily,"Inter Variable",-apple-system,system-ui,sans-serif);-webkit-font-smoothing:antialiased;padding-bottom:var(--privacy-overlay-space, 0px)}',
}
function legacyPage(html: Readonly<Record<CmsLang, string>> = LEGACY_HTML): CmsPage {
  return {
    id: '20000000-0000-4000-8000-000000000002',
    kind: 'page',
    path: '/hemsida',
    inMenu: true,
    name: { sv: 'Ny sida', en: 'New page' },
    title: { sv: 'Ny sida', en: 'New page' },
    description: { sv: '', en: '' },
    content: {
      sv: { html: html.sv, css: { ...LEGACY_CSS } },
      en: { html: html.en, css: { ...LEGACY_CSS } },
    },
    layout: 'independent',
  }
}
function withLegacy(page: CmsPage): CmsPresentation {
  const presentation = published()
  presentation.pages.push(page)
  return presentation
}

function action(root: Element, name: string): Element {
  const found = descendants(root).find(
    (node) => node.tagName === 'a' && (value(node, 'class') ?? '').split(/\s+/).includes(name),
  )
  if (!found) throw new Error(`No ${name} link`)
  return found
}
function setHref(link: Element, href: string): void {
  link.attrs = link.attrs.map((item) => (item.name === 'href' ? { ...item, value: href } : item))
}
const otherLang = (lang: CmsLang): CmsLang => (lang === 'sv' ? 'en' : 'sv')
// The mode main's theme action named for each requested mode, read from main's own
// renderSitePage (light, dark) and renderIndependentSitePage (auto) on LEGACY_HTML: the other
// pinned mode, and dark when the response follows the OS.
const MAIN_THEME_MODE = { light: 'dark', dark: 'light', auto: 'dark' } as const

describe('a created page stored with a frozen header by main', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is frozen, publishable, and stores its language action pinned to light', () => {
    expect(isFrozenSitePage(legacyPage())).toBe(true)
    expectValid(withLegacy(legacyPage()))
    for (const lang of ['sv', 'en'] as const)
      expect(
        value(
          action(
            withId(parseFragment(LEGACY_HTML[lang]), 'cms-site-shell'),
            'cms-site-action-language',
          ),
          'href',
        ),
      ).toBe(`/hemsida?lang=${otherLang(lang)}&mode=light`)
  })

  it.each(
    (['sv', 'en'] as const).flatMap((lang) =>
      (['light', 'dark', 'auto'] as const).map((mode) => ({ lang, mode })),
    ),
  )(
    '$lang $mode: the language switch keeps the shown mode and the theme switch matches main; the stored page and CSS are served intact',
    async ({ lang, mode }) => {
      const page = legacyPage()
      const stored = page.content[lang]
      const pinned = mode === 'auto' ? '' : `&mode=${mode}`
      const html = await serve(withLegacy(page), `/hemsida?lang=${lang}${pinned}`)
      expect(html).toContain(`data-cms-mode="${mode}"`)
      const language = `/hemsida?lang=${otherLang(lang)}${pinned}`
      const served = withId(parse(html), 'cms-site-shell')
      expect(value(action(served, 'cms-site-action-language'), 'href')).toBe(language)
      const expected = withId(parseFragment(stored.html), 'cms-site-shell')
      setHref(action(expected, 'cms-site-action-language'), language)
      const theme = `/hemsida?lang=${lang}&mode=${MAIN_THEME_MODE[mode]}`
      expect(value(action(served, 'cms-site-action-theme'), 'href')).toBe(theme)
      setHref(action(expected, 'cms-site-action-theme'), theme)
      expect(serializeOuter(served)).toBe(serializeOuter(expected))
      expect(html).toContain(stored.html.slice(stored.html.indexOf('<nav id="cms-site-menu"')))
      for (const scheme of mode === 'auto' ? (['light', 'dark'] as const) : [mode])
        expect(sheet(html, `cms-page-${scheme}`)).toBe(stored.css[scheme])
    },
  )

  it('keeps an owner-edited stored body byte for byte while the language switch keeps dark', async () => {
    // Entities, a void element and both quote styles, as an owner edit may leave them.
    const body = `<main id="owner"><h1 id='owner-title' title="Tid &amp; plats">Öppet&nbsp;i dag &lt;3</h1><p>Rad ett<br>rad två</p></main>`
    const edited = (lang: CmsLang): string =>
      LEGACY_HTML[lang].replace(/<main\b[^>]*>[\s\S]*<\/main>/, body)
    const page = legacyPage({ sv: edited('sv'), en: edited('en') })
    expect(page.content.sv.html).toContain(body)
    const presentation = withLegacy(page)
    expectValid(presentation)
    const html = await serve(presentation, '/hemsida?lang=sv&mode=dark')
    expect(
      value(action(withId(parse(html), 'cms-site-shell'), 'cms-site-action-language'), 'href'),
    ).toBe('/hemsida?lang=en&mode=dark')
    const stored = page.content.sv.html
    expect(html).toContain(stored.slice(stored.indexOf('<nav id="cms-site-menu"')))
  })

  it('finds untagged actions by their labels and rewrites only their href values, in their own quotes', async () => {
    // Main's Studio edited the whole stored page, header included; main matched an action without
    // its class by the label it gave the action.
    const edited = LEGACY_HTML.sv
      .replace(' class="cms-site-action-language"', '')
      .replace(' class="cms-site-action-theme"', '')
      .replace('href="/hemsida?lang=en&amp;mode=light"', "href='/hemsida?lang=en&mode=light'")
      .replace('title="Växla ljust/mörkt"', "title='Växla ljust/mörkt'")
    expect(edited).not.toContain('cms-site-action-')
    const page = legacyPage({ sv: edited, en: LEGACY_HTML.en })
    const html = await serve(withLegacy(page), '/hemsida?lang=sv&mode=dark')
    expect(html).toContain(
      edited
        .replace("href='/hemsida?lang=en&mode=light'", "href='/hemsida?lang=en&amp;mode=dark'")
        .replace('href="/hemsida?lang=sv&amp;mode=dark"', 'href="/hemsida?lang=sv&amp;mode=light"'),
    )
  })

  it.each([
    ['an action title', 'title="Växla ljust/mörkt"', 'title="Växla ljust/mörkt </header>"'],
    [
      'a comment',
      '<header id="cms-site-header">',
      '<header id="cms-site-header"><!-- </header> -->',
    ],
  ])('retargets both actions when the first </header> sits in %s', async (_where, from, to) => {
    const edited = LEGACY_HTML.sv.replace(from, to)
    // The markup up to the first `</header>` leaves out the theme action, so only the whole
    // markup's parse finds both.
    expect(edited.indexOf('</header>')).toBeLessThan(
      edited.indexOf(' class="cms-site-action-theme"'),
    )
    const page = legacyPage({ sv: edited, en: LEGACY_HTML.en })
    const html = await serve(withLegacy(page), '/hemsida?lang=sv&mode=dark')
    expect(html).toContain(
      edited
        .replace('href="/hemsida?lang=en&amp;mode=light"', 'href="/hemsida?lang=en&amp;mode=dark"')
        .replace('href="/hemsida?lang=sv&amp;mode=dark"', 'href="/hemsida?lang=sv&amp;mode=light"'),
    )
  })
})
