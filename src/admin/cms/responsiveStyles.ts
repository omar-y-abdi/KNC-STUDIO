import {
  clone,
  generate,
  ident,
  List,
  parse,
  walk,
  type Atrule,
  type Block,
  type CssNode,
  type Declaration,
  type ListItem,
  type Rule,
  type StyleSheet,
} from 'css-tree'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import type { CmsLang, CmsMode, CmsPage } from '../../../shared/cms'
import { isSitePage, normalizeSitePageContent } from '../../../shared/site-page'
import { isLegacyDesktopMedia } from '../../../shared/cms-device-css'
import type { Editor } from 'grapesjs'

export const editorDevices = [
  { id: 'Desktop', name: 'Desktop', width: '1440px', height: '900px', widthMedia: '769px' },
  {
    id: 'DesktopNarrow',
    name: 'DesktopNarrow',
    width: '820px',
    height: '900px',
    widthMedia: '769px',
  },
  { id: 'Mobile', name: 'Mobile', width: '390px', height: '844px', widthMedia: '768px' },
]

/** Preview width never changes the geometry's saved device scope. */
export function canvasDevice(device: 'Desktop' | 'Mobile', narrow: boolean): string {
  return device === 'Desktop' && narrow ? 'DesktopNarrow' : device
}

// Appearance is theme-specific; geometry is shared by light/dark and scoped by device.
const geometryProperties = new Set(
  'display position top right bottom left z-index translate transform rotate scale zoom width height inline-size block-size aspect-ratio gap row-gap column-gap order box-sizing float clear text-align font-size line-height letter-spacing white-space object-fit object-position'.split(
    ' ',
  ),
)
const geometryPrefixes = [
  'inset',
  'transform',
  'min',
  'max',
  'margin',
  'padding',
  'flex',
  'grid',
  'align',
  'justify',
  'place',
  'overflow',
]
const isGeometry = (property: string): boolean =>
  geometryProperties.has(property) ||
  geometryPrefixes.some((prefix) => property === prefix || property.startsWith(`${prefix}-`))

/** Only a single element selector (or the canonical document root) is an editable layout. */
function layoutSelector(prelude: CssNode): string | undefined {
  if (generate(prelude) === 'html body') return 'html body'
  if (prelude.type !== 'SelectorList' || prelude.children.size !== 1) return
  const selector = prelude.children.first
  if (selector?.type !== 'Selector' || selector.children.size !== 1) return
  const node = selector.children.first
  if (node?.type === 'IdSelector') return `#${ident.encode(ident.decode(node.name))}`
  if (
    node?.type === 'AttributeSelector' &&
    node.name.name === 'id' &&
    node.matcher === '=' &&
    !node.flags &&
    node.value?.type === 'String'
  )
    return `#${ident.encode(node.value.value)}`
  return undefined
}

const mediaKeys = new WeakMap<Atrule, string>()
/** Compare legacy rules in the scope visitors already see, without rewriting untouched CSS. */
function layoutMedia(node: Atrule | null): string {
  if (!node || ident.decode(node.name).toLowerCase() !== 'media' || !node.prelude) return ''
  const known = mediaKeys.get(node)
  if (known !== undefined) return known
  const media = isLegacyDesktopMedia(node) ? '(min-width:769px)' : generate(node.prelude)
  mediaKeys.set(node, media)
  return media
}

interface LayoutTarget {
  readonly selector: string
  readonly text: boolean
}

interface LayoutSibling {
  readonly header: string
  readonly occurrence: number
}
interface LayoutContext {
  readonly header: string
  readonly position: number
  readonly occurrence?: number
  readonly preceding?: LayoutSibling
  readonly following?: LayoutSibling
}
interface LayoutLocation {
  readonly selector: string
  readonly media: string
  readonly path?: LayoutContext[]
}
interface LayoutDeclaration {
  readonly location: LayoutLocation
  readonly declaration: Declaration
}
interface LayoutChange {
  readonly location: LayoutLocation
  readonly values: Map<string, CssNode | null>
}
type Declarations = Map<string, Map<string, LayoutDeclaration>>
type LayoutChanges = Map<string, LayoutChange>
type LayoutBlock = Block | StyleSheet

/** Resolver overrides end in one zero-specificity component anchor. The complete branch
 * before it remains an owner constraint, including ancestor classes and pseudo-classes. */
function anchoredSelector(prelude: CssNode): string | undefined {
  if (prelude.type !== 'SelectorList' || prelude.children.size !== 1) return
  const branch = prelude.children.first
  if (branch?.type !== 'Selector') return
  const suffix = branch.children.last
  if (suffix?.type !== 'PseudoClassSelector' || ident.decode(suffix.name).toLowerCase() !== 'where')
    return
  const target = suffix.children?.first
  return target ? layoutSelector(target) : undefined
}

function contextHeader(node: Rule | Atrule): string {
  if (node.type === 'Rule') return generate(node.prelude)
  const name = ident.decode(node.name).toLowerCase()
  const prelude = name === 'media' ? layoutMedia(node) : node.prelude ? generate(node.prelude) : ''
  return `@${name}${prelude ? ` ${prelude}` : ''}`
}

function locationKey(location: LayoutLocation): string {
  // Ancestor occurrences distinguish authored scopes. A terminal target guard can be
  // split across equivalent rules; its occurrence and positions only guide insertion.
  return JSON.stringify([
    location.selector,
    location.path?.map(({ header, occurrence }, index, path) => [
      header,
      index === path.length - 1 ? null : (occurrence ?? null),
    ]) ?? location.media,
  ])
}

/** Placement belongs to a changed property, never to geometry equality. Adjacent equivalent
 * media groups may be split or combined without becoming owner edits. */
function placementKey(location: LayoutLocation): string {
  return JSON.stringify([
    locationKey(location),
    location.path?.map(({ position, occurrence, preceding, following }) => [
      position,
      occurrence,
      preceding,
      following,
    ]),
  ])
}

function isLayerOrder(node: Rule | Atrule): boolean {
  return (
    node.type === 'Atrule' &&
    ident.decode(node.name).toLowerCase() === 'layer' &&
    Boolean(node.prelude) &&
    (!node.block || node.block.children.isEmpty)
  )
}

function declarations(css: string): Declarations {
  const result: Declarations = new Map()
  const visit = (block: LayoutBlock, path: LayoutContext[], media: Atrule | null): void => {
    const occurrences = new Map<string, number>()
    const siblings: {
      node: Rule | Atrule
      header: string
      occurrence: number
      preceding?: LayoutSibling
      following?: LayoutSibling
    }[] = []
    block.children.forEach((node) => {
      if (node.type !== 'Rule' && node.type !== 'Atrule') return
      const header = contextHeader(node)
      const occurrence = occurrences.get(header) ?? 0
      if (!isLayerOrder(node)) occurrences.set(header, occurrence + 1)
      siblings.push({ node, header, occurrence })
    })
    // Same-header neighbors can be harmless media splitting. Only a distinct owner
    // condition bounds a guard; layer-order placeholders are not such conditions.
    for (const direction of ['preceding', 'following'] as const) {
      let previous: (typeof siblings)[number] | undefined
      let boundary: LayoutSibling | undefined
      for (const sibling of direction === 'preceding' ? siblings : [...siblings].reverse()) {
        if (isLayerOrder(sibling.node)) continue
        if (previous?.header !== sibling.header)
          boundary = previous
            ? { header: previous.header, occurrence: previous.occurrence }
            : undefined
        if (boundary) sibling[direction] = boundary
        previous = sibling
      }
    }
    siblings.forEach(({ node, header, occurrence, preceding, following }, position) => {
      const ordered =
        !isLayerOrder(node) &&
        (node.type === 'Rule' || ident.decode(node.name).toLowerCase() === 'layer')
      const context: LayoutContext = {
        header,
        position,
        ...(ordered ? { occurrence } : {}),
        ...(!ordered && preceding ? { preceding } : {}),
        ...(!ordered && following ? { following } : {}),
      }
      const nextPath = [...path, context]
      if (node.type === 'Rule') {
        const anchored = anchoredSelector(node.prelude)
        const selector = anchored ?? layoutSelector(node.prelude)
        if (selector) {
          const location: LayoutLocation = {
            selector,
            media: layoutMedia(media),
            ...(anchored ? { path: nextPath } : {}),
          }
          const key = locationKey(location)
          const values = result.get(key) ?? new Map<string, LayoutDeclaration>()
          node.block.children.forEach((declaration) => {
            if (declaration.type !== 'Declaration' || !isGeometry(declaration.property)) return
            const previous = values.get(declaration.property)?.declaration
            // Within this selector/context, important beats normal; ties retain source order.
            if (previous?.important && !declaration.important) return
            values.set(declaration.property, { declaration, location })
          })
          result.set(key, values)
        }
        visit(node.block, nextPath, media)
      } else if (node.block) visit(node.block, nextPath, node)
    })
  }
  const tree = parse(css)
  if (tree.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
  visit(tree, [], null)
  return result
}

const textHeight = new Map([
  ['height', parse('height:auto!important', { context: 'declaration' })],
  ['max-height', parse('max-height:none!important', { context: 'declaration' })],
])

function layoutChanges(previous: Declarations, next: Declarations): LayoutChanges {
  const changes: LayoutChanges = new Map()
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const a = previous.get(key) ?? new Map<string, LayoutDeclaration>()
    const b = next.get(key) ?? new Map<string, LayoutDeclaration>()
    for (const property of new Set([...a.keys(), ...b.keys()])) {
      const oldValue = a.get(property)
      const newValue = b.get(property)
      if (
        (oldValue && generate(oldValue.declaration)) ===
        (newValue && generate(newValue.declaration))
      )
        continue
      const location = newValue?.location ?? oldValue?.location
      if (!location) continue
      const placement = placementKey(location)
      const changed = changes.get(placement) ?? {
        location,
        values: new Map<string, CssNode | null>(),
      }
      changed.values.set(property, newValue?.declaration ?? null)
      changes.set(placement, changed)
    }
  }
  return changes
}

function mapHeader(header: string, targets: ReadonlyMap<string, LayoutTarget>): string {
  if (header.startsWith('@')) return header
  const selector = parse(header, { context: 'selectorList' })
  walk(selector, (node) => {
    if (node.type === 'IdSelector') {
      const target = targets.get(`#${ident.encode(ident.decode(node.name))}`)
      if (target) node.name = target.selector.slice(1)
    } else if (
      node.type === 'AttributeSelector' &&
      node.name.name === 'id' &&
      node.matcher === '=' &&
      node.value?.type === 'String'
    ) {
      const target = targets.get(`#${ident.encode(node.value.value)}`)
      if (target) node.value.value = ident.decode(target.selector.slice(1))
    }
  })
  return generate(selector)
}

function mapContext(
  context: LayoutContext,
  targets?: ReadonlyMap<string, LayoutTarget>,
): LayoutContext {
  if (!targets) return context
  const mapSibling = (sibling: LayoutSibling): LayoutSibling => ({
    ...sibling,
    header: mapHeader(sibling.header, targets),
  })
  return {
    ...context,
    header: mapHeader(context.header, targets),
    ...(context.preceding ? { preceding: mapSibling(context.preceding) } : {}),
    ...(context.following ? { following: mapSibling(context.following) } : {}),
  }
}

function siblingIndex(siblings: (Rule | Atrule)[], sibling?: LayoutSibling): number {
  if (!sibling) return -1
  const match = siblings.filter(
    (node) => !isLayerOrder(node) && contextHeader(node) === sibling.header,
  )[sibling.occurrence]
  return match ? siblings.indexOf(match) : -1
}

function matchingContexts(
  block: LayoutBlock,
  context: LayoutContext,
  bounded = true,
): (Rule | Atrule)[] {
  const siblings = block.children
    .toArray()
    .filter((node): node is Rule | Atrule => node.type === 'Rule' || node.type === 'Atrule')
  const preceding = bounded ? siblingIndex(siblings, context.preceding) : -1
  const following = bounded ? siblingIndex(siblings, context.following) : -1
  const matches = siblings.filter(
    (node, index) =>
      Boolean(node.block) &&
      !isLayerOrder(node) &&
      contextHeader(node) === context.header &&
      (preceding < 0 || index > preceding) &&
      (following < 0 || index < following),
  )
  if (context.occurrence === undefined) return matches
  const match = matches[context.occurrence]
  return match ? [match] : []
}

function contextBlocks(block: LayoutBlock, path: LayoutContext[], bounded = true): Block[] {
  const [context, ...remaining] = path
  if (!context) return block.type === 'Block' ? [block] : []
  const target =
    !bounded && !remaining.length ? { header: context.header, position: context.position } : context
  return matchingContexts(block, target, bounded).flatMap((node) =>
    node.block
      ? remaining.length
        ? contextBlocks(node.block, remaining, bounded)
        : [node.block]
      : [],
  )
}

function contextDepth(block: LayoutBlock, path: LayoutContext[]): number {
  const [context, ...remaining] = path
  if (!context) return 0
  return Math.max(
    0,
    ...matchingContexts(block, context).map((node) =>
      node.block ? 1 + contextDepth(node.block, remaining) : 0,
    ),
  )
}

function insertContext(block: LayoutBlock, context: LayoutContext): Block {
  const node = parse(`${context.header}{}`, {
    context: context.header.startsWith('@') ? 'atrule' : 'rule',
  })
  if ((node.type !== 'Rule' && node.type !== 'Atrule') || !node.block)
    throw new Error('Layoutens CSS-villkor kunde inte bevaras.')
  const children = block.children.toArray()
  const siblings = children.filter(
    (child): child is Rule | Atrule => child.type === 'Rule' || child.type === 'Atrule',
  )
  let position = context.position
  const preceding = siblingIndex(siblings, context.preceding)
  const following = siblingIndex(siblings, context.following)
  if (preceding >= 0) position = Math.max(position, preceding + 1)
  if (following >= 0) position = Math.min(position, following)
  if (context.occurrence !== undefined) {
    // Missing anonymous layers reserve real ordinal slots. Their populated successor
    // must follow those placeholders even when their source insertion position is earlier.
    const previous = siblings.findLast(
      (child) => !isLayerOrder(child) && contextHeader(child) === context.header,
    )
    if (previous) position = Math.max(position, siblings.indexOf(previous) + 1)
  }
  const before = siblings[position]
  const index = before ? children.indexOf(before) : children.length
  children.splice(index, 0, node)
  block.children = new List<CssNode>().fromArray(children)
  return node.block
}

function ensureContext(block: LayoutBlock, path: LayoutContext[]): Block {
  const [context, ...remaining] = path
  if (!context) {
    if (block.type !== 'Block') throw new Error('Layouten saknar sitt CSS-block.')
    return block
  }
  const candidates = matchingContexts(block, context)
  // Prefer the existing complete path, even when equivalent media groups were split or
  // combined differently between themes. Anonymous layers retain their own occurrence.
  const candidate = candidates.reduce<Rule | Atrule | undefined>((best, current) => {
    if (!current.block) return best
    return !best?.block ||
      contextDepth(current.block, remaining) >= contextDepth(best.block, remaining)
      ? current
      : best
  }, undefined)
  let next = candidate?.block
  if (!next) {
    if (context.occurrence !== undefined) {
      const existing = block.children
        .toArray()
        .filter(
          (node) =>
            (node.type === 'Rule' || node.type === 'Atrule') &&
            !isLayerOrder(node) &&
            contextHeader(node) === context.header,
        ).length
      for (let index = existing; index < context.occurrence; index++)
        insertContext(block, { ...context, position: context.position + index - existing })
    }
    next = insertContext(block, context)
  }
  return ensureContext(next, remaining)
}

/** A guard nested in its component's own rule ties with that rule's declarations, so source
 * order alone decides. A sync can deliver either side first, even in one edit: a declaration
 * behind the guard replacing it moves directly ahead of that guard. Only rules under identical
 * media conditions compare, so a move never changes when the declaration applies. */
function keepGuardsLast(
  tree: StyleSheet,
  selectors: ReadonlySet<string>,
  shrunk: Set<List<CssNode>>,
): void {
  const guards = new Map<string, { children: List<CssNode>; item: ListItem<CssNode> }>()
  const visit = (block: LayoutBlock, scope: string): void => {
    block.children.forEach((node) => {
      if (node.type === 'Atrule') {
        if (node.block && ident.decode(node.name).toLowerCase() === 'media')
          visit(node.block, `${scope}${contextHeader(node)}{`)
        return
      }
      if (node.type !== 'Rule') return
      const selector = layoutSelector(node.prelude)
      if (!selector || !selectors.has(selector)) return
      const { children } = node.block
      children.forEach((child, item) => {
        if (child.type === 'Declaration') {
          const guard = guards.get(`${scope}${selector}{${child.property}`)
          if (!guard) return
          children.remove(item)
          shrunk.add(children)
          guard.children.insertData(child, guard.item)
          return
        }
        walk(child, {
          visit: 'Rule',
          enter(rule) {
            if (anchoredSelector(rule.prelude) !== selector) return
            rule.block.children.forEach((declaration) => {
              if (declaration.type !== 'Declaration' || !isGeometry(declaration.property)) return
              const key = `${scope}${selector}{${declaration.property}`
              if (!guards.has(key)) guards.set(key, { children, item })
            })
          },
        })
      })
    })
  }
  visit(tree, '')
}

/** Rules a sync emptied leave the sheet with their emptied conditions. Authored empty blocks
 * and every layer stay: a layer holds its ordinal even with nothing inside it. */
function dropEmptied(tree: StyleSheet, shrunk: Set<List<CssNode>>): void {
  walk(tree, {
    leave(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
      if (node.type !== 'Rule' && node.type !== 'Atrule') return
      if (node.type === 'Atrule' && ident.decode(node.name).toLowerCase() === 'layer') return
      const children = node.block?.children
      if (children?.isEmpty && shrunk.has(children) && item && list) {
        list.remove(item)
        shrunk.add(list)
      }
    },
  })
}

/** Apply one delta to a theme or language. `source` only corrects clipping in the edited sheet. */
function applyLayout(
  changes: LayoutChanges,
  other: string,
  targets?: ReadonlyMap<string, LayoutTarget>,
  source?: Declarations,
): string {
  const mapped: LayoutChanges = new Map()
  for (const { location, values } of changes.values()) {
    const target = targets?.get(location.selector)
    if (targets && !target && location.selector !== 'html body') continue
    const changed = source ? new Map<string, CssNode | null>() : new Map(values)
    if (target?.text && [...values.values()].some((value) => value !== null)) {
      for (const [property, value] of textHeight) {
        const present = source?.get(locationKey(location))?.get(property)?.declaration
        if (!source || !present || generate(present) !== generate(value))
          changed.set(property, value)
      }
    }
    const next: LayoutLocation = {
      ...location,
      selector: target?.selector ?? location.selector,
      ...(location.path
        ? { path: location.path.map((context) => mapContext(context, targets)) }
        : {}),
    }
    if (changed.size) mapped.set(placementKey(next), { location: next, values: changed })
  }
  if (!mapped.size) return other
  const tree = parse(other)
  if (tree.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
  const shrunk = new Set<List<CssNode>>()
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      const changed = mapped.get(
        placementKey({
          selector: layoutSelector(rule.prelude) ?? '',
          media: layoutMedia(this.atrule),
        }),
      )
      if (!changed || changed.location.path) return
      rule.block.children.forEach((declaration, item) => {
        if (declaration.type === 'Declaration' && changed.values.has(declaration.property)) {
          rule.block.children.remove(item)
          shrunk.add(rule.block.children)
        }
      })
    },
  })
  for (const { location, values } of mapped.values()) {
    if (!location.path) continue
    // A counterpart may combine guards. Remove the changed properties throughout the
    // semantic context before choosing their source-ordered insertion destinations.
    const blocks = contextBlocks(tree, location.path, false)
    for (const block of blocks)
      block.children.forEach((declaration, item) => {
        if (declaration.type === 'Declaration' && values.has(declaration.property)) {
          block.children.remove(item)
          shrunk.add(block.children)
        }
      })
    const additions = [...values.values()].filter((value): value is CssNode => value !== null)
    if (additions.length) {
      const block = contextBlocks(tree, location.path).at(-1) ?? ensureContext(tree, location.path)
      for (const addition of additions) block.children.appendData(clone(addition))
    }
  }
  for (const { location, values } of mapped.values()) {
    if (location.path) continue
    const body = [...values.values()]
      .filter((v): v is CssNode => v !== null)
      .map((v) => generate(v))
      .join(';')
    if (!body) continue
    const added = parse(
      location.media
        ? `@media ${location.media}{${location.selector}{${body}}}`
        : `${location.selector}{${body}}`,
    )
    if (added.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
    tree.children.appendList(added.children)
  }
  const selectors = new Set([...mapped.values()].map(({ location }) => location.selector))
  keepGuardsLast(tree, selectors, shrunk)
  dropEmptied(tree, shrunk)
  return generate(tree)
}

/** Copy only changed geometry, preserving independent colors and untouched layout drift. */
export function syncLayout(before: string, after: string, other: string): string {
  return applyLayout(layoutChanges(declarations(before), declarations(after)), other)
}

type Node = DefaultTreeAdapterMap['node']
const textTags = new Set(
  'h1 h2 h3 h4 h5 h6 p span a button label li blockquote pre figcaption'.split(' '),
)
const localizedId =
  /^(cms-(?:body|page)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:sv|en)(?=-|$)/i
const layoutKey = (id: string): string => id.replace(localizedId, '$1')

/** Keep the live canvas as well as the saved translation free to grow when text wraps. */
export function connectTextAutoHeight(editor: Editor, disabled: () => boolean): () => void {
  let updating = false
  const change = (model: unknown, property: string): void => {
    if (updating || disabled() || !isGeometry(property)) return
    const component = editor.getSelected()
    const selectedStyle = editor.getSelectedToStyle()
    const element = component?.getEl()
    if (
      model !== selectedStyle ||
      !element ||
      element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      !(
        textTags.has(element.localName) ||
        [...element.childNodes].some((child) => child.nodeType === 3 && child.textContent?.trim())
      ) ||
      !element.textContent?.trim()
    )
      return
    updating = true
    try {
      selectedStyle?.addStyle({ height: 'auto!important', 'max-height': 'none!important' })
    } finally {
      updating = false
    }
  }
  editor.on('styleable:change', change)
  return () => {
    editor.off('styleable:change', change)
  }
}

function layoutElements(html: string): Map<string, LayoutTarget> {
  const result = new Map<string, LayoutTarget>()
  const hasText = (node: Node): boolean =>
    (node.nodeName === '#text' && 'value' in node && Boolean(node.value.trim())) ||
    ('childNodes' in node && node.childNodes.some(hasText))
  const visit = (node: Node): void => {
    if ('tagName' in node) {
      const id = node.attrs.find((attr) => attr.name === 'id')?.value
      if (id) {
        const directText = node.childNodes.some(
          (child) => child.nodeName === '#text' && 'value' in child && child.value.trim(),
        )
        result.set(id, {
          selector: `#${ident.encode(id)}`,
          text:
            node.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
            (directText || (textTags.has(node.tagName) && hasText(node))),
        })
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parseFragment(html))
  return result
}

function layoutTargets(
  source: ReadonlyMap<string, LayoutTarget>,
  target: ReadonlyMap<string, LayoutTarget>,
): Map<string, LayoutTarget> {
  const byKey = new Map<string, LayoutTarget[]>()
  for (const [id, node] of target) {
    const key = layoutKey(id)
    byKey.set(key, [...(byKey.get(key) ?? []), node])
  }
  const result = new Map<string, LayoutTarget>()
  for (const [id, node] of source) {
    const matches = byKey.get(layoutKey(id)) ?? []
    const match = target.get(id) ?? (matches.length === 1 ? matches[0] : undefined)
    if (match) result.set(node.selector, { ...match, text: node.text || match.text })
  }
  return result
}

/** One forward edit, shared by both languages and schemes; never an adoption-time alignment. */
export function syncPageLayout(
  before: CmsPage,
  edited: CmsPage,
  lang: CmsLang,
  mode: CmsMode,
): CmsPage {
  const baseline = isSitePage(before)
    ? normalizeSitePageContent(before.content[lang], `${before.id}-${lang}`)
    : before.content[lang]
  const previous = declarations(baseline.css[mode])
  const next = declarations(edited.content[lang].css[mode])
  // The canvas's legacy breakpoint repair is not an owner edit. With no geometry delta,
  // leave every other stored sheet untouched.
  const changes = layoutChanges(previous, next)
  if (!changes.size) return edited
  const otherLang = lang === 'sv' ? 'en' : 'sv'
  const otherMode = mode === 'light' ? 'dark' : 'light'
  const elements = (language: CmsLang): Map<string, LayoutTarget> => {
    const variant = edited.content[language]
    return layoutElements(
      isSitePage(edited)
        ? normalizeSitePageContent(variant, `${edited.id}-${language}`).html
        : variant.html,
    )
  }
  const source = elements(lang)
  const self = new Map([...source.values()].map((node) => [node.selector, node]))
  const targets = layoutTargets(source, elements(otherLang))
  const content = { ...edited.content }
  content[lang] = {
    ...content[lang],
    css: {
      ...content[lang].css,
      [mode]: applyLayout(changes, content[lang].css[mode], self, next),
      [otherMode]: applyLayout(changes, content[lang].css[otherMode], self),
    },
  }
  content[otherLang] = {
    ...content[otherLang],
    css: {
      light: applyLayout(changes, content[otherLang].css.light, targets),
      dark: applyLayout(changes, content[otherLang].css.dark, targets),
    },
  }
  return { ...edited, content }
}
