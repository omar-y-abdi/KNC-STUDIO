import { isFrozenSitePage } from './cms-frozen-page.ts'
import { generate, ident, parse, walk, type Atrule, type CssNode, type Rule } from 'css-tree'
import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import {
  isMenuPage,
  isSitePage,
  type CmsDocument,
  type CmsLang,
  type CmsMode,
  type CmsPage,
  type CmsPresentation,
  type Localized,
  type PageVariant,
} from './cms.ts'

export { isSitePage } from './cms.ts'
export { isFrozenSitePage } from './cms-frozen-page.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const attr = (node: Element, name: string): string =>
  node.attrs.find((item) => item.name === name)?.value ?? ''
const elements = (node: Node): Element[] =>
  'childNodes' in node
    ? node.childNodes.filter((child): child is Element => 'tagName' in child)
    : []
function find(node: Node, predicate: (node: Element) => boolean): Element | undefined {
  if ('tagName' in node && predicate(node)) return node
  for (const child of elements(node)) {
    const result = find(child, predicate)
    if (result) return result
  }
  return undefined
}
const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** The salon's contact links in the site header; an empty value hides its link. The Worker passes
 * the published business settings, the editor the draft's, both resolved by resolveBusinessSettings. */
export interface SiteContact {
  readonly phoneTel: string
  readonly phoneDisplay: string
  readonly mapsHref: string
}

/** The scheme a response pins, or null when it follows the visitor's OS (`data-cms-mode="auto"`). */
export type ServedMode = CmsMode | null

export interface MenuLink {
  readonly href: string
  readonly label: string
}

const query = (lang: CmsLang, mode: ServedMode): string =>
  `?lang=${lang}${mode ? `&mode=${mode}` : ''}`

/** The site menu in the served language and scheme: the three native pages, then every created
 * page and Contact shown in the menu, in presentation order. A deleted page is simply absent from
 * `presentation.pages`. */
export function menuLinks(
  presentation: CmsPresentation,
  lang: CmsLang,
  mode: ServedMode,
): readonly MenuLink[] {
  const native = [
    ['/', 'Hem', 'Home'],
    ['/booking', 'Boka tid', 'Book'],
    ['/about', 'Om oss', 'About'],
  ] as const
  return [
    ...native.map(([path, sv, en]) => ({
      href: `${path}${query(lang, mode)}`,
      label: lang === 'sv' ? sv : en,
    })),
    ...presentation.pages
      .filter((page) => page.inMenu && isMenuPage(page))
      .map((page) => ({ href: `${page.path}${query(lang, mode)}`, label: page.name[lang] })),
  ]
}

const LOGO_ATTRIBUTE = /^(?:id|style|class|inert|draggable|contenteditable|tabindex|on.*)$/i
const OWNED_ATTRIBUTE = /^data-(?:knc|gjs)-/i

const DESKTOP_HOME = 'data-knc-surface="desktop-home"'

/** Where the desktop brand's slice of the homepage markup starts: the `<` of the desktop-home
 * surface's start tag; -1 when the marker is not found. */
function brandSliceStart(html: string): number {
  const marker = html.indexOf(DESKTOP_HOME)
  return marker < 0 ? -1 : html.lastIndexOf('<', marker)
}

/** The part of the homepage markup that holds the desktop brand: from the desktop-home surface's
 * start tag to the first `</h1>` after it. The bar is the surface's first element, so its first h1
 * is the first heading after that tag. The whole markup when the marker is not found. */
export function desktopBrandSource(html: string): string {
  const start = brandSliceStart(html)
  if (start < 0) return html
  const end = html.indexOf('</h1>', start)
  return html.slice(start, end < 0 ? html.length : end + '</h1>'.length)
}

interface FoundLogo {
  readonly brand: Element
  readonly logo: Element
}

/** The first graphic in the brand h1 of the desktop-home surface's first element (its bar). */
function logoIn(html: string, locations: boolean): FoundLogo | undefined {
  const surface = find(
    parseFragment(html, { sourceCodeLocationInfo: locations }),
    (node) => attr(node, 'data-knc-surface') === 'desktop-home',
  )
  const bar = surface && elements(surface)[0]
  const brand = bar && find(bar, (node) => node.tagName === 'h1')
  const logo = brand && find(brand, (node) => node.tagName === 'svg' || node.tagName === 'img')
  return brand && logo ? { brand, logo } : undefined
}

/** Whether an element was closed by its own end tag inside the parsed text (an img has none). */
const closed = (node: Element): boolean =>
  node.tagName === 'img' || node.sourceCodeLocation?.endTag !== undefined

/** The homepage's raw logo element. The brand slice is trusted only when it cannot have been cut
 * wrongly: no comment is open where it starts (a commented-out surface would otherwise parse as
 * real), and both the logo and its brand h1 end inside it with their own end tags (an attribute
 * value holding `</h1>` cuts the slice early, which leaves one of them unclosed). Otherwise the
 * whole markup is parsed, so the result always equals a full parse. */
export function homepageLogoElement(html: string): Element | undefined {
  const start = brandSliceStart(html)
  const commentOpen = start >= 0 && html.lastIndexOf('<!--', start) > html.lastIndexOf('-->', start)
  if (start >= 0 && !commentOpen) {
    const sliced = logoIn(desktopBrandSource(html), true)
    if (sliced && closed(sliced.logo) && closed(sliced.brand)) return sliced.logo
  }
  return logoIn(html, false)?.logo
}

const LOGO_ID_PREFIX = 'cms-logo-'
const ID_LIST_ATTRIBUTES = new Set(['aria-labelledby', 'aria-describedby'])

/** The SVG presentation attributes the validator reads as CSS (CSS_URL_ATTRIBUTES in cms-markup.ts),
 * so the only attributes left on a logo where `url(#id)` is a reference rather than text. */
const PAINT_ATTRIBUTES = new Set(['fill', 'stroke', 'clip-path', 'mask'])

/** A paint attribute's value with every CSS `url(#id)` naming a renamed id rewritten. It is read as
 * the validator reads it, as the declaration `name:value`, so `!important` or a second declaration
 * parses too; css-tree reads the url() spellings and escapes CSS allows (`URL(#a)`, `url('#a')`,
 * `url(#\61)`); a value with no rename keeps its bytes. */
function renamedUrls(name: string, value: string, rename: ReadonlyMap<string, string>): string {
  if (!/url\(/i.test(value)) return value
  const tree = parse(`${name}:${value}`, { context: 'declarationList', parseCustomProperty: true })
  let changed = false
  walk(tree, (node) => {
    if (node.type !== 'Url' || !node.value.startsWith('#')) return
    const target = rename.get(node.value.slice(1))
    if (target === undefined) return
    node.value = `#${target}`
    changed = true
  })
  return changed ? generate(tree).slice(name.length + 1) : value
}

/** The homepage logo as it is stored now (the first graphic in the desktop header's brand), without
 * the homepage's styles and owned attributes; '' when the homepage has none. The root loses its
 * identity. The ids inside it are the targets of its own references, so they stay, renamed to
 * cms-logo-<id> (then -2, -3, … while the name is in `taken`, the page body's ids, or already
 * allocated) so they cannot collide with ids in the page body; every `#id` href and xlink:href,
 * `url(#id)` in a paint attribute and aria-labelledby/-describedby token naming one of them is
 * renamed with it. References to ids outside the logo are left as they are, and so is text: a
 * `url(#id)` in an aria-label, alt or title keeps its bytes. */
export function homepageLogo(
  presentation: CmsPresentation,
  lang: CmsLang,
  taken: ReadonlySet<string> = new Set(),
): string {
  const home = presentation.pages.find((page) => page.path === '/')?.content[lang]
  const logo = home && homepageLogoElement(home.html)
  if (!logo) return ''
  const rename = new Map<string, string>()
  const allocated = new Set<string>()
  const allocate = (id: string): void => {
    if (rename.has(id)) return
    let name = `${LOGO_ID_PREFIX}${id}`
    for (let suffix = 2; taken.has(name) || allocated.has(name); suffix++)
      name = `${LOGO_ID_PREFIX}${id}-${suffix}`
    rename.set(id, name)
    allocated.add(name)
  }
  const collect = (node: Element): void => {
    for (const child of elements(node)) {
      const id = attr(child, 'id')
      if (id) allocate(id)
      collect(child)
    }
  }
  collect(logo)
  const renamed = (id: string): string => rename.get(id) ?? id
  const reference = (name: string, value: string): string => {
    if (name === 'href' && value.startsWith('#')) return `#${renamed(value.slice(1))}`
    if (ID_LIST_ATTRIBUTES.has(name)) return value.replace(/[^\s]+/g, (token) => renamed(token))
    return PAINT_ATTRIBUTES.has(name) ? renamedUrls(name, value, rename) : value
  }
  const clean = (node: Element, root: boolean): void => {
    node.attrs = node.attrs
      .filter(
        (item) =>
          !(LOGO_ATTRIBUTE.test(item.name) && (root || item.name.toLowerCase() !== 'id')) &&
          !OWNED_ATTRIBUTE.test(item.name),
      )
      .map((item) => {
        const name = item.name.toLowerCase()
        return {
          ...item,
          value: name === 'id' ? renamed(item.value) : reference(name, item.value),
        }
      })
    for (const child of elements(node)) clean(child, false)
  }
  clean(logo, true)
  return serializeOuter(logo)
}

/** The live site header: the current homepage logo, the contact links, the language and theme
 * actions and the menu. Its markup carries no inline style, so one header serves both schemes. */
export function siteHeader(
  presentation: CmsPresentation,
  page: CmsPage,
  lang: CmsLang,
  mode: ServedMode,
  contact: SiteContact,
  taken: ReadonlySet<string> = new Set(),
): string {
  const sv = lang === 'sv'
  const other = sv ? 'en' : 'sv'
  const logo = homepageLogo(presentation, lang, taken)
  const brand = `<a class="cms-site-brand" href="${escape(`/${query(lang, mode)}`)}">${logo || escape(sv ? 'Startsida' : 'Home')}</a>`
  const directions = contact.mapsHref
    ? `<a class="cms-site-directions" href="${escape(contact.mapsHref)}" target="_blank" rel="noopener noreferrer">${sv ? 'Hitta oss' : 'Find us'}</a>`
    : ''
  const phone =
    contact.phoneTel && contact.phoneDisplay
      ? `<a class="cms-site-phone" href="tel:${escape(contact.phoneTel)}">${escape(contact.phoneDisplay)}</a>`
      : ''
  const languageLabel = sv ? 'Byt språk till engelska' : 'Switch language to Swedish'
  const language = `<a class="cms-site-action-language" href="${escape(`${page.path}${query(other, mode)}`)}" aria-label="${languageLabel}" title="${languageLabel}"><span aria-hidden="true"${sv ? ' class="is-current"' : ''}>SV</span><span aria-hidden="true"${sv ? '' : ' class="is-current"'}>EN</span></a>`
  // In auto mode the theme link pins dark; the page's theme script retargets it to the opposite of
  // the scheme the visitor sees.
  const themeLabel = sv ? 'Växla ljust/mörkt' : 'Toggle light/dark'
  const theme = `<a class="cms-site-action-theme" href="${escape(`${page.path}${query(lang, mode === 'dark' ? 'light' : 'dark')}`)}" aria-label="${themeLabel}" title="${themeLabel}"><span aria-hidden="true"></span></a>`
  const menu = menuLinks(presentation, lang, mode)
    .map(
      (link) =>
        `<a href="${escape(link.href)}"${link.href.startsWith(`${page.path}?`) ? ' aria-current="page"' : ''}>${escape(link.label)}</a>`,
    )
    .join('')
  return `<header id="cms-site-header"><div class="cms-site-bar">${brand}<div class="cms-site-controls">${directions}${phone}${language}${theme}</div></div><nav id="cms-site-menu" aria-label="${sv ? 'Sidmeny' : 'Pages'}">${menu}</nav></header>`
}

/** The live site footer: the privacy and terms links in the served language and scheme. It is
 * never stored, so the canvas locks it and capture drops it. */
function siteFooter(lang: CmsLang, mode: ServedMode): string {
  const sv = lang === 'sv'
  return `<footer id="cms-site-footer"><a href="${escape(`/privacy${query(lang, mode)}`)}">${sv ? 'Integritetspolicy' : 'Privacy policy'}</a><a href="${escape(`/terms${query(lang, mode)}`)}">${sv ? 'Bokningsvillkor' : 'Booking terms'}</a></footer>`
}

/** The base sheet of every created page in the Worker and the editor canvas: the same bytes for
 * both languages and both schemes, after /tokens.css. Colours are the homepage palette tokens
 * (light-dark() on the root's colour scheme) under the owner's theme variables, so the header
 * follows the homepage style live; the root is painted so a body of any shape has its surface. */
export const SITE_PAGE_CSS = [
  "@font-face{font-family:'Playfair Display';src:url('/fonts/PlayfairDisplay-Latin-400.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}",
  "@font-face{font-family:'Playfair Display';src:url('/fonts/PlayfairDisplay-Latin-700.woff2') format('woff2');font-style:normal;font-weight:700;font-display:swap}",
  '*,*::before,*::after{box-sizing:border-box}',
  ':root{background:var(--knc-background,var(--bb-bg));color:var(--knc-text,var(--bb-text));font-family:var(--knc-fontFamily,var(--bb-font));-webkit-font-smoothing:antialiased}',
  'body{margin:0}',
  '#cms-site-header{background:var(--knc-surface,var(--bb-surface));color:var(--knc-text,var(--bb-text));font-size:13px;line-height:1.4}',
  '#cms-site-header a{color:inherit;text-decoration:none}',
  '#cms-site-header :focus-visible{outline:2px solid var(--knc-text,var(--bb-text));outline-offset:2px}',
  '#cms-site-header .cms-site-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;min-height:61px;padding:15px 30px;border-bottom:.5px solid var(--knc-border,var(--bb-line))}',
  '#cms-site-header .cms-site-brand{display:flex;align-items:center;min-width:0}',
  '#cms-site-header .cms-site-brand svg,#cms-site-header .cms-site-brand img{display:block;width:auto;max-width:100%;height:30px}',
  '#cms-site-header .cms-site-controls{display:flex;flex-wrap:wrap;align-items:center;gap:14px}',
  '#cms-site-header .cms-site-directions,#cms-site-header .cms-site-phone{display:flex;align-items:center;gap:6px;white-space:nowrap}',
  '#cms-site-header .cms-site-directions{padding:7px 14px;border:.5px solid var(--knc-border,var(--bb-line));border-radius:999px;font-weight:600}',
  '#cms-site-header .cms-site-phone{color:var(--knc-muted,var(--bb-muted))}',
  "#cms-site-header .cms-site-directions::before,#cms-site-header .cms-site-phone::before{content:'';flex:none;width:15px;height:15px;background:currentColor;opacity:.7;-webkit-mask-position:center;mask-position:center;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:contain;mask-size:contain}",
  "#cms-site-header .cms-site-directions::before{-webkit-mask-image:url('/icons/mappin.circle.fill.svg');mask-image:url('/icons/mappin.circle.fill.svg')}",
  "#cms-site-header .cms-site-phone::before{-webkit-mask-image:url('/icons/phone.svg');mask-image:url('/icons/phone.svg')}",
  '#cms-site-header .cms-site-action-language{display:flex;padding:2px;border-radius:999px;background:var(--bb-line)}',
  '#cms-site-header .cms-site-action-language span{padding:4px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.3px;color:var(--knc-muted,var(--bb-muted))}',
  '#cms-site-header .cms-site-action-language .is-current{background:var(--knc-accent,var(--bb-accent));color:var(--knc-accentText,var(--bb-accent-text))}',
  '#cms-site-header .cms-site-action-theme{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:var(--bb-line)}',
  '#cms-site-header .cms-site-action-theme span{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--knc-text,var(--bb-text));background:linear-gradient(90deg,var(--knc-text,var(--bb-text)) 50%,transparent 50%)}',
  '#cms-site-menu{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 24px;padding:14px 30px;border-bottom:.5px solid var(--knc-border,var(--bb-line));background:var(--knc-background,var(--bb-bg))}',
  '#cms-site-menu a{text-underline-offset:4px}',
  '#cms-site-menu a[aria-current="page"]{text-decoration:underline}',
  '#cms-site-content{min-width:0}',
  '#cms-site-footer{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 24px;padding:14px 30px;border-top:.5px solid var(--knc-border,var(--bb-line));background:var(--knc-background,var(--bb-bg));font-size:13px;line-height:1.4}',
  '#cms-site-footer a{color:var(--knc-muted,var(--bb-muted));text-decoration:none;text-underline-offset:4px}',
  '#cms-site-footer a:hover{text-decoration:underline}',
  '#cms-site-footer :focus-visible{outline:2px solid var(--knc-text,var(--bb-text));outline-offset:2px}',
  '@media (max-width:768px){#cms-site-header .cms-site-bar{gap:10px;padding:12px 22px}#cms-site-header .cms-site-brand svg,#cms-site-header .cms-site-brand img{height:24px}#cms-site-header .cms-site-controls{gap:8px}#cms-site-header .cms-site-directions{gap:4px;padding:6px 8px;font-size:11px}#cms-site-header .cms-site-phone{gap:4px;font-size:12px}#cms-site-menu{gap:8px 18px;padding:10px 22px}#cms-site-footer{gap:8px 18px;padding:10px 22px}}',
].join('\n')

/** Inline authored styles are a shared baseline for both themes. Give them stable selectors
 * before GrapesJS extracts them; otherwise the first light edit silently erases dark styling. */
export function normalizeSitePageContent(
  variant: CmsPage['content']['sv'],
  prefix: string,
): CmsPage['content']['sv'] {
  return normalizedSitePageBody(variant, prefix).variant
}

/** normalizeSitePageContent's result and the body's element ids, from the same single parse. */
function normalizedSitePageBody(
  variant: CmsPage['content']['sv'],
  prefix: string,
): { readonly variant: CmsPage['content']['sv']; readonly ids: ReadonlySet<string> } {
  const tree = parseFragment(variant.html)
  const ids = new Set<string>()
  const styled: Element[] = []
  const collect = (node: Node): void => {
    if ('tagName' in node) {
      const present = attr(node, 'id')
      if (present) ids.add(present)
      if (attr(node, 'style')) styled.push(node)
    }
    for (const child of elements(node)) collect(child)
  }
  collect(tree)
  // Every body id is reserved before one is allocated, so a generated id never takes the id of an
  // element that comes before or after the styled one.
  let index = 0
  const rules = styled.map((node) => {
    let id = attr(node, 'id')
    if (!id) {
      id = `cms-page-${prefix}-${index++}`
      while (ids.has(id)) id = `cms-page-${prefix}-${index++}`
      node.attrs.push({ name: 'id', value: id })
      ids.add(id)
    }
    const rule = `[id=${JSON.stringify(id)}]{${attr(node, 'style')}}`
    node.attrs = node.attrs.filter((item) => item.name !== 'style')
    return rule
  })
  if (!rules.length) return { variant, ids }
  const baseline = rules.join('\n')
  return {
    variant: {
      html: serialize(tree),
      css: {
        light: `${baseline}\n${variant.css.light}`,
        dark: `${baseline}\n${variant.css.dark}`,
      },
    },
    ids,
  }
}

/** Frozen chrome that pages created before the live header stored around their body. The
 * migration finds it by these ids; capture of a current page finds the live chrome by its place in
 * the render instead (sitePageBody), since an owner element may carry the same ids. */
const FROZEN_CHROME = new Set(['cms-site-header', 'cms-site-menu', 'cms-site-footer'])
const FROZEN_WRAPPERS = new Set(['cms-site-shell', 'cms-site-content'])
const FROZEN_STYLED = new Set(['cms-site-shell', ...FROZEN_CHROME])

type Range = readonly [number, number]

function cut(text: string, ranges: readonly Range[]): string {
  return [...ranges]
    .sort((left, right) => right[0] - left[0])
    .reduce((rest, [start, end]) => rest.slice(0, start) + rest.slice(end), text)
}

/** The owner's body in a rendered current page, as the editor exports it: what lies between the
 * generated header (the first top-level element) and the generated footer (the last), with the
 * content wrapper (the element right after the header) unwrapped. They are found by their place
 * in the render, never by id: an owner element may carry any chrome id, and GrapesJS then renames
 * the generated copy that comes after it (cms-site-footer-2). Every byte of the body stays as
 * exported; html that does not start with the generated header is not a render and comes back
 * unchanged. */
export function sitePageBody(html: string): string {
  const [header, ...rest] = elements(parseFragment(html, { sourceCodeLocationInfo: true }))
  const start = header?.tagName === 'header' ? header.sourceCodeLocation : undefined
  if (!start) return html
  const last = rest.at(-1)
  const footer = last?.tagName === 'footer' ? last.sourceCodeLocation : undefined
  const first = footer ? rest.slice(0, -1)[0] : rest[0]
  const wrapper = first?.tagName === 'div' ? first.sourceCodeLocation : undefined
  const ranges: Range[] = [[0, start.endOffset]]
  if (footer) ranges.push([footer.startOffset, html.length])
  if (wrapper?.startTag) ranges.push([wrapper.startTag.startOffset, wrapper.startTag.endOffset])
  if (wrapper?.endTag) ranges.push([wrapper.endTag.startOffset, wrapper.endTag.endOffset])
  return cut(html, ranges)
}

/** The owner's body in stored html of a frozen page: the frozen header, menu and footer removed,
 * the shell and content wrappers unwrapped. Every other byte stays exactly as stored. */
function frozenSitePageBody(html: string): string {
  if (!html.includes('cms-site-')) return html
  const ranges: Range[] = []
  const visit = (node: Node): void => {
    for (const child of elements(node)) {
      const id = attr(child, 'id')
      const location = child.sourceCodeLocation
      if (location && FROZEN_CHROME.has(id)) {
        ranges.push([location.startOffset, location.endOffset])
        continue
      }
      if (location && FROZEN_WRAPPERS.has(id)) {
        if (location.startTag)
          ranges.push([location.startTag.startOffset, location.startTag.endOffset])
        if (location.endTag) ranges.push([location.endTag.startOffset, location.endTag.endOffset])
      }
      visit(child)
    }
  }
  visit(parseFragment(html, { sourceCodeLocationInfo: true }))
  return cut(html, ranges)
}

const MATCHING_PSEUDOS = new Set(['is', 'where', 'matches', '-webkit-any', '-moz-any'])

/** Whether one simple selector names the frozen shell, header, menu or footer. A matching
 * pseudo-class (`:is`, `:where`, `:matches`, `:-webkit-any`) counts only when every selector in its
 * argument does: `:is(#cms-site-header)` is chrome, `:is(#cms-site-header, #owner-title)` also
 * selects body elements. Other pseudo-class arguments (`:not`, `:has`, …) never count:
 * `:not(#cms-site-header)` selects the body. Names are compared as the browser reads them:
 * css-tree keeps identifiers escaped (`#cms\2d site-header` names cms-site-header) and decodes only
 * quoted strings, and an HTML attribute name has no case. An attribute value is compared exactly,
 * except under the `i` flag, which ignores its case (`[id="CMS-SITE-HEADER" i]` is chrome); the `s`
 * flag and no flag keep it exact. Only the `=` matcher names chrome: a substring matcher (`^=`,
 * `*=`, `$=`, `~=`, `|=`) can also match owner ids (`[id*="header"]` matches an owner
 * `page-header`), so dropping its rule could remove owner paint, and no earlier Studio wrote one. */
function namesFrozenChrome(node: CssNode): boolean {
  if (node.type === 'IdSelector') return FROZEN_STYLED.has(ident.decode(node.name))
  if (node.type === 'AttributeSelector') {
    if (
      ident.decode(node.name.name).toLowerCase() !== 'id' ||
      node.matcher !== '=' ||
      node.value === null
    )
      return false
    const value = node.value.type === 'String' ? node.value.value : ident.decode(node.value.name)
    // css-tree keeps the flag as written: `I` and an escaped `\69` are the same flag as `i`.
    const anyCase = node.flags !== null && ident.decode(node.flags).toLowerCase() === 'i'
    return FROZEN_STYLED.has(anyCase ? value.toLowerCase() : value)
  }
  if (node.type !== 'PseudoClassSelector' || !MATCHING_PSEUDOS.has(node.name.toLowerCase()))
    return false
  const selectors = (node.children?.toArray() ?? []).flatMap((child) =>
    child.type === 'SelectorList' ? child.children.toArray() : [child],
  )
  return selectors.length > 0 && selectors.every(referencesFrozenChrome)
}

/** Whether a complex selector targets the frozen chrome or something inside it: a compound that
 * names chrome counts when it is the subject or an ancestor of the subject (followed by a
 * descendant ' ' or child '>' combinator). Through '+' or '~' it is only a sibling of the subject,
 * as in `:is(#cms-site-header) + #cms-site-content`, so the rule stays. A rule that reaches the body
 * only through the removed #cms-site-shell ancestor is dropped by design: the homepage-style base
 * sheet replaces the frozen shell's styling. */
function referencesFrozenChrome(selector: CssNode): boolean {
  if (selector.type !== 'Selector') return false
  const compounds: { nodes: CssNode[]; next: string | null }[] = [{ nodes: [], next: null }]
  for (const node of selector.children.toArray()) {
    const current = compounds[compounds.length - 1]
    if (!current) break
    if (node.type === 'Combinator') {
      current.next = node.name
      compounds.push({ nodes: [], next: null })
    } else current.nodes.push(node)
  }
  return compounds.some(
    (compound) =>
      (compound.next === null || compound.next === ' ' || compound.next === '>') &&
      compound.nodes.some(namesFrozenChrome),
  )
}

const targetsFrozenChrome = (rule: Rule): boolean =>
  rule.prelude.type === 'SelectorList' &&
  !rule.prelude.children.isEmpty &&
  rule.prelude.children.toArray().every(referencesFrozenChrome)

/** A named `@layer` block declares its layer where it first appears, even with nothing left in
 * it: dropping it would move that layer after the ones declared later. */
const namedLayer = (node: Atrule): boolean =>
  node.name.toLowerCase() === 'layer' && node.prelude !== null

/** Stored CSS without the rules whose every selector targets the frozen shell, header, menu or
 * footer, at any depth (inside at-rules and nested in other rules), and without the rules and
 * at-rule blocks that leaves empty, except a named layer block, which stays as an empty block.
 * Every other byte stays as stored. */
export function withoutFrozenChromeCss(css: string): string {
  // An escape can spell any character of a chrome id, and under the i flag any case.
  if (!css.toLowerCase().includes('cms-site-') && !css.includes('\\')) return css
  const tree = parse(css, { positions: true })
  const dropped = new Set<CssNode>()
  const emptied = (node: Rule | Atrule): boolean =>
    node.block !== null &&
    !node.block.children.isEmpty &&
    node.block.children.toArray().every((child) => dropped.has(child))
  walk(tree, {
    leave(node: CssNode) {
      if (
        (node.type === 'Rule' && (targetsFrozenChrome(node) || emptied(node))) ||
        (node.type === 'Atrule' && !namedLayer(node) && emptied(node))
      )
        dropped.add(node)
    },
  })
  const ranges: Range[] = []
  const outermost = (node: CssNode): void => {
    if (dropped.has(node) && node.loc) ranges.push([node.loc.start.offset, node.loc.end.offset])
    else if (node.type === 'StyleSheet') node.children.forEach(outermost)
    else if (node.type === 'Atrule' || node.type === 'Rule') node.block?.children.forEach(outermost)
  }
  outermost(tree)
  return cut(css, ranges)
}

/** A created page without the frozen chrome an earlier Studio stored in it, and without the
 * `layout: 'independent'` flag that marked it; the same object when there was nothing to drop. */
export function dropFrozenChrome(page: CmsPage): CmsPage {
  // A current page's own CSS may name the live header's ids on purpose; only frozen pages migrate.
  if (!isSitePage(page) || !isFrozenSitePage(page)) return page
  const variant = (stored: PageVariant): PageVariant => {
    const html = frozenSitePageBody(stored.html)
    const light = withoutFrozenChromeCss(stored.css.light)
    const dark = withoutFrozenChromeCss(stored.css.dark)
    return html === stored.html && light === stored.css.light && dark === stored.css.dark
      ? stored
      : { html, css: { light, dark } }
  }
  const sv = variant(page.content.sv)
  const en = variant(page.content.en)
  if (sv === page.content.sv && en === page.content.en && page.layout === undefined) return page
  const next: CmsPage = { ...page, content: { sv, en } }
  delete next.layout
  return next
}

/** The document with every created page's frozen chrome dropped; the same object when none had any. */
export function dropDocumentChrome(document: CmsDocument): CmsDocument {
  const pages = document.presentation.pages.map(dropFrozenChrome)
  return pages.every((page, index) => page === document.presentation.pages[index])
    ? document
    : { ...document, presentation: { ...document.presentation, pages } }
}

export interface SitePageRender {
  /** The live header above `<div id="cms-site-content">` with the stored body, then the live footer. */
  readonly html: string
  /** The page's own CSS per scheme; SITE_PAGE_CSS is the base sheet below it. */
  readonly css: Record<CmsMode, string>
}

/** One renderer for the Worker, the editor canvas and the locked preview: the live header built
 * from the current presentation above the stored body, and the live footer below it. The stored
 * markup is the body whatever it holds; the Studio migrates a frozen page with dropFrozenChrome
 * before it renders one. */
export function renderSitePage(
  presentation: CmsPresentation,
  page: CmsPage,
  lang: CmsLang,
  mode: ServedMode,
  contact: SiteContact,
): SitePageRender {
  const { variant: body, ids } = normalizedSitePageBody(page.content[lang], `${page.id}-${lang}`)
  return {
    html: `${siteHeader(presentation, page, lang, mode, contact, ids)}<div id="cms-site-content">${body.html}</div>${siteFooter(lang, mode)}`,
    css: body.css,
  }
}

export const NEW_SITE_PAGE_TEXT: Localized = {
  sv: 'Skriv din text här.',
  en: 'Write your page here.',
}

/** A new created page: only its body, a small homepage-style template whose own CSS is the same
 * for both schemes. The header is never stored; renderSitePage adds the live one. */
export function createSitePage(identity: {
  readonly id: string
  readonly path: string
  readonly name: Localized
}): CmsPage {
  const variant = (lang: CmsLang): PageVariant => {
    const id = `cms-body-${identity.id}-${lang}`
    const css = `[id="${id}"]{max-width:1120px;min-height:55vh;margin:0 auto;padding:64px 32px}[id="${id}-title"]{margin:0 0 24px;font-size:40px;line-height:1.15;letter-spacing:-1px}[id="${id}-text"]{font-size:17px;line-height:1.7}@media (max-width:768px){[id="${id}"]{padding:40px 24px}}`
    return {
      html: `<main id="${id}"><h1 id="${id}-title">${escape(identity.name[lang])}</h1><p id="${id}-text">${NEW_SITE_PAGE_TEXT[lang]}</p></main>`,
      css: { light: css, dark: css },
    }
  }
  return {
    id: identity.id,
    kind: 'page',
    path: identity.path,
    inMenu: true,
    name: { ...identity.name },
    title: { ...identity.name },
    description: { sv: '', en: '' },
    content: { sv: variant('sv'), en: variant('en') },
  }
}
