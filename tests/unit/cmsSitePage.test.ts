import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parse, parseFragment, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsPage, type CmsPresentation } from '../../shared/cms'
import { validateMarkup } from '../../shared/cms-markup'
import {
  SITE_PAGE_CSS,
  createSitePage,
  desktopBrandSource,
  dropFrozenChrome,
  homepageLogo,
  homepageLogoElement,
  isFrozenSitePage,
  isLiveSitePage,
  menuLinks,
  renderSitePage,
  withoutFrozenChromeCss,
  type SiteContact,
} from '../../shared/site-page'
import { restoreRevision } from '../../src/admin/cms/draft'
import { previewSitePage } from '../../src/admin/cms/LivePreview'
import { normalizeDocument } from '../../src/admin/cms/normalizeDocument'
import { renderCmsPage } from '../../src/worker'

const contact: SiteContact = {
  phoneTel: '0701234567',
  phoneDisplay: '070-123 45 67',
  mapsHref: 'https://maps.example.test/?q=Salongen',
}
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
// Production revision 56: the homepage the owner publishes, with its native header and CSS.
const published = (): CmsPresentation =>
  JSON.parse(
    new TextDecoder().decode(
      gunzipSync(
        readFileSync(new URL('../../tools/e2e/fixtures/presentation.json.gz', import.meta.url)),
      ),
    ),
  ).presentation

function presentationWith(...pages: CmsPage[]): CmsPresentation {
  const presentation = published()
  presentation.pages.push(...pages)
  return presentation
}

const created = (path: string, sv: string): CmsPage =>
  createSitePage({ id: crypto.randomUUID(), path, name: { sv, en: `${sv} (en)` } })

/** Body ids carry the language (cms-body-<id>-sv); the layout behind them is the same. */
const bodyLang = /(cms-body-[0-9a-f-]{36})-(?:sv|en)/g
/** The element and class skeleton of a render: text, links, labels and the current-language
 * marker removed (SV or EN is highlighted in the language pill; the layout is the same). */
const skeleton = (html: string): string =>
  html
    .replace(/>[^<]*</g, '><')
    .replace(/\b(href|aria-label|title)="[^"]*"/g, '$1=""')
    .replaceAll(' class="is-current"', '')
    .replace(bodyLang, '$1')

type Element = DefaultTreeAdapterMap['element']
type TreeNode = DefaultTreeAdapterMap['node']
const children = (node: TreeNode): Element[] =>
  'childNodes' in node
    ? node.childNodes.filter((child): child is Element => 'tagName' in child)
    : []
const descendants = (node: TreeNode): Element[] =>
  children(node).flatMap((child) => [child, ...descendants(child)])
const findElement = (node: TreeNode, match: (node: Element) => boolean): Element | undefined =>
  ('tagName' in node && match(node) ? node : undefined) ??
  descendants(node).find((child) => match(child))
const value = (node: Element, name: string): string | undefined =>
  node.attrs.find((item) => item.name === name)?.value
/** Every element of a whole response or fragment, parsed: counts elements, not text that names them. */
const parsedElements = (html: string): Element[] =>
  descendants(/<html[\s>]/i.test(html) ? parse(html) : parseFragment(html))
const withId = (html: string, id: string): Element[] =>
  parsedElements(html).filter((node) => value(node, 'id') === id)

describe('a created page is its body under the live homepage header', () => {
  it('stores only a small body template, with its own CSS for both schemes', () => {
    const page = created('/hemsida', 'Ny sida')
    // The materialised copy of rev 56 was 299,517 B; the cap per sheet is 100,000 characters.
    expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeLessThan(20_000)
    expect(page.layout).toBeUndefined()
    for (const lang of ['sv', 'en'] as const) {
      expect(page.content[lang].html).not.toContain('cms-site-')
      expect(page.content[lang].html).not.toContain('style=')
      expect(page.content[lang].css.light).toBe(page.content[lang].css.dark)
    }
  })

  it('gives all four variants one layout: the same base sheet, page CSS and markup skeleton', () => {
    const page = created('/hemsida', 'Ny sida')
    const presentation = presentationWith(page)
    const renders = (['sv', 'en'] as const).flatMap((lang) =>
      (['light', 'dark'] as const).map((mode) =>
        renderSitePage(presentation, page, lang, mode, contact),
      ),
    )
    expect(new Set(renders.map((render) => skeleton(render.html))).size).toBe(1)
    for (const render of renders) expect(render.css.light).toBe(render.css.dark)
    expect(new Set(renders.map((render) => render.css.light.replace(bodyLang, '$1'))).size).toBe(1)
    expect(SITE_PAGE_CSS).toContain('*,*::before,*::after{box-sizing:border-box}')
    // currentColor paints only the icon masks; no hairline or border follows the text colour.
    expect(SITE_PAGE_CSS).not.toMatch(/(?:border|outline)[^;{}]*currentColor/i)
    expect(SITE_PAGE_CSS).toContain('border-bottom:.5px solid var(--knc-border,var(--bb-line))')
  })

  it('builds the header from the current homepage logo, menu and business contact', () => {
    const page = created('/hemsida', 'Ny sida')
    const presentation = presentationWith(page)
    const html = renderSitePage(presentation, page, 'sv', 'light', contact).html
    expect(withId(html, 'cms-site-header')).toHaveLength(1)
    expect(html).toContain('aria-label="Blade &amp; Blend Studio"')
    const header = withId(html, 'cms-site-header')[0]
    const logo = header && findElement(header, (node) => node.tagName === 'svg')
    if (!logo) throw new Error('The header has no logo')
    expect(logo.attrs.filter((item) => ['id', 'style', 'class'].includes(item.name))).toEqual([])
    for (const node of [logo, ...descendants(logo)]) {
      expect(node.attrs.filter((item) => /^data-(?:knc|gjs)-|^style$/i.test(item.name))).toEqual([])
      const id = value(node, 'id')
      if (node !== logo && id !== undefined) expect(id).toMatch(/^cms-logo-/)
    }
    expect(html).toContain('<a class="cms-site-phone" href="tel:0701234567">070-123 45 67</a>')
    expect(html).toContain('href="https://maps.example.test/?q=Salongen"')
    expect(html).toContain(
      '<a href="/hemsida?lang=sv&amp;mode=light" aria-current="page">Ny sida</a>',
    )
    const silent = renderSitePage(presentation, page, 'sv', 'light', {
      phoneTel: '',
      phoneDisplay: '',
      mapsHref: '',
    }).html
    expect(silent).not.toMatch(/cms-site-phone|cms-site-directions/)
  })

  it('has no /sida-a link on page B after page A is deleted, without republishing B', () => {
    const a = created('/sida-a', 'Sida A')
    const b = created('/sida-b', 'Sida B')
    const presentation = presentationWith(a, b)
    expect(renderSitePage(presentation, b, 'sv', 'light', contact).html).toContain(
      'href="/sida-a?lang=sv&amp;mode=light"',
    )
    presentation.pages = presentation.pages.filter((page) => page.id !== a.id)
    expect(renderSitePage(presentation, b, 'sv', 'light', contact).html).not.toContain('/sida-a')
  })

  it('links in the served language and scheme, and without mode when the page follows the OS', () => {
    const page = created('/hemsida', 'Ny sida')
    const presentation = presentationWith(page)
    expect(menuLinks(presentation, 'en', 'dark').map((link) => link.href)).toEqual([
      '/?lang=en&mode=dark',
      '/booking?lang=en&mode=dark',
      '/about?lang=en&mode=dark',
      '/hemsida?lang=en&mode=dark',
    ])
    const auto = renderSitePage(presentation, page, 'sv', null, contact).html
    const hrefs = [...auto.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1])
    expect(hrefs.filter((href) => href?.includes('mode='))).toEqual([
      '/hemsida?lang=sv&amp;mode=dark',
    ])
    expect(auto).toContain('class="cms-site-action-theme" href="/hemsida?lang=sv&amp;mode=dark"')
    expect(auto).toContain('class="cms-site-action-language" href="/hemsida?lang=en"')
    const dark = renderSitePage(presentation, page, 'en', 'dark', contact).html
    expect(dark).toContain('class="cms-site-action-theme" href="/hemsida?lang=en&amp;mode=light"')
    expect(dark).toContain('class="cms-site-action-language" href="/hemsida?lang=sv&amp;mode=dark"')
  })
})

/** A page as the Studio stored it before the live header: frozen chrome around an owner body. */
function frozenPage(body: string): CmsPage {
  const html = `<div id="cms-site-shell"><header id="cms-site-header"><div id="knc-header">Old logo</div></header><nav id="cms-site-menu" aria-label="Sidmeny"><a href="/sida-a?lang=sv&amp;mode=light">Sida A</a></nav><div id="cms-site-content">${body}</div><footer id="cms-site-footer"><a href="/privacy">Integritetspolicy</a></footer></div>`
  const css =
    '[id="cms-site-shell"]{color:#eee;background:#111}\n' +
    '#owner-title{color:#123456}\n' +
    '[id="cms-site-header"]>div{position:relative}:where([id="cms-site-header"]) a{color:inherit}\n' +
    '#cms-site-menu,#cms-site-footer{padding:0}\n' +
    '[id="cms-site-content"]{flex:1;min-width:0}\n' +
    '@media(max-width:768px){[id="cms-site-header"] .cms-site-chrome{display:grid}}\n' +
    '@media(max-width:768px){#owner-title{font-size:20px}[id="cms-site-header"]>div{padding:16px}}'
  return {
    id: '0b5d1c8e-8f0e-4f7e-9d43-6f1f5f4e2a10',
    kind: 'page',
    path: '/hemsida',
    inMenu: true,
    name: { sv: 'Ny sida', en: 'New page' },
    title: { sv: 'Ny sida', en: 'New page' },
    description: { sv: '', en: '' },
    content: {
      sv: { html, css: { light: css, dark: css } },
      en: { html, css: { light: css, dark: css } },
    },
    layout: 'independent',
  }
}
// Entities, a void element and both quote styles, as an owner edit may leave them.
const ownerBody = `<main id="owner"><h1 id='owner-title' title="Tid &amp; plats">Öppet&nbsp;i dag &lt;3</h1><p>Rad ett<br>rad två</p></main>`

describe('frozen chrome of pages made before the live header', () => {
  it('drops the chrome, keeps the owner body and its CSS byte for byte, and is idempotent', () => {
    const page = frozenPage(ownerBody)
    const migrated = dropFrozenChrome(page)
    expect(migrated.layout).toBeUndefined()
    expect('layout' in migrated).toBe(false)
    expect(migrated.content.sv.html).toBe(ownerBody)
    expect(migrated.content.en.css.dark).toBe(
      '\n#owner-title{color:#123456}\n\n\n[id="cms-site-content"]{flex:1;min-width:0}\n\n@media(max-width:768px){#owner-title{font-size:20px}}',
    )
    expect(dropFrozenChrome(migrated)).toBe(migrated)
    const plain = created('/plain', 'Plain')
    expect(dropFrozenChrome(plain)).toBe(plain)
  })

  it('renders a migrated frozen page with the live header only', () => {
    const page = dropFrozenChrome(frozenPage(ownerBody))
    const html = renderSitePage(presentationWith(page), page, 'sv', 'light', contact).html
    expect(html).not.toMatch(/Old logo|cms-site-shell|cms-site-footer|Integritetspolicy/)
    expect(html.match(/id="cms-site-header"/g)).toHaveLength(1)
    expect(html).toContain(`<div id="cms-site-content">${ownerBody}</div>`)
  })

  it('ends with the live header after restoring an old revision and after importing a file', () => {
    // Without the fixture: its legacy About zoom needs a DOM, which the node environment lacks.
    const old = emptyDocument()
    old.presentation.pages.push(frozenPage(ownerBody))
    const restored = normalizeDocument(restoreRevision(old, emptyDocument()).document)
    const imported = normalizeDocument(JSON.parse(JSON.stringify(old)))
    for (const document of [restored, imported]) {
      const page = document.presentation.pages.find((item) => item.path === '/hemsida')
      if (!page) throw new Error('The created page was lost')
      expect(page.layout).toBeUndefined()
      expect(page.content.sv.html).toBe(ownerBody)
      const html = renderSitePage(document.presentation, page, 'sv', 'dark', contact).html
      expect(html).toContain('<header id="cms-site-header">')
      expect(html).not.toContain('Old logo')
    }
    expect(normalizeDocument(restored)).toBe(restored)
  })
})

describe('the Worker response of created and legal pages', () => {
  const canonical = 'https://bladeblendstudio.se/hemsida'

  it('serves a created page in auto mode with one live header and the base sheet', () => {
    const page = created('/hemsida', 'Ny sida')
    const presentation = presentationWith(page)
    const html = renderCmsPage(
      indexHtml,
      page,
      'sv',
      null,
      canonical,
      '',
      presentation,
      SITE_PAGE_CSS,
      contact,
    )
    expect(html).toContain('data-cms-mode="auto"')
    expect(html.match(/<header id="cms-site-header">/g)).toHaveLength(1)
    expect(html).toContain('<style id="cms-page-dark" media="(prefers-color-scheme: dark)">')
    expect(html).toContain(`<style id="cms-base">${SITE_PAGE_CSS}</style>`)
    expect(html).toContain('href="tel:0701234567"')
  })

  it('preloads only the homepage icons an authored document uses', () => {
    const page = created('/hemsida', 'Ny sida')
    const presentation = presentationWith(page)
    const site = renderCmsPage(
      indexHtml,
      page,
      'sv',
      'light',
      canonical,
      '',
      presentation,
      SITE_PAGE_CSS,
      contact,
    )
    const legal = presentation.pages.find((item) => item.path === '/terms')
    if (!legal) throw new Error('The fixture has no /terms page')
    const terms = renderCmsPage(
      indexHtml,
      legal,
      'sv',
      'light',
      canonical,
      '',
      presentation,
      '',
      contact,
    )
    const icons = (html: string): string[] =>
      [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*href="(\/icons\/[^"]+)"/g)].map(
        (match) => match[1] ?? '',
      )
    expect(icons(indexHtml)).toHaveLength(4)
    expect(icons(site)).toEqual(['/icons/mappin.circle.fill.svg', '/icons/phone.svg'])
    expect(icons(terms)).toEqual([])
  })
})

describe('the Worker never migrates a frozen page', () => {
  it('classifies a frozen page as served as stored without migrating it', () => {
    const frozen = frozenPage(ownerBody)
    const unflagged: CmsPage = { ...frozen }
    delete unflagged.layout
    const flagged: CmsPage = { ...created('/flag', 'Flag'), layout: 'independent' }
    for (const page of [frozen, unflagged, flagged]) {
      expect(isFrozenSitePage(page)).toBe(true)
      expect(isLiveSitePage(page)).toBe(false)
    }
    expect(isLiveSitePage(created('/hemsida', 'Ny sida'))).toBe(true)
    expect(isLiveSitePage(dropFrozenChrome(frozen))).toBe(true)
    const presentation = presentationWith(frozen)
    const about = presentation.pages.find((item) => item.path === '/about')
    if (!about) throw new Error('The fixture has no /about page')
    expect(isLiveSitePage(about)).toBe(false)
    const html = renderCmsPage(
      indexHtml,
      frozen,
      'sv',
      null,
      'https://bladeblendstudio.se/hemsida',
      '',
      presentation,
      '',
      contact,
    )
    expect(html).toContain('Old logo')
    expect(html).toContain('Integritetspolicy')
    expect(withId(html, 'cms-site-header')).toHaveLength(1)
    expect(html).not.toContain('cms-site-bar')
  })
})

const withHome = (html: string): CmsPresentation => {
  const presentation = published()
  const home = presentation.pages.find((item) => item.path === '/')
  if (!home) throw new Error('The fixture has no homepage')
  home.content = { sv: { ...home.content.sv, html }, en: { ...home.content.en, html } }
  return presentation
}
/** The raw logo element as the whole homepage markup parses it: extraction only, no cleaning. */
function fullParseLogoElement(html: string): string {
  const surface = findElement(
    parseFragment(html),
    (node) => value(node, 'data-knc-surface') === 'desktop-home',
  )
  const bar = surface && children(surface)[0]
  const brand = bar && findElement(bar, (node) => node.tagName === 'h1')
  const logo = brand && findElement(brand, (node) => ['svg', 'img'].includes(node.tagName))
  return logo ? serializeOuter(logo) : ''
}
const sliceLogoElement = (html: string): string => {
  const logo = homepageLogoElement(html)
  return logo ? serializeOuter(logo) : ''
}
const brandOf = (logo: string, attributes = ''): string =>
  `<div${attributes} data-knc-surface="desktop-home"><div><h1>${logo}</h1></div></div>`

describe('the homepage logo of the live header', () => {
  it('extracts the same raw logo as a whole-document parse on revision 56, from a small slice', () => {
    const presentation = published()
    for (const lang of ['sv', 'en'] as const) {
      const html = presentation.pages.find((item) => item.path === '/')?.content[lang].html ?? ''
      expect(sliceLogoElement(html)).toMatch(/^<svg\b/)
      expect(sliceLogoElement(html)).toBe(fullParseLogoElement(html))
      expect(desktopBrandSource(html).length).toBeLessThan(html.length / 4)
    }
  })

  it('extracts the same logo as a whole parse when attribute values move the slice boundaries', () => {
    const svg = '<svg viewBox="0 0 4 4"><path d="M0 0h4"></path></svg>'
    for (const html of [
      `<div title="<" data-knc-surface="desktop-home"><div><h1>${svg}</h1></div></div>`,
      `<div data-knc-surface="desktop-home"><div><h1 title="</h1>">${svg}</h1></div></div>`,
    ]) {
      expect(fullParseLogoElement(html)).toBe(svg)
      expect(sliceLogoElement(html)).toBe(svg)
      expect(homepageLogo(withHome(html), 'sv')).toBe(svg)
    }
  })

  it('parses the whole markup when a comment opens before the slice or a value cuts the logo', () => {
    const svg = '<svg viewBox="0 0 4 4"><path d="M0 0h4"></path></svg>'
    const commented = `<!-- <div data-knc-surface="desktop-home"><div><h1><svg id="fake"><style>a{}</style></svg></h1></div></div> -->${brandOf(svg)}`
    const cut = brandOf('<svg viewBox="0 0 4 4"><path title="</h1>" d="M0 0h4"></path></svg>')
    expect(fullParseLogoElement(commented)).toBe(svg)
    expect(sliceLogoElement(commented)).toBe(svg)
    expect(fullParseLogoElement(cut)).toMatch(/^<svg viewBox="0 0 4 4"><path title="<\/h1>"/)
    expect(sliceLogoElement(cut)).toBe(fullParseLogoElement(cut))
  })

  it('is empty when the homepage has no desktop surface or no graphic in its brand', () => {
    for (const html of [
      '<main><h1>Blade</h1></main>',
      '<div data-knc-surface="desktop-home"><div><h1>Blade</h1></div><main><h1><svg></svg></h1></main></div>',
    ]) {
      expect(homepageLogo(withHome(html), 'sv')).toBe('')
      expect(fullParseLogoElement(html)).toBe('')
    }
  })

  it('keeps its own SVG references working under cms-logo- ids; only the root loses its identity', () => {
    const logo =
      '<svg id="knc-logo" style="color:red" data-knc-light="x" aria-labelledby="t outside" viewBox="0 0 10 10"><title id="t">Blade</title><desc id="d">Logo</desc><defs><path id="s" d="M0 0h1"/><linearGradient id="g"><stop offset="0"/></linearGradient></defs><use href="#s" fill="url(#g)" stroke="url(\'#g\')" data-gjs-type="svg-in"/><use xlink:href="#s" aria-describedby="d"/><use href="#outside" fill="url(#outside)"/></svg>'
    const cleaned = homepageLogo(withHome(brandOf(logo)), 'sv')
    expect(cleaned).toMatch(/^<svg aria-labelledby="cms-logo-t outside" viewBox="0 0 10 10">/)
    expect(cleaned).toContain('<title id="cms-logo-t">')
    expect(cleaned).toContain('<path id="cms-logo-s" d="M0 0h1">')
    expect(cleaned).toContain('<linearGradient id="cms-logo-g">')
    expect(cleaned).toContain(
      '<use href="#cms-logo-s" fill="url(#cms-logo-g)" stroke="url(#cms-logo-g)">',
    )
    expect(cleaned).toContain('<use xlink:href="#cms-logo-s" aria-describedby="cms-logo-d">')
    expect(cleaned).toContain('<use href="#outside" fill="url(#outside)">')
    expect(cleaned).not.toMatch(/data-knc-|data-gjs-|style=|id="knc-logo"/)
  })

  it('renames every CSS url() spelling of a logo id', () => {
    const logo =
      '<svg viewBox="0 0 10 10"><linearGradient id="paint"></linearGradient><rect fill="URL(#paint)"/><rect fill="uRl(#paint)"/><rect fill="url(#pa\\69nt)"/></svg>'
    const cleaned = homepageLogo(withHome(brandOf(logo)), 'sv')
    expect(cleaned).toContain('<linearGradient id="cms-logo-paint">')
    expect(cleaned.match(/fill="url\(#cms-logo-paint\)"/g)).toHaveLength(3)
  })

  it('allocates a free logo id when the body already uses cms-logo-<id>', () => {
    const logo =
      '<svg viewBox="0 0 10 10"><linearGradient id="paint"></linearGradient><rect id="logo-rect" fill="url(#paint)"/></svg>'
    const presentation = withHome(brandOf(logo))
    const page = created('/hemsida', 'Ny sida')
    page.content.sv = {
      ...page.content.sv,
      html: '<main><svg><linearGradient id="cms-logo-paint"></linearGradient><rect id="body-rect" fill="url(#cms-logo-paint)"/></svg></main>',
    }
    presentation.pages.push(page)
    const html = renderSitePage(presentation, page, 'sv', 'light', contact).html
    const ids = parsedElements(html).flatMap((node) => value(node, 'id') ?? [])
    expect(new Set(ids).size).toBe(ids.length)
    const header = withId(html, 'cms-site-header')[0]
    if (!header) throw new Error('No header')
    const logoIds = new Set(descendants(header).flatMap((node) => value(node, 'id') ?? []))
    const logoRect = withId(html, 'cms-logo-logo-rect')[0]
    const bodyRect = withId(html, 'body-rect')[0]
    if (!logoRect || !bodyRect) throw new Error('A rect is missing')
    expect(value(logoRect, 'fill')).toBe('url(#cms-logo-paint-2)')
    expect(logoIds.has('cms-logo-paint-2')).toBe(true)
    expect(value(bodyRect, 'fill')).toBe('url(#cms-logo-paint)')
    expect(logoIds.has('cms-logo-paint')).toBe(false)
    expect(withId(html, 'cms-logo-paint')).toHaveLength(1)
  })

  it('cannot bind a body reference to the logo: the logo and the body both define id="paint"', () => {
    const logo =
      '<svg viewBox="0 0 10 10"><linearGradient id="paint"><stop offset="0"/></linearGradient><rect width="10" height="10" fill="url(#paint)"/></svg>'
    const presentation = withHome(brandOf(logo))
    const page = created('/hemsida', 'Ny sida')
    const body =
      '<main id="b"><svg><linearGradient id="paint"><stop offset="1"/></linearGradient><rect id="body-rect" fill="url(#paint)"/></svg></main>'
    page.content.sv = { ...page.content.sv, html: body }
    presentation.pages.push(page)
    const html = renderSitePage(presentation, page, 'sv', 'light', contact).html
    const ids = parsedElements(html).flatMap((node) => value(node, 'id') ?? [])
    expect(new Set(ids).size).toBe(ids.length)
    const header = withId(html, 'cms-site-header')[0]
    if (!header) throw new Error('No header')
    const logoIds = new Set(descendants(header).flatMap((node) => value(node, 'id') ?? []))
    const logoReferences = descendants(header).flatMap((node) =>
      node.attrs.flatMap((item) => [...item.value.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])),
    )
    expect(logoReferences).toEqual(['cms-logo-paint'])
    for (const id of logoReferences) expect(logoIds.has(id ?? '')).toBe(true)
    expect(withId(html, 'paint')).toHaveLength(1)
    expect(value(withId(html, 'body-rect')[0] as Element, 'fill')).toBe('url(#paint)')
  })
})

describe('frozen chrome rules and pseudo-class arguments', () => {
  it('drops matching pseudo-classes whose every argument is chrome and keeps the rest', () => {
    for (const rule of [
      ':not(#cms-site-header){color:red}',
      ':is(#cms-site-header,#owner-title){color:red}',
      ':where(#cms-site-header,#owner) p{margin:0}',
      ':has(#cms-site-menu){color:red}',
      '#cms-site-header a,#owner-title{color:red}',
      ':is(#cms-site-header) + #cms-site-content{padding:32px}',
      '#cms-site-header ~ p{color:red}',
      ':is(#cms-site-header + p){color:red}',
    ])
      expect(withoutFrozenChromeCss(rule)).toBe(rule)
    for (const rule of [
      ':is(#cms-site-header){display:none}',
      ':where(#cms-site-header) a{color:inherit}',
      ':where([id="cms-site-menu"]) p{margin:0}',
      ':-webkit-any(#cms-site-footer, :is(#cms-site-header)){color:red}',
      '#cms-site-header :is(a){color:red}',
      '#cms-site-header a + b{color:red}',
      '#cms-site-menu > a{color:red}',
      '[id="cms-site-shell"] main{padding:0}',
    ])
      expect(withoutFrozenChromeCss(rule)).toBe('')
  })
})

describe('which created pages the Worker treats as frozen', () => {
  const live = (sv: string, en = '<main><p>Hej</p></main>'): CmsPage => {
    const page = created('/hemsida', 'Ny sida')
    page.content.sv = { ...page.content.sv, html: sv }
    page.content.en = { ...page.content.en, html: en }
    return page
  }
  it('is frozen only for the legacy flag or a real start tag with the shell id', () => {
    for (const page of [
      live('<main><p>cms-site-shell</p><p>&lt;div id="cms-site-shell"&gt;</p></main>'),
      live('<main><!-- cms-site-shell --><p>Text</p></main>'),
      live('<main><p data-note="cms-site-shell" title="id=cms-site-shell">Text</p></main>'),
      live('<main><p>Hej</p></main>', '<main><p>cms-site-shell</p></main>'),
    ]) {
      expect(isFrozenSitePage(page)).toBe(false)
      expect(isLiveSitePage(page)).toBe(true)
    }
    for (const page of [
      live('<main id="CMS-SITE-SHELL"></main>'),
      live('<div id="Cms-Site-Shell"><main></main></div>'),
    ])
      expect(isFrozenSitePage(page)).toBe(false)
    expect(isFrozenSitePage(live('<DIV id="cms-site-shell"><main></main></DIV>'))).toBe(true)
    const flagged: CmsPage = { ...live('<main></main>'), layout: 'independent' }
    expect(isFrozenSitePage(flagged)).toBe(true)
    const shell = live('<main></main>', '<div id="cms-site-shell"><main></main></div>')
    expect(isFrozenSitePage(shell)).toBe(true)
    expect(isFrozenSitePage(frozenPage(ownerBody))).toBe(true)
  })

  it.each([
    '<main><!-- <div id="cms-site-shell"> --><p>Owner text</p></main>',
    '<main title=\' id="cms-site-shell"\'><p>Owner text</p></main>',
  ])('keeps accepted shell lookalikes live and unchanged in either language: %s', (html) => {
    expect(() =>
      validateMarkup(html, '', {
        siteOrigin: 'https://bladeblendstudio.se',
        storageOrigin: 'https://fixture.supabase.co',
      }),
    ).not.toThrow()
    for (const lang of ['sv', 'en'] as const) {
      const page = live('<main><p>Owner text</p></main>')
      page.content[lang].html = html
      page.content[lang].css = {
        light: '#cms-site-header{color:#123456}',
        dark: '#cms-site-header{color:#abcdef}',
      }
      expect(isFrozenSitePage(page)).toBe(false)
      expect(isLiveSitePage(page)).toBe(true)
      expect(dropFrozenChrome(page)).toBe(page)
      const document = emptyDocument()
      document.presentation.pages = [page]
      expect(normalizeDocument(document)).toBe(document)
      expect(page.content[lang].html).toBe(html)
    }
  })
})

describe('the preview of a created page (history review included)', () => {
  it('shows one live header and no footer for a frozen page from an old revision', () => {
    const frozen = frozenPage(ownerBody)
    const presentation = presentationWith(frozen)
    for (const lang of ['sv', 'en'] as const) {
      const html = previewSitePage(presentation, frozen, lang, 'dark', contact).html
      expect(withId(html, 'cms-site-header')).toHaveLength(1)
      expect(withId(html, 'cms-site-menu')).toHaveLength(1)
      expect(withId(html, 'cms-site-footer')).toHaveLength(0)
      expect(html).not.toMatch(/Old logo|Integritetspolicy|cms-site-shell/)
      expect(html).toContain('cms-site-bar')
    }
    const current = created('/hemsida', 'Ny sida')
    expect(previewSitePage(presentationWith(current), current, 'sv', 'light', contact)).toEqual(
      renderSitePage(presentationWith(current), current, 'sv', 'light', contact),
    )
  })
})

describe('a current-format page through the Studio normalisation', () => {
  it('comes back unchanged even when its own CSS names the live header', () => {
    const page = created('/hemsida', 'Ny sida')
    const css =
      '#cms-site-header{color:red}\n:is(#cms-site-header) + #cms-site-content{padding:32px}'
    page.content.sv = { ...page.content.sv, css: { light: css, dark: css } }
    const document = emptyDocument()
    document.presentation.pages.push(page)
    expect(dropFrozenChrome(page)).toBe(page)
    const normalised = normalizeDocument(document)
    expect(normalised.presentation.pages.find((item) => item.id === page.id)).toEqual(page)
  })
})
