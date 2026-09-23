import { themeDeclarations, siteThemeCss } from './site-theme.ts'
import { repairDesktopCss } from './cms-device-css.ts'
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
    return { html: variant.html, css: repairDesktopCss(variant.css[mode]) }
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
      for (const child of elements(current)) clean(child)
      if (current.tagName === 'button') {
        const text = serialize(current)
          .replace(/<[^>]*>/g, '')
          .trim()
        const label = attr(current, 'aria-label')
        current.tagName = 'a'
        current.nodeName = 'a'
        current.attrs = current.attrs.filter(
          (item) => !['type', 'aria-pressed'].includes(item.name),
        )
        const targetLang = text === 'SV' ? 'sv' : text === 'EN' ? 'en' : lang
        const targetMode = /ljust|dark|theme/i.test(label)
          ? mode === 'light'
            ? 'dark'
            : 'light'
          : mode
        current.attrs.push({
          name: 'href',
          value: `${/integritet|privacy/i.test(`${label} ${text}`) ? '/privacy' : page.path}?lang=${targetLang}&mode=${targetMode}`,
        })
      }
    }
    clean(node)
    return serializeOuter(node)
  }
  const headerHtml = chrome(header)
  const infoHtml = chrome(info)
  const footerHtml = footer ? chrome(footer) : ''
  const menu = `<a href="${href('/', lang, mode)}">${lang === 'sv' ? 'Hem' : 'Home'}</a><a href="${href('/booking', lang, mode)}">${lang === 'sv' ? 'Boka tid' : 'Book'}</a><a href="${href('/about', lang, mode)}">${lang === 'sv' ? 'Om oss' : 'About'}</a>${sitePageLinks(presentation.pages, lang, mode)}`
  return {
    html: `<div id="cms-site-shell" style="${escape(rootStyle)}"><header id="cms-site-header">${headerHtml}</header><nav id="cms-site-menu" aria-label="${lang === 'sv' ? 'Sidmeny' : 'Pages'}">${menu}</nav><div id="cms-site-content">${variant.html}</div><footer id="cms-site-footer">${infoHtml}${footerHtml}</footer></div>`,
    css: `${siteThemeCss(presentation, mode)}\n${repairDesktopCss(home.css[mode])}\n${repairDesktopCss(about?.css[mode] ?? '')}\n${repairDesktopCss(variant.css[mode])}\n#cms-site-shell{min-height:100dvh;display:flex;flex-direction:column;padding:0}#cms-site-header>div{position:relative!important;height:auto!important;min-height:61px;flex-wrap:wrap;gap:14px}#cms-site-header a{color:inherit;text-decoration:none}#cms-site-header a:has(>svg){color:inherit}#cms-site-menu{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 24px;padding:18px 24px;border-bottom:1px solid currentColor;font-size:13px}#cms-site-menu a{color:inherit;text-underline-offset:4px}#cms-site-content{flex:1;min-width:0}#cms-site-footer{border-top:1px solid currentColor}#cms-site-footer>div{position:static!important;padding:24px!important;flex-wrap:wrap;gap:12px}#cms-site-footer>footer{padding-bottom:24px!important}@media(max-width:768px){#cms-site-header>div{padding:16px!important;justify-content:center!important}#cms-site-content main{padding:40px 24px!important}}`,
  }
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
