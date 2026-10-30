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

interface LayoutContext {
  readonly header: string
  readonly position: number
  readonly occurrence?: number
}
interface LayoutLocation {
  readonly selector: string
  readonly media: string
  readonly path?: LayoutContext[]
}
interface LayoutEntry {
  readonly location: LayoutLocation
  readonly values: Map<string, CssNode>
}
interface LayoutChange {
  readonly location: LayoutLocation
  readonly values: Map<string, CssNode | null>
}
type Declarations = Map<string, LayoutEntry>
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
  // Positions guide insertion into a counterpart. They are not geometry changes themselves.
  return JSON.stringify([
    location.selector,
    location.path?.map(({ header, occurrence }) => [header, occurrence ?? null]) ?? location.media,
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
    let position = 0
    block.children.forEach((node) => {
      if (node.type !== 'Rule' && node.type !== 'Atrule') return
      const header = contextHeader(node)
      const ordered =
        !isLayerOrder(node) &&
        (node.type === 'Rule' || ident.decode(node.name).toLowerCase() === 'layer')
      const occurrence = occurrences.get(header) ?? 0
      if (ordered) occurrences.set(header, occurrence + 1)
      const context: LayoutContext = {
        header,
        position: position++,
        ...(ordered ? { occurrence } : {}),
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
          const values = result.get(key)?.values ?? new Map<string, CssNode>()
          node.block.children.forEach((declaration) => {
            if (declaration.type === 'Declaration' && isGeometry(declaration.property))
              values.set(declaration.property, declaration)
          })
          result.set(key, { location, values })
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
    const before = previous.get(key)
    const after = next.get(key)
    const a = before?.values ?? new Map()
    const b = after?.values ?? new Map()
    const changed = new Map<string, CssNode | null>()
    for (const property of new Set([...a.keys(), ...b.keys()])) {
      const oldValue = a.get(property)
      const newValue = b.get(property)
      if ((oldValue && generate(oldValue)) !== (newValue && generate(newValue)))
        changed.set(property, newValue ?? null)
    }
    const location = after?.location ?? before?.location
    if (changed.size && location) changes.set(key, { location, values: changed })
  }
  return changes
}

function mapContext(
  context: LayoutContext,
  targets?: ReadonlyMap<string, LayoutTarget>,
): LayoutContext {
  if (!targets || context.header.startsWith('@')) return context
  const selector = parse(context.header, { context: 'selectorList' })
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
  return { ...context, header: generate(selector) }
}

function matchingContexts(block: LayoutBlock, context: LayoutContext): (Rule | Atrule)[] {
  const matches = block.children
    .toArray()
    .filter(
      (node): node is Rule | Atrule =>
        (node.type === 'Rule' || node.type === 'Atrule') &&
        Boolean(node.block) &&
        !isLayerOrder(node) &&
        contextHeader(node) === context.header,
    )
  if (context.occurrence === undefined) return matches
  const match = matches[context.occurrence]
  return match ? [match] : []
}

function contextBlocks(block: LayoutBlock, path: LayoutContext[]): Block[] {
  const [context, ...remaining] = path
  if (!context) return block.type === 'Block' ? [block] : []
  return matchingContexts(block, context).flatMap((node) =>
    node.block ? (remaining.length ? contextBlocks(node.block, remaining) : [node.block]) : [],
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
  const before = children.filter((child) => child.type === 'Rule' || child.type === 'Atrule')[
    context.position
  ]
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

/** Apply one delta to a theme or language. `source` only corrects clipping in the edited sheet. */
function applyLayout(
  changes: LayoutChanges,
  other: string,
  targets?: ReadonlyMap<string, LayoutTarget>,
  source?: Declarations,
): string {
  const mapped: LayoutChanges = new Map()
  for (const [key, { location, values }] of changes) {
    const target = targets?.get(location.selector)
    if (targets && !target && location.selector !== 'html body') continue
    const changed = source ? new Map<string, CssNode | null>() : new Map(values)
    if (target?.text && [...values.values()].some((value) => value !== null)) {
      for (const [property, value] of textHeight) {
        const present = source?.get(key)?.values.get(property)
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
    if (changed.size) mapped.set(locationKey(next), { location: next, values: changed })
  }
  if (!mapped.size) return other
  const tree = parse(other)
  if (tree.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      const changed = mapped.get(
        JSON.stringify([layoutSelector(rule.prelude), layoutMedia(this.atrule)]),
      )
      if (!changed || changed.location.path) return
      rule.block.children.forEach((declaration, item) => {
        if (declaration.type === 'Declaration' && changed.values.has(declaration.property))
          rule.block.children.remove(item)
      })
    },
  })
  for (const { location, values } of mapped.values()) {
    if (!location.path) continue
    const blocks = contextBlocks(tree, location.path)
    for (const block of blocks)
      block.children.forEach((declaration, item) => {
        if (declaration.type === 'Declaration' && values.has(declaration.property))
          block.children.remove(item)
      })
    const additions = [...values.values()].filter((value): value is CssNode => value !== null)
    if (additions.length) {
      const block = blocks.at(-1) ?? ensureContext(tree, location.path)
      for (const addition of additions) block.children.appendData(clone(addition))
    }
  }
  let result = generate(tree)
  for (const { location, values } of mapped.values()) {
    if (location.path) continue
    const body = [...values.values()]
      .filter((v): v is CssNode => v !== null)
      .map((v) => generate(v))
      .join(';')
    if (body)
      result += location.media
        ? `@media ${location.media}{${location.selector}{${body}}}`
        : `${location.selector}{${body}}`
  }
  return result
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
