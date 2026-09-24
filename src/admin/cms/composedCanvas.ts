import { generate, ident, parse, walk, type CssNode } from 'css-tree'
import type { CmsLang, CmsMode, CmsPage, CmsPresentation } from '../../../shared/cms'
import type { CmsScene } from '../../cms/Scene'
import { nativeCanvas } from './nativeCanvas'

type CanvasDevice = 'Desktop' | 'Mobile'
const bookingStages = ['booking-options', 'booking-details', 'booking-confirmation'] as const

function isBookingStage(scene: CmsScene): scene is (typeof bookingStages)[number] {
  return bookingStages.some((stage) => stage === scene)
}

function bookingSceneRoot(doc: Document, scene: (typeof bookingStages)[number]): Element {
  const root = doc.querySelector(`[data-knc-native="1"] > [data-knc-surface="${scene}"]`)
  if (!root) throw new Error(`Bokningssteget ${scene} saknas i sidans mall.`)
  return root
}

/** Show the stored stage in its actual page shell without copying its native identity. */
function composeBookingScene(
  content: { html: string; css: string },
  scene: (typeof bookingStages)[number],
  device: CanvasDevice,
): { html: string; css: string } {
  const doc = new DOMParser().parseFromString(content.html, 'text/html')
  const shell = doc.querySelector(`[data-knc-surface="${device.toLowerCase()}-booking"]`)
  const flow = shell?.querySelector('[data-knc-fold="booking-flow"]')
  const flowContent = flow?.firstElementChild
  if (!flow || !flowContent) throw new Error('Bokningsvyns fullständiga sidmall kunde inte läsas.')
  flowContent.appendChild(bookingSceneRoot(doc, 'booking-options'))
  if (scene !== 'booking-options') flow.appendChild(bookingSceneRoot(doc, scene))
  return { ...content, html: doc.body.innerHTML }
}

/** Return editor-only stage placements to their single stored roots before saving. */
function stripBookingScene(doc: Document, scene: (typeof bookingStages)[number]): string {
  const native = doc.querySelector('[data-knc-native="1"]')
  if (!native) throw new Error('Bokningssidans källstruktur saknas.')
  const visibleStages: readonly (typeof bookingStages)[number][] =
    scene === 'booking-options' ? ['booking-options'] : ['booking-options', scene]
  for (const stage of visibleStages) {
    const root = doc.querySelector(`[data-knc-surface="${stage}"]`)
    if (!root) throw new Error(`Bokningssteget ${stage} saknas i editorn.`)
    const next = bookingStages
      .slice(bookingStages.indexOf(stage) + 1)
      .map((candidate) => native.querySelector(`:scope > [data-knc-surface="${candidate}"]`))
      .find((candidate) => candidate !== null)
    native.insertBefore(root, next ?? null)
  }
  return doc.body.innerHTML
}

/** Home edits one canonical About tree. The inactive device gets a derived preview only. */
export function composedCanvas(
  page: CmsPage,
  presentation: CmsPresentation,
  lang: CmsLang,
  mode: CmsMode,
  scene: CmsScene = 'default',
  device: CanvasDevice = 'Desktop',
): { html: string; css: string } {
  const content = nativeCanvas(page.content[lang], mode)
  if (page.path === '/booking' && isBookingStage(scene))
    return composeBookingScene(content, scene, device)
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
    if (slot.closest(`[data-knc-surface="${device.toLowerCase()}-home"]`)) {
      // An editor-only boundary allows descendants to retain their canonical identities.
      // Export restores the runtime slot and writes this subtree back to the About owner.
      slot.setAttribute('data-editor-about-slot', slot.getAttribute('data-knc-slot') ?? '')
      slot.removeAttribute('data-knc-slot')
      slot.replaceChildren(copy)
      rules.push(shared.css)
      continue
    }
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
        const next = ids.get(ident.decode(selector.name))
        if (next) selector.name = ident.encode(next)
      },
    })
    rules.push(generate(sheet))
  }
  return { html: doc.body.innerHTML, css: rules.join('\n') }
}

/** Derived About previews never belong to the Home document. Persist only their slot marker;
 * the next render fills it from About again. Prune stale preview selectors and duplicate CSS. */
export function stripComposedCanvas(
  html: string,
  css: string,
  scene: CmsScene = 'default',
): { html: string; css: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (isBookingStage(scene)) return { html: stripBookingScene(doc, scene), css }
  if (!doc.querySelector('[data-knc-surface="desktop-home"],[data-knc-surface="mobile-home"]'))
    return { html, css }
  const discarded = new Set<string>()
  for (const slot of doc.querySelectorAll('[data-editor-about-slot]')) {
    slot.setAttribute('data-knc-slot', slot.getAttribute('data-editor-about-slot') ?? '')
    slot.removeAttribute('data-editor-about-slot')
  }
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

/** Extract the canonical About owner before Home removes its derived slot contents.
 * Non-ID source rules are shared site CSS. Other pages' ID rules must not leak into About.
 */
export function extractComposedAbout(
  html: string,
  css: string,
  original: string,
): { html: string; css: string } | null {
  const canvas = new DOMParser().parseFromString(html, 'text/html')
  const boundary = canvas.querySelector('[data-editor-about-slot]')
  if (!boundary) return null
  const about = boundary.querySelector(':scope > [data-knc-surface="about"]')
  if (!about) throw new Error('Om oss-sektionen saknas. Ändringarna har inte skrivits över.')
  const saved = new DOMParser().parseFromString(original, 'text/html')
  const previous = saved.querySelector('[data-knc-surface="about"]')
  if (!previous) throw new Error('Om oss-sektionens original kunde inte läsas.')
  const aboutIds = new Set([about, ...about.querySelectorAll('[id]')].map((node) => node.id))
  const otherIds = new Set(
    [...canvas.querySelectorAll('[id]')].map((node) => node.id).filter((id) => !aboutIds.has(id)),
  )
  const tree = parse(css)
  walk(tree, {
    visit: 'Rule',
    enter(rule, item, list) {
      if (rule.prelude.type !== 'SelectorList') return
      rule.prelude.children.forEach((selector, selectorItem) => {
        let foreign = false
        walk(selector, {
          visit: 'IdSelector',
          enter(id) {
            if (otherIds.has(ident.decode(id.name)) || id.name.startsWith('preview-shared-'))
              foreign = true
          },
        })
        if (foreign && rule.prelude.type === 'SelectorList')
          rule.prelude.children.remove(selectorItem)
      })
      if (!rule.prelude.children.size && item && list) list.remove(item)
    },
  })
  previous.replaceWith(about.cloneNode(true))
  return { html: saved.body.innerHTML, css: generate(tree) }
}
