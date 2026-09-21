import { generate, parse, walk } from 'css-tree'
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
