import { themeDeclarations, siteThemeCss } from './site-theme.ts'
import { repairDesktopCss } from './cms-device-css.ts'
import { generate, parse, walk } from 'css-tree'
import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import type { CmsLang, CmsMode, CmsPage, CmsPresentation } from './cms'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const corePaths = new Set(['/', '/about', '/booking', '/my-bookings', '/privacy', '/terms'])
export const isSitePage = (page: CmsPage): boolean =>
  page.kind === 'page' && !corePaths.has(page.path)
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
const href = (path: string, lang: CmsLang, mode: CmsMode): string =>
  `${path}?lang=${lang}&amp;mode=${mode}`
const languageAction = 'cms-site-action-language'
const themeAction = 'cms-site-action-theme'
const hasClass = (node: Element, name: string): boolean =>
  attr(node, 'class').split(/\s+/).includes(name)
function addClass(node: Element, name: string): void {
  if (hasClass(node, name)) return
  const existing = attr(node, 'class').trim()
  node.attrs = node.attrs.filter((item) => item.name !== 'class')
  node.attrs.push({ name: 'class', value: existing ? `${existing} ${name}` : name })
}

function updateChromeActionLinks(html: string, path: string, lang: CmsLang, mode: CmsMode): string {
  const tree = parseFragment(html)
  const header = find(
    tree,
    (node) => node.tagName === 'header' && attr(node, 'id') === 'cms-site-header',
  )
  if (!header) return html
  let changed = false
  const update = (node: Node): void => {
    if ('tagName' in node && node.tagName === 'a') {
      const label = attr(node, 'aria-label')
      const taggedLanguage = hasClass(node, languageAction)
      const taggedTheme = hasClass(node, themeAction)
      const languageToggle =
        taggedLanguage ||
        (!taggedTheme &&
          (label === 'Byt språk till engelska' || label === 'Switch language to Swedish'))
      const themeToggle =
        !taggedLanguage &&
        (taggedTheme || label === 'Växla ljust/mörkt' || label === 'Toggle light/dark')
      if ((languageToggle || themeToggle) && attr(node, 'href')) {
        let url: URL
        try {
          url = new URL(attr(node, 'href'), 'https://site.invalid')
        } catch {
          return
        }
        if (url.origin !== 'https://site.invalid' || url.pathname !== path) return
        url.searchParams.set('lang', languageToggle ? (lang === 'sv' ? 'en' : 'sv') : lang)
        url.searchParams.set('mode', themeToggle ? (mode === 'light' ? 'dark' : 'light') : mode)
        node.attrs = node.attrs.map((item) =>
          item.name === 'href'
            ? { ...item, value: `${url.pathname}${url.search}${url.hash}` }
            : item,
        )
        addClass(node, languageToggle ? languageAction : themeAction)
        changed = true
      }
    }
    for (const child of elements(node)) update(child)
  }
  update(header)
  return changed ? serialize(tree) : html
}

export function sitePageLinks(pages: readonly CmsPage[], lang: CmsLang, mode: CmsMode): string {
  return pages
    .filter((page) => page.inMenu && isSitePage(page))
    .map((page) => `<a href="${href(page.path, lang, mode)}">${escape(page.name[lang])}</a>`)
    .join('')
}

/** Inline authored styles are a shared baseline for both themes. Give them stable selectors
 * before GrapesJS extracts them; otherwise the first light edit silently erases dark styling. */
export function normalizeSitePageContent(
  variant: CmsPage['content']['sv'],
  prefix: string,
): CmsPage['content']['sv'] {
  const tree = parseFragment(variant.html)
  const rules: string[] = []
  let index = 0
  const collect = (node: Node): void => {
    if ('tagName' in node) {
      const style = attr(node, 'style')
      if (style) {
        let id = attr(node, 'id')
        if (!id) {
          id = `cms-page-${prefix}-${index++}`
          node.attrs.push({ name: 'id', value: id })
        }
        rules.push(`[id=${JSON.stringify(id)}]{${style}}`)
        node.attrs = node.attrs.filter((item) => item.name !== 'style')
      }
    }
    for (const child of elements(node)) collect(child)
  }
  collect(tree)
  if (!rules.length) return variant
  const baseline = rules.join('\n')
  return {
    html: serialize(tree),
    css: { light: `${baseline}\n${variant.css.light}`, dark: `${baseline}\n${variant.css.dark}` },
  }
}

/** Like O-Y-A's layout(page, content): authored content uses the current site's real chrome.
 * Header, logo, contact details and footer come from the owner's homepage/About presentation.
 * This one function supplies the editor, locked preview and public Worker response.
 */
export function renderSitePage(
  presentation: CmsPresentation,
  page: CmsPage,
  lang: CmsLang,
  mode: CmsMode,
): { html: string; css: string } {
  const variant = normalizeSitePageContent(page.content[lang], `${page.id}-${lang}`)
  if (page.layout === 'independent')
    return {
      html: updateChromeActionLinks(variant.html, page.path, lang, mode),
      css: repairDesktopCss(variant.css[mode]),
    }
  const home = presentation.pages.find((item) => item.path === '/')?.content[lang]
  if (!home || !isSitePage(page)) return { html: variant.html, css: variant.css[mode] }
  const tree = parseFragment(home.html)
  const surface = find(tree, (node) => attr(node, 'data-knc-surface') === 'desktop-home')
  const header = surface && elements(surface)[0]
  const main = surface && elements(surface).find((node) => node.tagName === 'main')
  const hero = main && elements(main)[0]
  const info = hero && elements(hero).at(-1)
  if (!surface || !header || !info) throw new Error('Webbplatsens sidmall kunde inte läsas.')
  const about = presentation.pages.find((item) => item.path === '/about')?.content[lang]
  const footer = find(parseFragment(about?.html ?? home.html), (node) => node.tagName === 'footer')
  const sourceStyle = (node: Element): string =>
    node.attrs.find((item) => item.name === `data-knc-${mode}`)?.value ??
    node.attrs.find((item) => item.name === 'data-knc-light')?.value ??
    attr(node, 'style')
  const rootStyle = themeDeclarations(sourceStyle(surface), mode)
  const brand = find(header, (node) => node.tagName === 'h1')
  if (brand) {
    brand.tagName = 'a'
    brand.nodeName = 'a'
    brand.attrs.push({ name: 'href', value: `/?lang=${lang}&mode=${mode}` })
  }
  const chrome = (node: Element): string => {
    const clean = (current: Element): void => {
      const children = elements(current)
      const legacyLanguagePill =
        current.tagName === 'div' &&
        children.length === 2 &&
        new Set(
          children.map((child) =>
            serialize(child)
              .replace(/<[^>]*>/g, '')
              .trim(),
          ),
        ).size === 2 &&
        children.every((child) => {
          const text = serialize(child)
            .replace(/<[^>]*>/g, '')
            .trim()
          return (
            child.tagName === 'button' &&
            ['SV', 'EN'].includes(text) &&
            attr(child, 'aria-pressed') !== ''
          )
        })
      if (legacyLanguagePill) {
        current.tagName = 'a'
        current.nodeName = 'a'
        current.attrs = current.attrs.filter(
          (item) => !['type', 'aria-pressed'].includes(item.name),
        )
        current.attrs.push({
          name: 'href',
          value: `${page.path}?lang=${lang === 'sv' ? 'en' : 'sv'}&mode=${mode}`,
        })
        if (!attr(current, 'aria-label'))
          current.attrs.push({
            name: 'aria-label',
            value: lang === 'sv' ? 'Byt språk till engelska' : 'Switch language to Swedish',
          })
        for (const child of children) {
          child.tagName = 'span'
          child.nodeName = 'span'
          child.attrs = child.attrs.filter((item) => !['type', 'aria-pressed'].includes(item.name))
        }
      }
      const style = themeDeclarations(sourceStyle(current), mode)
      const baseline = attr(current, 'data-knc-baseline')
      const dark = attr(current, 'data-knc-dark-attrs')
      if (mode === 'dark' && baseline && dark) {
        const lightAttrs = JSON.parse(baseline) as Record<string, string>
        const darkAttrs = JSON.parse(dark) as Record<string, string>
        for (const name of ['class', 'title', 'href', 'src', 'alt', 'aria-label'])
          if (attr(current, name) === (lightAttrs[name] ?? '')) {
            current.attrs = current.attrs.filter((item) => item.name !== name)
            if (darkAttrs[name] !== undefined) current.attrs.push({ name, value: darkAttrs[name] })
          }
      }
      current.attrs = current.attrs.filter(
        (item) =>
          !item.name.startsWith('data-knc-') &&
          !item.name.startsWith('data-gjs-') &&
          !['style', 'inert', 'draggable'].includes(item.name),
      )
      if (style) current.attrs.push({ name: 'style', value: style })
      if (legacyLanguagePill) addClass(current, languageAction)
      for (const child of elements(current)) clean(child)
      if (current.tagName === 'button') {
        const text = serialize(current)
          .replace(/<[^>]*>/g, '')
          .trim()
        const label = attr(current, 'aria-label')
        const hasPressedState = attr(current, 'aria-pressed') !== ''
        const combinedLanguagePill =
          children.length === 2 &&
          children.every((child) => child.tagName === 'span') &&
          new Set(
            children.map((child) =>
              serialize(child)
                .replace(/<[^>]*>/g, '')
                .trim(),
            ),
          ).size === 2 &&
          children.every((child) =>
            ['SV', 'EN'].includes(
              serialize(child)
                .replace(/<[^>]*>/g, '')
                .trim(),
            ),
          )
        const languageToggle =
          combinedLanguagePill ||
          /language|språk/i.test(label) ||
          (['SV', 'EN'].includes(text) && hasPressedState)
        const themeToggle = /ljust|dark|theme/i.test(label)
        current.tagName = 'a'
        current.nodeName = 'a'
        current.attrs = current.attrs.filter(
          (item) => !['type', 'aria-pressed'].includes(item.name),
        )
        const targetLang = languageToggle
          ? lang === 'sv'
            ? 'en'
            : 'sv'
          : text === 'SV'
            ? 'sv'
            : text === 'EN'
              ? 'en'
              : lang
        const targetMode = themeToggle ? (mode === 'light' ? 'dark' : 'light') : mode
        current.attrs.push({
          name: 'href',
          value: `${/integritet|privacy/i.test(`${label} ${text}`) ? '/privacy' : page.path}?lang=${targetLang}&mode=${targetMode}`,
        })
        if (languageToggle) addClass(current, languageAction)
        else if (themeToggle) addClass(current, themeAction)
      }
    }
    clean(node)
    return serializeOuter(node)
  }
  // Seed a single authored header with semantic layout hooks, not a second mobile tree.
  addClass(header, 'cms-site-chrome')
  if (brand) addClass(brand, 'cms-site-brand')
  for (const child of elements(header)) if (child !== brand && child.tagName === 'div') addClass(child, 'cms-site-controls')
  const phone = find(header, (node) => attr(node, 'href').startsWith('tel:'))
  const directions = find(header, (node) => /^https?:/.test(attr(node, 'href')))
  if (phone) addClass(phone, 'cms-site-phone')
  if (directions) addClass(directions, 'cms-site-directions')
  const headerHtml = chrome(header)
  const infoHtml = chrome(info)
  const footerHtml = footer ? chrome(footer) : ''
  const menu = `<a href="${href('/', lang, mode)}">${lang === 'sv' ? 'Hem' : 'Home'}</a><a href="${href('/booking', lang, mode)}">${lang === 'sv' ? 'Boka tid' : 'Book'}</a><a href="${href('/about', lang, mode)}">${lang === 'sv' ? 'Om oss' : 'About'}</a>${sitePageLinks(presentation.pages, lang, mode)}`
  return {
    html: `<div id="cms-site-shell" style="${escape(rootStyle)}"><header id="cms-site-header">${headerHtml}</header><nav id="cms-site-menu" aria-label="${lang === 'sv' ? 'Sidmeny' : 'Pages'}">${menu}</nav><div id="cms-site-content">${variant.html}</div><footer id="cms-site-footer">${infoHtml}${footerHtml}</footer></div>`,
    css: `${siteThemeCss(presentation, mode)}\n${repairDesktopCss(home.css[mode])}\n${repairDesktopCss(about?.css[mode] ?? '')}\n${repairDesktopCss(variant.css[mode])}\n#cms-site-shell{min-height:100dvh;display:flex;flex-direction:column;padding:0}#cms-site-header>div{position:relative!important;height:auto!important;min-height:61px;flex-wrap:wrap;gap:14px}:where(#cms-site-header) a{color:inherit;text-decoration:none}#cms-site-menu{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 24px;padding:18px 24px;border-bottom:1px solid currentColor;font-size:13px}#cms-site-menu a{color:inherit;text-underline-offset:4px}#cms-site-content{flex:1;min-width:0}#cms-site-footer{border-top:1px solid currentColor}#cms-site-footer>div{position:static!important;padding:24px!important;flex-wrap:wrap;gap:12px}#cms-site-footer>footer{padding-bottom:24px!important}@media(max-width:768px){#cms-site-header>div{padding:16px!important;justify-content:center!important}#cms-site-content main{padding:40px 24px!important}#cms-site-header .cms-site-chrome{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px 12px}#cms-site-header .cms-site-controls{display:contents}#cms-site-header .cms-site-brand{grid-column:1/3;grid-row:1;justify-self:start;min-width:0;margin:0}#cms-site-header .cms-site-brand svg{display:block;width:210px;max-width:100%;height:auto;max-height:36px}#cms-site-header .cms-site-directions{grid-column:3;grid-row:1;font-size:11px;white-space:nowrap;padding:6px 8px;gap:4px}#cms-site-header .cms-site-phone{grid-column:1;grid-row:2;min-width:0;font-size:12px;white-space:nowrap;gap:4px}#cms-site-header .cms-site-action-language{grid-column:2;grid-row:2}#cms-site-header .cms-site-action-theme{grid-column:3;grid-row:2}#cms-site-header .cms-site-phone img,#cms-site-header .cms-site-directions img{width:14px;height:14px;flex:none}}`,
  }
}

/** Derived chrome needs strong overrides while it still contains inline runtime
 * styles. Once materialized, these are editable defaults below owner ID rules. */
function editableChromeCss(css: string): string {
  const tree = parse(css)
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      const selector = generate(rule.prelude)
      if (!selector.startsWith('#cms-site-')) return
      const prelude = parse(selector.replace(/#(cms-site-[\w-]+)/g, '[id="$1"]'), {
        context: 'selectorList',
      })
      if (prelude.type !== 'SelectorList') throw new Error('Expected CSS selector list.')
      rule.prelude = prelude
      rule.block.children.forEach((declaration) => {
        if (declaration.type === 'Declaration') declaration.important = false
      })
    },
  })
  return generate(tree)
}

/** Materialize an independent page once. Its chrome becomes authored content, not
 * a locked preview of another page. Normalize inline styles before GrapesJS can
 * attach them to the currently selected device's media query. */
export function createSitePage(presentation: CmsPresentation, page: CmsPage): CmsPage {
  const next = structuredClone(page)
  if (page.layout === 'independent') return next
  for (const lang of ['sv', 'en'] as const) {
    const render = (mode: CmsMode) => {
      const rendered = renderSitePage(presentation, page, lang, mode)
      rendered.css = editableChromeCss(rendered.css)
      return normalizeSitePageContent(
        { html: rendered.html, css: { light: rendered.css, dark: rendered.css } },
        `${page.id}-${lang}`,
      )
    }
    const light = render('light')
    const dark = render('dark')
    next.content[lang] = {
      html: light.html,
      css: { light: light.css.light, dark: dark.css.dark },
    }
  }
  next.layout = 'independent'
  return next
}
