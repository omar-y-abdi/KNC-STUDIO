import { configureComponent } from './editorPolicy'
import type { Component, Editor } from 'grapesjs'
import { clone, generate, ident, parse, walk, type CssNode, type StyleSheet } from 'css-tree'
import type { CmsLang, CmsMode, CmsPage, CmsPresentation } from '../../../shared/cms'
import type { CmsScene } from '../../cms/Scene'
import { nativeCanvasTree, parseCanvasCss, type CanvasTree } from './nativeCanvas'
import { bindCmsRootStyles } from './cmsRootStyles'

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

export interface ComposedCanvasTree extends CanvasTree {
  /** No cloned DOM, rewritten IDs or preview CSS exists until this is called. */
  aboutPreview?: () => CanvasTree
}

/** Separate native conversions so startup can give input a turn between the full-page passes. */
export function* composedCanvasPasses(
  page: CmsPage,
  presentation: CmsPresentation,
  lang: CmsLang,
  mode: CmsMode,
  scene: CmsScene = 'default',
  device: CanvasDevice = 'Desktop',
  deferAbout = true,
): Generator<void, ComposedCanvasTree> {
  const content = nativeCanvasTree(page.content[lang], mode)
  yield
  if (page.path === '/booking' && isBookingStage(scene)) {
    const booking = composeBookingScene({ html: content.html, css: '' }, scene, device)
    return { ...content, html: booking.html }
  }
  if (page.path !== '/') return content
  const about = presentation.pages.find((item) => item.path === '/about')
  if (!about) return content
  const shared = nativeCanvasTree(about.content[lang], mode)
  yield
  const doc = new DOMParser().parseFromString(content.html, 'text/html')
  const source = new DOMParser()
    .parseFromString(shared.html, 'text/html')
    .querySelector('[data-knc-surface="about"]')
  if (!source) return content
  const css = content.sheet
  walk(css, {
    visit: 'Rule',
    enter(rule, item, list) {
      if (generate(rule.prelude).includes('preview-shared-') && item && list) list.remove(item)
    },
  })
  let inactive = false
  for (const slot of doc.querySelectorAll('[data-knc-slot]')) {
    // About is the named section at a runtime slot boundary, on both Home surfaces.
    if (!slot.querySelector(':scope > section[aria-labelledby]')) continue
    if (slot.closest(`[data-knc-surface="${device.toLowerCase()}-home"]`)) {
      // An editor-only boundary allows descendants to retain their canonical identities.
      // Export restores the runtime slot and writes this subtree back to the About owner.
      slot.setAttribute('data-editor-about-slot', slot.getAttribute('data-knc-slot') ?? '')
      slot.removeAttribute('data-knc-slot')
      slot.replaceChildren(source.cloneNode(true))
      continue
    }
    inactive = true
  }
  // The canonical About tree supplies all shared class/at-rules immediately. Only derived
  // ID selectors are added later; global rules keep the same order as the eager composition.
  css.children.appendList((clone(shared.sheet) as StyleSheet).children)
  if (inactive && deferAbout) {
    const ids = new Set([source, ...source.querySelectorAll('[id]')].map((node) => node.id))
    const globals = clone(shared.sheet) as StyleSheet
    filterSelectors(globals, (id) => ids.has(ident.decode(id.name)), false)
    css.children.appendList(globals.children)
  } else if (inactive) {
    const preview = aboutPreview(source, shared)
    const copy = new DOMParser().parseFromString(preview.html, 'text/html')
    for (const slot of doc.querySelectorAll('[data-knc-slot]')) {
      if (slot.querySelector(':scope > section[aria-labelledby]'))
        slot.replaceChildren(...[...copy.body.childNodes].map((node) => node.cloneNode(true)))
    }
    css.children.appendList(preview.sheet.children)
  }
  deduplicateUnlayeredRules(css)
  return {
    html: doc.body.innerHTML,
    sheet: css,
    ...(inactive && deferAbout ? { aboutPreview: () => aboutPreview(source, shared) } : {}),
  }
}

function aboutPreview(source: Element, shared: CanvasTree): CanvasTree {
  const copy = source.cloneNode(true) as Element
  const ids = new Map<string, string>()
  let count = 0
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
  const sheet = clone(shared.sheet) as StyleSheet
  walk(sheet, {
    visit: 'IdSelector',
    enter(selector) {
      const next = ids.get(ident.decode(selector.name))
      if (next) selector.name = ident.encode(next)
    },
  })
  return { html: copy.outerHTML, sheet }
}

function deduplicateUnlayeredRules(combined: CssNode): void {
  // Home and both About copies share source rules. Import each identical rule once.
  // Layer declarations establish order on first occurrence, so retain them verbatim.
  let layered = false
  walk(combined, {
    visit: 'Atrule',
    enter(node) {
      if (ident.decode(node.name).toLowerCase() === 'layer') layered = true
    },
  })
  if (!layered) deduplicateRules(combined)
}

/** Static comparison consumers still receive both responsive surfaces. */
export function composedCanvas(
  page: CmsPage,
  presentation: CmsPresentation,
  lang: CmsLang,
  mode: CmsMode,
  scene: CmsScene = 'default',
  device: CanvasDevice = 'Desktop',
): { html: string; css: string } {
  const passes = composedCanvasPasses(page, presentation, lang, mode, scene, device, false)
  let step = passes.next()
  while (!step.done) step = passes.next()
  const content = step.value
  return { html: content.html, css: generate(content.sheet) }
}

/** Install the deferred tree once, before either idle completion or the first ownership move. */
export function installHomeAboutPreview(editor: Editor, create: () => CanvasTree): void {
  const wrapper = editor.getWrapper()
  const slot = wrapper
    ?.find('[data-knc-slot]')
    .find((candidate) =>
      candidate
        .components()
        .some(
          (child: Component) =>
            child.get('tagName') === 'section' && child.getAttributes()['aria-labelledby'],
        ),
    )
  if (!slot) return
  const preview = create()
  // Shared class rules already exist. Add only selectors for the new derived identities.
  filterSelectors(preview.sheet, (id) => ident.decode(id.name).startsWith('preview-shared-'), true)
  // Non-rule definitions (fonts, keyframes and layer declarations) were imported with the
  // shared globals. Retain only the containers of the new ID rules.
  walk(preview.sheet, {
    visit: 'Atrule',
    leave(node, item, list) {
      let hasRule = false
      if (node.block)
        walk(node.block, {
          visit: 'Rule',
          enter() {
            hasRule = true
          },
        })
      if (!hasRule && item && list) list.remove(item)
    },
  })
  const rules = parseCanvasCss(bindCmsRootStyles(preview.sheet, wrapper?.getId() ?? ''), editor)
  editor.UndoManager.skip(() => {
    editor.Css.addCollection(rules)
    slot.components(preview.html)
    const configure = (component: Component): void => {
      configureComponent(component, { silent: true })
      component.components().forEach(configure)
    }
    slot.components().forEach(configure)
  })
}

function filterSelectors(
  sheet: CssNode,
  matches: (id: { name: string }) => boolean,
  retain: boolean,
): void {
  walk(sheet, {
    visit: 'Rule',
    enter(rule, item, list) {
      if (rule.prelude.type !== 'SelectorList') return
      rule.prelude.children.forEach((selector, selectorItem) => {
        let found = false
        walk(selector, {
          visit: 'IdSelector',
          enter(id) {
            if (matches(id)) found = true
          },
        })
        if (found !== retain && rule.prelude.type === 'SelectorList')
          rule.prelude.children.remove(selectorItem)
      })
      if (!rule.prelude.children.size && item && list) list.remove(item)
    },
  })
}

/** Only ownership moves on a Home device switch; both responsive trees already exist. */
export function moveHomeAbout(editor: Editor, device: CanvasDevice): boolean {
  const wrapper = editor.getWrapper()
  const from = wrapper?.find('[data-editor-about-slot]')[0]
  const surface = wrapper?.find(`[data-knc-surface="${device.toLowerCase()}-home"]`)[0]
  const to = surface
    ?.find('[data-knc-slot]')
    .find((slot) =>
      slot
        .components()
        .some(
          (child: Component) =>
            child.get('tagName') === 'section' && child.getAttributes()['aria-labelledby'],
        ),
    )
  const owner = from?.components().at(0)
  const preview = to?.components().at(0)
  if (
    !from ||
    !to ||
    !owner ||
    !preview ||
    from.components().length !== 1 ||
    to.components().length !== 1
  )
    return false
  if (owner.getAttributes()['data-knc-surface'] !== 'about') return false
  editor.UndoManager.skip(() => {
    const identity = from.getAttributes()['data-editor-about-slot']
    from.removeAttributes('data-editor-about-slot')
    from.addAttributes({ 'data-knc-slot': identity })
    to.addAttributes({ 'data-editor-about-slot': to.getAttributes()['data-knc-slot'] })
    to.removeAttributes('data-knc-slot')
    preview.move(from)
    owner.move(to)
  })
  return true
}

/** Scene changes relocate the stored stages, not the rest of the booking page. */
export function moveBookingScene(editor: Editor, scene: CmsScene, device: CanvasDevice): boolean {
  if (scene !== 'default' && !isBookingStage(scene)) return false
  const wrapper = editor.getWrapper()
  const native = wrapper?.find('[data-knc-native="1"]')[0]
  const shell = native?.find(`[data-knc-surface="${device.toLowerCase()}-booking"]`)[0]
  const flow = shell?.find('[data-knc-fold="booking-flow"]')[0]
  const content = flow?.components().at(0)
  const stages = bookingStages.map((stage) => native?.find(`[data-knc-surface="${stage}"]`)[0])
  if (!native || !flow || !content || stages.some((stage) => !stage)) return false
  editor.UndoManager.skip(() => {
    for (const [index, stage] of stages.entries()) {
      if (!stage || stage.parent() === native) continue
      const next = stages.slice(index + 1).find((candidate) => candidate?.parent() === native)
      stage.move(native, next ? { at: native.components().indexOf(next) } : {})
    }
    if (scene !== 'default') {
      stages[0]?.move(content)
      if (scene !== 'booking-options') stages[bookingStages.indexOf(scene)]?.move(flow)
    }
    const configure = (component: Component): void => {
      configureComponent(component, { silent: true })
      component.components().forEach(configure)
    }
    for (const stage of stages) if (stage) configure(stage)
    configureComponent(content, { silent: true })
    configureComponent(flow, { silent: true })
  })
  return true
}

function deduplicateRules(sheet: CssNode): void {
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
      if (rule.prelude.type !== 'SelectorList') return
      rule.prelude.children.forEach((selector, selectorItem) => {
        let derived = false
        walk(selector, {
          visit: 'IdSelector',
          enter(id) {
            if (discarded.has(ident.decode(id.name)) || id.name.startsWith('preview-shared-'))
              derived = true
          },
        })
        if (derived && rule.prelude.type === 'SelectorList')
          rule.prelude.children.remove(selectorItem)
      })
      if (!rule.prelude.children.size && item && list) list.remove(item)
    },
  })
  deduplicateRules(sheet)
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
  deduplicateRules(tree)
  previous.replaceWith(about.cloneNode(true))
  return { html: saved.body.innerHTML, css: generate(tree) }
}
