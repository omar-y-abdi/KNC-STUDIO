import { generate, parse, walk, type CssNode } from 'css-tree'
import type { CmsLang, CmsMode, CmsPage, CmsPresentation } from '../../../shared/cms'
import { nativeCanvas } from './nativeCanvas'

/** Home embeds About at runtime. Its editor must derive that preview from the same draft page. */
export function composedCanvas(
  page: CmsPage,
  presentation: CmsPresentation,
  lang: CmsLang,
  mode: CmsMode,
): { html: string; css: string } {
  const content = nativeCanvas(page.content[lang], mode)
  if (page.path !== '/') return content
  const about = presentation.pages.find((item) => item.path === '/about')
  if (!about) return content
  const shared = nativeCanvas(about.content[lang], mode)
  const doc = new DOMParser().parseFromString(content.html, 'text/html')
  const source = new DOMParser()
    .parseFromString(shared.html, 'text/html')
    .querySelector('[data-knc-surface="about"]')
  if (!source) return content
  const css = parse(content.css)
  walk(css, {
    visit: 'Rule',
    enter(rule, item, list) {
      if (generate(rule.prelude).includes('preview-shared-') && item && list) list.remove(item)
    },
  })
  const rules = [generate(css)]
  let count = 0
  for (const slot of doc.querySelectorAll('[data-knc-slot]')) {
    // About is the named section at a runtime slot boundary, on both Home surfaces.
    if (!slot.querySelector(':scope > section[aria-labelledby]')) continue
    const copy = source.cloneNode(true) as Element
    const ids = new Map<string, string>()
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      if (node.id) {
        const id = `preview-shared-${count++}`
        ids.set(node.id, id)
        node.id = id
      }
      for (const attr of [
        'data-knc-source',
        'data-knc-slot',
        'data-knc-required',
        'data-knc-surface',
      ])
        node.removeAttribute(attr)
    }
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      for (const name of ['aria-labelledby', 'aria-describedby', 'for']) {
        const value = node.getAttribute(name)
        if (value)
          node.setAttribute(
            name,
            value
              .split(' ')
              .map((id) => ids.get(id) ?? id)
              .join(' '),
          )
      }
    }
    slot.replaceChildren(copy)
    const sheet = parse(shared.css)
    walk(sheet, {
      visit: 'IdSelector',
      enter(selector) {
        selector.name = ids.get(selector.name) ?? selector.name
      },
    })
    rules.push(generate(sheet))
  }
  return { html: doc.body.innerHTML, css: rules.join('\n') }
}

/** Derived About previews never belong to the Home document. Persist only their slot marker;
 * the next render fills it from About again. Prune stale preview selectors and duplicate CSS. */
export function stripComposedCanvas(html: string, css: string): { html: string; css: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc.querySelector('[data-knc-surface="desktop-home"],[data-knc-surface="mobile-home"]'))
    return { html, css }
  const discarded = new Set<string>()
  for (const slot of doc.querySelectorAll('[data-knc-slot]')) {
    const section = slot.querySelector(':scope > section[aria-labelledby]')
    if (!section) continue
    for (const node of [section, ...section.querySelectorAll('[id]')])
      if (node.id) discarded.add(node.id)
    section.replaceChildren()
    // An inert marker keeps older source documents and future core-page preparation compatible.
    for (const attr of [...section.attributes])
      if (attr.name !== 'aria-labelledby') section.removeAttribute(attr.name)
    section.setAttribute('data-knc-baseline', '{}')
  }
  const sheet = parse(css)
  walk(sheet, {
    visit: 'Rule',
    enter(rule, item, list) {
      let derived = false
      walk(rule.prelude, {
        visit: 'IdSelector',
        enter(id) {
          if (discarded.has(id.name) || id.name.startsWith('preview-shared-')) derived = true
        },
      })
      if (derived && item && list) list.remove(item)
    },
  })
  // GrapesJS merges repeated media/keyframe blocks, so deduplicate their children too.
  walk(sheet, {
    leave(node: CssNode) {
      if (node.type !== 'StyleSheet' && node.type !== 'Block') return
      const seen = new Map<string, { item: Parameters<typeof node.children.remove>[0] }>()
      node.children.forEach((child, item) => {
        if (child.type !== 'Rule' && child.type !== 'Atrule') return
        const key = generate(child)
        const earlier = seen.get(key)
        if (earlier) node.children.remove(earlier.item)
        seen.set(key, { item })
      })
    },
  })
  return { html: doc.body.innerHTML, css: generate(sheet) }
}
