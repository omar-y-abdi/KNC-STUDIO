import { configureComponent } from './editorPolicy'
import type { Component, Editor } from 'grapesjs'
import {
  clone,
  generate,
  ident,
  List,
  parse,
  walk,
  type AttributeSelector,
  type CssNode,
  type ListItem,
  type Rule,
  type Selector,
  type SelectorList,
  type StyleSheet,
} from 'css-tree'
import type { CmsLang, CmsMode, CmsPage, CmsPresentation } from '@bladeblend/content-contracts/cms'
import type { CmsScene } from '@bladeblend/public-web/preview'
import { nativeCanvasTree, parseCanvasSheet, type CanvasTree } from './nativeCanvas'
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
  html: string,
  scene: (typeof bookingStages)[number],
  device: CanvasDevice,
): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const shell = doc.querySelector(`[data-knc-surface="${device.toLowerCase()}-booking"]`)
  const flow = shell?.querySelector('[data-knc-fold="booking-flow"]')
  const flowContent = flow?.firstElementChild
  if (!flow || !flowContent) throw new Error('Bokningsvyns fullständiga sidmall kunde inte läsas.')
  flowContent.appendChild(bookingSceneRoot(doc, 'booking-options'))
  if (scene !== 'booking-options') flow.appendChild(bookingSceneRoot(doc, scene))
  return doc.body.innerHTML
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
  /** The inactive tree is cloned only when needed; its ID map is prepared with the source. */
  aboutPreview?: () => string
  /** Project rendered styles only. Editable rules and exported CSS remain canonical. */
  projectStyles?: (css: string) => string
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
  if (page.path === '/booking' && isBookingStage(scene))
    return { ...content, html: composeBookingScene(content.html, scene, device) }
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
      if (namesId(rule.prelude, isPreviewId) && item && list) list.remove(item)
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
  // Import source rules once. Preview projections belong to rendered style nodes, never
  // to the editable composer or the CSS exported back to either page.
  // An earlier copy is inert.
  const imported = new Set(shared.sheet.children.toArray().map((rule) => generate(rule)))
  css.children.forEach((rule, item, list) => {
    if (imported.has(generate(rule))) list.remove(item)
  })
  css.children.appendList(shared.sheet.children)
  const ids = inactive ? previewIds(source, doc) : new Map<string, string>()
  if (inactive && !deferAbout) {
    const copy = new DOMParser().parseFromString(aboutPreview(source, ids), 'text/html')
    for (const slot of doc.querySelectorAll('[data-knc-slot]')) {
      if (slot.querySelector(':scope > section[aria-labelledby]'))
        slot.replaceChildren(...[...copy.body.childNodes].map((node) => node.cloneNode(true)))
    }
  }
  // Home and both About copies share source rules. Import each identical rule once.
  deduplicateRules(css)
  return {
    html: doc.body.innerHTML,
    sheet: css,
    ...(inactive
      ? {
          projectStyles: (css: string) => projectPreviewStyles(css, ids),
          ...(deferAbout ? { aboutPreview: () => aboutPreview(source, ids) } : {}),
        }
      : {}),
  }
}

const previewAttribute = 'data-editor-about-preview'
const previewAttributes = new Map([
  ['data-knc-source', 'data-editor-preview-source'],
  ['data-knc-slot', 'data-editor-preview-slot'],
  ['data-knc-required', 'data-editor-preview-required'],
  ['data-knc-surface', 'data-editor-preview-surface'],
  ['id', 'data-editor-preview-id'],
  ['href', 'data-editor-preview-href'],
  ['xlink:href', 'data-editor-preview-xlink-href'],
  ['aria-labelledby', 'data-editor-preview-labelledby'],
  ['aria-describedby', 'data-editor-preview-describedby'],
  ['aria-controls', 'data-editor-preview-controls'],
  ['for', 'data-editor-preview-for'],
  ['style', 'data-editor-preview-style'],
  ['fill', 'data-editor-preview-fill'],
  ['stroke', 'data-editor-preview-stroke'],
  ['filter', 'data-editor-preview-filter'],
  ['clip-path', 'data-editor-preview-clip-path'],
  ['mask', 'data-editor-preview-mask'],
])
const removedPreviewAttributes = new Set([
  'data-knc-source',
  'data-knc-slot',
  'data-knc-required',
  'data-knc-surface',
])
const idReferences = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'for'])
const urlAttributes = new Set(['style', 'fill', 'stroke', 'filter', 'clip-path', 'mask'])
const previewDomain = `[${previewAttribute}="1"],[${previewAttribute}="1"] *`

function domainGuard(preview: boolean): CssNode {
  const selector = parse(`:where(${preview ? previewDomain : `:not(${previewDomain})`})`, {
    context: 'selector',
  })
  if (selector.type !== 'Selector' || !selector.children.first)
    throw new Error('Förhandsvisningens CSS-gräns kunde inte läsas.')
  return selector.children.first
}

const ownerGuard = domainGuard(false)
const previewGuard = domainGuard(true)

function previewIds(source: Element, canvas: Document): Map<string, string> {
  const taken = new Set([...canvas.querySelectorAll('[id]')].map((node) => node.id))
  for (const node of [source, ...source.querySelectorAll('[id]')]) if (node.id) taken.add(node.id)
  const ids = new Map<string, string>()
  let count = 0
  for (const node of [source, ...source.querySelectorAll('[id]')]) {
    if (!node.id) continue
    let id: string
    do id = `preview-shared-${count++}`
    while (taken.has(id))
    ids.set(node.id, id)
    taken.add(id)
  }
  return ids
}

/** Whether an ID is one a test looks for: exactly, or ignoring ASCII case for an attribute selector
 * with the `i` flag. */
type IdTest = (id: string, caseless: boolean) => boolean

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase())
}

function idsIn(ids: ReadonlySet<string>): IdTest {
  let folded: ReadonlySet<string> | undefined
  return (id, caseless) => {
    if (!caseless) return ids.has(id)
    folded ??= new Set([...ids].map(asciiLower))
    return folded.has(asciiLower(id))
  }
}

/** A derived preview ID as previewIds allocates it. Authored text that only mentions the prefix,
 * in an attribute, a class, a comment or another ID, is no such ID. */
function isPreviewId(id: string, caseless: boolean): boolean {
  return /^preview-shared-\d+$/.test(caseless ? asciiLower(id) : id)
}

/** An ID one simple selector requires of its element, and how it compares. */
interface RequiredId {
  readonly id: string
  readonly caseless: boolean
}

/** The ID of `#x` alone. Page ownership reads this form: a rule that names its element by
 * attribute stays whole in the sheet that stores it. */
function selectorId(node: CssNode): RequiredId | undefined {
  return node.type === 'IdSelector' ? { id: ident.decode(node.name), caseless: false } : undefined
}

/** The ID one simple selector requires of its element: `#x`, or the id attribute with the `=`
 * matcher, as in `[id="x"]`, `[id=x]` and `[*|id="x"]`, by decoded and lowercased name and decoded
 * value. The `i` flag compares ignoring ASCII case. A substring matcher such as `[id^="x"]`, or an
 * unknown flag, names no ID. */
function requiredId(node: CssNode): RequiredId | undefined {
  if (node.type === 'IdSelector') return selectorId(node)
  if (node.type !== 'AttributeSelector' || node.matcher !== '=' || !node.value) return undefined
  const name = ident.decode(node.name.name).toLowerCase()
  if (name !== 'id' && name !== '|id' && name !== '*|id') return undefined
  const flags = node.flags === null ? '' : ident.decode(node.flags).toLowerCase()
  if (flags !== '' && flags !== 'i' && flags !== 's') return undefined
  const id = node.value.type === 'String' ? node.value.value : ident.decode(node.value.name)
  return { id, caseless: flags === 'i' }
}

function renameUrls(node: CssNode, ids: ReadonlyMap<string, string>): boolean {
  let changed = false
  walk(node, {
    visit: 'Url',
    enter(url) {
      const next = url.value.startsWith('#') ? ids.get(url.value.slice(1)) : undefined
      if (!next) return
      url.value = `#${next}`
      changed = true
    },
  })
  return changed
}

function previewReference(name: string, value: string, ids: ReadonlyMap<string, string>): string {
  if (name === 'id') return ids.get(value) ?? value
  if ((name === 'href' || name === 'xlink:href') && value.startsWith('#'))
    return `#${ids.get(value.slice(1)) ?? value.slice(1)}`
  if (idReferences.has(name)) return value.replace(/\S+/g, (id) => ids.get(id) ?? id)
  if (urlAttributes.has(name) && /url\(/i.test(value)) {
    const tree = parse(value, { context: name === 'style' ? 'declarationList' : 'value' })
    if (renameUrls(tree, ids)) return generate(tree)
  }
  return value
}

function aboutPreview(source: Element, ids: ReadonlyMap<string, string>): string {
  const copy = source.cloneNode(true) as Element
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      const alias = previewAttributes.get(attr.name)
      // Selector aliases retain authored values, including partial attribute matchers.
      if (alias) node.setAttribute(alias, attr.value)
      if (removedPreviewAttributes.has(attr.name)) node.removeAttribute(attr.name)
      else node.setAttribute(attr.name, previewReference(attr.name, attr.value, ids))
    }
  }
  copy.setAttribute(previewAttribute, '1')
  return copy.outerHTML
}

/** Guards have zero specificity and precede pseudo-elements. Preview writes are scoped to
 * the subject; owner reads also exclude derived candidates in ancestors and functions. */
function guardSelector(selector: Selector, preview: boolean): void {
  let before: Parameters<typeof selector.children.insertData>[1] | undefined
  let compound = false
  const positions: (typeof before)[] = []
  selector.children.forEach((node, item) => {
    if (node.type === 'Combinator') {
      if (compound && !preview) positions.push(before ?? item)
      compound = false
      before = undefined
      return
    }
    compound = true
    if (
      !before &&
      (node.type === 'PseudoElementSelector' ||
        (node.type === 'PseudoClassSelector' &&
          ['before', 'after', 'first-line', 'first-letter'].includes(
            ident.decode(node.name).toLowerCase(),
          )))
    )
      before = item
  })
  if (compound) positions.push(before)
  for (const position of positions) {
    const guard = clone(preview ? previewGuard : ownerGuard)
    if (position) selector.children.insertData(guard, position)
    else selector.children.appendData(guard)
  }
}

function projectedSelectors(
  original: SelectorList,
  ids: ReadonlyMap<string, string>,
  preview: boolean,
): SelectorList {
  const selectors = clone(original) as SelectorList
  const only = selectors.children.size === 1 ? selectors.children.first : null
  // Canonical IDs are distinct from every allocated preview ID already.
  if (
    !preview &&
    only?.type === 'Selector' &&
    only.children.size === 1 &&
    only.children.first?.type === 'IdSelector'
  )
    return selectors
  if (preview) {
    selectors.children.forEach((selector) => {
      if (selector.type !== 'Selector') return
      // The guard below keeps the subject inside the derived copy, so its own attribute tests read
      // the aliases. Another compound, or a functional argument, can test a Home element outside
      // the copy, which keeps its attributes: it accepts either name, with the specificity of one.
      const subject = new Set<CssNode>()
      for (const node of selector.children.toArray().reverse()) {
        if (node.type === 'Combinator') break
        subject.add(node)
      }
      const either: { attribute: AttributeSelector; alias: string; item: ListItem<CssNode> }[] = []
      walk(selector, {
        enter(node: CssNode, item: ListItem<CssNode>) {
          if (node.type === 'IdSelector') {
            const next = ids.get(ident.decode(node.name))
            if (next) node.name = ident.encode(next)
          } else if (node.type === 'AttributeSelector') {
            const alias = previewAttributes.get(ident.decode(node.name.name).toLowerCase())
            if (!alias) return
            if (subject.has(node)) node.name.name = alias
            else either.push({ attribute: node, alias, item })
          }
        },
      })
      for (const { attribute, alias, item } of either) {
        const aliased = clone(attribute) as AttributeSelector
        aliased.name.name = alias
        const alternatives = [attribute, aliased].map((node): Selector => ({
          type: 'Selector',
          children: new List<CssNode>().fromArray([node]),
        }))
        item.data = {
          type: 'PseudoClassSelector',
          name: 'is',
          children: new List<CssNode>().fromArray([
            { type: 'SelectorList', children: new List<CssNode>().fromArray(alternatives) },
          ]),
        }
      }
      // Functional arguments can test external ancestors. Only the outer subject is written.
      guardSelector(selector, true)
    })
  } else {
    // A derived candidate must not activate an owner's :has(), including nested conditions.
    // Collect first so the private guard's own selectors are not visited again.
    const originals: Selector[] = []
    walk(selectors, {
      visit: 'Selector',
      enter(selector) {
        originals.push(selector)
      },
    })
    for (const selector of originals) guardSelector(selector, false)
  }
  return selectors
}

function projectPreviewStyles(css: string, ids: ReadonlyMap<string, string>): string {
  if (!css) return css
  const sheet = parseCanvasSheet(css)
  const projectRule = (rule: Rule): CssNode[] => {
    if (rule.prelude.type !== 'SelectorList') return [rule]
    const owner = projectedSelectors(rule.prelude, ids, false)
    const preview = projectedSelectors(rule.prelude, ids, true)
    const combined: SelectorList = {
      type: 'SelectorList',
      children: new List<CssNode>().fromArray([
        ...owner.children.toArray(),
        ...preview.children.toArray(),
      ]),
    }
    const output: CssNode[] = []
    let pending: CssNode[] = []
    const emit = (prelude: SelectorList, children: CssNode[]): void => {
      if (children.length)
        output.push({
          type: 'Rule',
          prelude: clone(prelude) as SelectorList,
          block: { type: 'Block', children: new List<CssNode>().fromArray(children) },
        })
    }
    const flush = (): void => {
      emit(combined, pending)
      pending = []
    }
    for (const child of rule.block.children) {
      if (child.type === 'Declaration') {
        const derived = clone(child)
        if (renameUrls(derived, ids)) {
          // Sibling rules retain each direct branch's specificity. A nested & here
          // would incorrectly give a plain class the highest parent's ID specificity.
          flush()
          emit(owner, [child])
          emit(preview, [derived])
        } else pending.push(child)
      } else if (child.type === 'Rule') pending.push(...projectRule(child))
      else if (
        child.type === 'Atrule' &&
        ['media', 'supports', 'container'].includes(ident.decode(child.name).toLowerCase())
      ) {
        // Move the selector context inside its existing grouping node, once. This
        // preserves direct conditional declarations without &.
        flush()
        if (child.block)
          child.block.children = new List<CssNode>().fromArray(
            projectRule({ type: 'Rule', prelude: rule.prelude, block: child.block }),
          )
        output.push(child)
      } else pending.push(child)
    }
    flush()
    return output
  }
  const project = (node: CssNode): void => {
    if (node.type !== 'StyleSheet' && node.type !== 'Block') return
    node.children.forEach((child, item, list) => {
      if (child.type === 'Rule') {
        list.replace(item, new List<CssNode>().fromArray(projectRule(child)))
      } else if (
        child.type === 'Atrule' &&
        child.block &&
        !['keyframes', '-webkit-keyframes', 'font-face'].includes(
          ident.decode(child.name).toLowerCase(),
        )
      )
        project(child.block)
    })
  }
  project(sheet)
  return generate(sheet)
}

/** Static comparison consumers still receive both responsive surfaces. */
export function composedCanvas(
  page: CmsPage,
  presentation: CmsPresentation,
  lang: CmsLang,
  mode: CmsMode,
  scene: CmsScene = 'default',
  device: CanvasDevice = 'Desktop',
  projectStyles = false,
): { html: string; css: string } {
  const passes = composedCanvasPasses(page, presentation, lang, mode, scene, device, false)
  let step = passes.next()
  while (!step.done) step = passes.next()
  const content = step.value
  const css = generate(content.sheet)
  return { html: content.html, css: (projectStyles && content.projectStyles?.(css)) || css }
}

/** The runtime slot under `root` that holds the named About section. */
function aboutSlot(root: Component | undefined): Component | undefined {
  return root
    ?.find('[data-knc-slot]')
    .find((slot) =>
      slot
        .components()
        .some(
          (child: Component) =>
            child.get('tagName') === 'section' && child.getAttributes()['aria-labelledby'],
        ),
    )
}

function configureTree(component: Component): void {
  configureComponent(component, { silent: true })
  component.components().forEach(configureTree)
}

/** Install the deferred tree once, before either idle completion or the first ownership move. */
export function installHomeAboutPreview(editor: Editor, create: () => string): void {
  const slot = aboutSlot(editor.getWrapper())
  if (!slot) return
  const preview = create()
  editor.UndoManager.skip(() => {
    slot.components(preview)
    slot.components().forEach(configureTree)
  })
}

/** Only ownership moves on a Home device switch; both responsive trees already exist. */
export function moveHomeAbout(editor: Editor, device: CanvasDevice): boolean {
  const wrapper = editor.getWrapper()
  const from = wrapper?.find('[data-editor-about-slot]')[0]
  const to = aboutSlot(wrapper?.find(`[data-knc-surface="${device.toLowerCase()}-home"]`)[0])
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
    for (const stage of stages) if (stage) configureTree(stage)
    configureComponent(content, { silent: true })
    configureComponent(flow, { silent: true })
  })
  return true
}

function deduplicateRules(sheet: CssNode): void {
  // GrapesJS merges repeated media/keyframe blocks, so deduplicate their children too. Only an
  // earlier copy is inert.
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

function namesId(node: CssNode, matches: IdTest): boolean {
  let found = false
  walk(node, (child) => {
    const required = requiredId(child)
    if (required && matches(required.id, required.caseless)) found = true
  })
  return found
}

/** Whether a node names a matching page ID where the ID decides which elements its selector styles.
 * An ID inside an odd number of :not() only excludes elements, and an ID inside :has() tests a
 * relative of the styled element, so neither qualifies nor disqualifies the selector for a page.
 * Every other ID counts, also inside :is(), :where() and :matches(), which style the elements
 * their arguments match. `read` gives the ID a simple selector names: `#x` alone by default. */
function namesPageId(
  node: CssNode,
  matches: IdTest,
  read: (node: CssNode) => RequiredId | undefined = selectorId,
): boolean {
  let found = false
  let negations = 0
  let relatives = 0
  const scope = (child: CssNode, step: number): void => {
    if (child.type !== 'PseudoClassSelector') return
    const name = ident.decode(child.name).toLowerCase()
    if (name === 'not') negations += step
    if (name === 'has') relatives += step
  }
  walk(node, {
    enter(child: CssNode) {
      scope(child, 1)
      const required = negations % 2 === 0 && relatives === 0 ? read(child) : undefined
      if (required && matches(required.id, required.caseless)) found = true
    },
    leave(child: CssNode) {
      scope(child, -1)
    },
  })
  return found
}

/** Remove selector branches naming a dropped page ID, or a derived preview ID anywhere, then the
 * blocks that removal emptied. Authored empty blocks stay. */
function dropSelectors(sheet: CssNode, dropped: IdTest): void {
  const shrunk = new Set<List<CssNode>>()
  walk(sheet, {
    leave(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      if (node.type !== 'Rule' && node.type !== 'Atrule') return
      let unmatched = false
      if (node.type === 'Rule' && node.prelude.type === 'SelectorList') {
        node.prelude.children.forEach((selector, branch, branches) => {
          if (namesId(selector, isPreviewId) || namesPageId(selector, dropped))
            branches.remove(branch)
        })
        unmatched = node.prelude.children.size === 0
      }
      const children = node.block?.children
      const emptied = children?.size === 0 && shrunk.has(children)
      if ((unmatched || emptied) && item && list) {
        list.remove(item)
        shrunk.add(list)
      }
    },
  })
}

/** The sheets of the two pages sharing a Home save, on the same root-selector basis. */
export interface ComposedOwners {
  about: string
  home: string
}

/** Home's sheet owners, with the IDs Home's own markup holds. */
export interface HomeSheetOwners extends ComposedOwners {
  /** About's extraction drops what styles these, so Home keeps it. */
  own: ReadonlySet<string>
}

/** Home's export also needs About's stored markup: it names the section Home keeps no rule for. */
interface ComposedHomeOwners extends ComposedOwners {
  aboutHtml: string
}

/** GrapesJS imports a conditional block as one rule per child, so match either stored form. */
function storedItems(css: string): Set<string> {
  const items = new Set<string>()
  for (const node of parseCanvasSheet(css).children) {
    items.add(generate(node))
    if (node.type !== 'Atrule' || !node.block) continue
    for (const child of node.block.children)
      items.add(
        generate({
          ...node,
          block: { ...node.block, children: new List<CssNode>().fromArray([child]) },
        }),
      )
  }
  return items
}

/** A Home item stays out of About unless About stored it or names it: a remainder would follow
 * Home's rule on the public page and override it. Anything unproven stays, so nothing is lost. */
function dropHomeItems(
  sheet: StyleSheet,
  sources: ReadonlyMap<CssNode, string>,
  owners: ComposedOwners,
  aboutIds: ReadonlySet<string>,
): void {
  const about = storedItems(owners.about)
  const home = storedItems(owners.home)
  const aboutId = idsIn(aboutIds)
  sheet.children.forEach((node, item, list) => {
    const source = sources.get(node) ?? ''
    const remainder = generate(node)
    if (about.has(source) || about.has(remainder)) return
    // The canvas has one body, so an unstored root rule belongs to the Home being edited.
    const root = bindCmsRootStyles(source, 'root') !== source
    if ((root || home.has(source) || home.has(remainder)) && !namesPageId(node, aboutId))
      list.remove(item)
  })
}

/** Home's stylesheet precedes About's on the public page, and About may not be mounted there.
 * Rules for About's section are gone before this runs, except for IDs Home's own markup holds.
 * Only an item About holds verbatim and Home did not store may leave. A rule that lost an About ID
 * would be a partial copy of it; an intact item is shared site CSS and stays, unless it names a
 * discarded About ID where it decides, also by attribute as in `[id="x"]`, and none of Home's own:
 * it styles only About's section. A rule that still names one of Home's own IDs where it decides
 * stays: About's extraction drops that part. An attribute form never splits, so such a rule stays
 * whole and also styles About's element. */
function dropAboutCopies(
  sheet: StyleSheet,
  sources: ReadonlyMap<CssNode, string>,
  owners: HomeSheetOwners,
  discarded: ReadonlySet<string>,
): void {
  const about = storedItems(owners.about)
  const home = storedItems(owners.home)
  const own = idsIn(owners.own)
  const aboutId = idsIn(discarded)
  sheet.children.forEach((node, item, list) => {
    const source = sources.get(node) ?? ''
    const remainder = generate(node)
    if (
      about.has(source) &&
      !home.has(source) &&
      !home.has(remainder) &&
      (source !== remainder || namesPageId(node, aboutId, requiredId)) &&
      !namesPageId(node, own)
    )
      list.remove(item)
  })
}

/** The IDs of About's stored section, read as extractComposedAbout reads the stored original. A
 * page without that section names none. */
function storedAboutIds(html: string): string[] {
  const section = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('[data-knc-surface="about"]')
  if (!section) return []
  return [section, ...section.querySelectorAll('[id]')]
    .map((node) => node.id)
    .filter((id) => id !== '')
}

/** Derived About previews never belong to the Home document. Persist only their slot marker;
 * the next render fills it from About again. Prune stale preview selectors and duplicate CSS.
 * Home's export keeps no rule for About's section: with owners, every ID of About's stored
 * section leaves too, also where the canvas lacks its element, unless Home's own markup holds it. */
export function stripComposedCanvas(
  html: string,
  css: string,
  scene: CmsScene = 'default',
  owners?: ComposedHomeOwners,
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
    // A derived preview keeps its authored label in an alias. Persist that, never the derived ID.
    const labelledby = section.getAttribute('data-editor-preview-labelledby')
    if (labelledby !== null) section.setAttribute('aria-labelledby', labelledby)
    // An inert marker keeps older source documents and future core-page preparation compatible.
    for (const attr of [...section.attributes])
      if (attr.name !== 'aria-labelledby') section.removeAttribute(attr.name)
    section.setAttribute('data-knc-baseline', '{}')
  }
  if (!owners) return { html: doc.body.innerHTML, css: stripHomeSheet(css, discarded) }
  // The slot sections are empty now, so each ID left in the document is Home's own.
  const own = new Set([...doc.querySelectorAll('[id]')].map((node) => node.id))
  for (const id of storedAboutIds(owners.aboutHtml)) if (!own.has(id)) discarded.add(id)
  return {
    html: doc.body.innerHTML,
    css: stripHomeSheet(css, discarded, { about: owners.about, home: owners.home, own }),
  }
}

/** Home's part of the canvas sheet: no selector branch for a discarded ID and, with owners, no copy
 * of About's items. It reads no markup. The canvas sheet is parsed as the stored sheets are, custom
 * properties included: the canvas writes `--x:red !important`, which only then reads as the stored
 * `--x:red!important`. */
export function stripHomeSheet(
  css: string,
  discarded: ReadonlySet<string>,
  owners?: HomeSheetOwners,
): string {
  const sheet = parseCanvasSheet(css)
  const sources = new Map(sheet.children.toArray().map((node) => [node, generate(node)]))
  dropSelectors(sheet, idsIn(discarded))
  if (owners) dropAboutCopies(sheet, sources, owners, discarded)
  deduplicateRules(sheet)
  return generate(sheet)
}

/** Extract the canonical About owner before Home removes its derived slot contents.
 * Non-ID source rules are shared site CSS. Other pages' ID rules must not leak into About.
 */
export function extractComposedAbout(
  html: string,
  css: string,
  original: string,
  owners?: ComposedOwners,
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
  previous.replaceWith(about.cloneNode(true))
  return { html: saved.body.innerHTML, css: extractAboutSheet(css, aboutIds, otherIds, owners) }
}

/** About's part of the canvas sheet: no selector branch for another ID of the canvas and, with
 * owners, none of Home's items. It reads no markup. The canvas sheet is parsed as stripHomeSheet
 * parses it. */
export function extractAboutSheet(
  css: string,
  aboutIds: ReadonlySet<string>,
  otherIds: ReadonlySet<string>,
  owners?: ComposedOwners,
): string {
  const tree = parseCanvasSheet(css)
  const sources = new Map(tree.children.toArray().map((node) => [node, generate(node)]))
  dropSelectors(tree, idsIn(otherIds))
  if (owners) dropHomeItems(tree, sources, owners, aboutIds)
  deduplicateRules(tree)
  return generate(tree)
}
