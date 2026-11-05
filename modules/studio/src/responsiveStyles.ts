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
import type { CmsLang, CmsMode, CmsPage } from '@bladeblend/content-contracts/cms'
import { isSitePage, normalizeSitePageContent } from '@bladeblend/content-contracts/site-page'
import { isLegacyDesktopMedia } from '@bladeblend/content-contracts/cms-device-css'
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
function layoutMedia(node: Atrule): string {
  if (ident.decode(node.name).toLowerCase() !== 'media' || !node.prelude) return ''
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
  /** How many siblings share this header in the sheet the path came from. */
  readonly count: number
}
interface LayoutContext {
  readonly header: string
  readonly position: number
  readonly occurrence?: number
  /** A rule that holds nested rules, numbered among the same-header rules that do. */
  readonly nested?: { readonly occurrence: number; readonly count: number }
  /** Such a rule, numbered per geometry property it declares among the same-header rules that
   * declare that property. */
  readonly declaring?: ReadonlyMap<string, { readonly occurrence: number; readonly count: number }>
  /** The rule a guard is nested in, numbered among the same-header rules that declare the
   * guarded property. */
  readonly declared?: {
    readonly property: string
    readonly occurrence: number
    readonly count: number
  }
  readonly preceding?: LayoutSibling
  readonly following?: LayoutSibling
}
interface LayoutLocation {
  readonly selector: string
  /** The rules and at-rules around the rule, outermost first. A plain rule sits in at-rules only. */
  readonly conditions: LayoutContext[]
  readonly path?: LayoutContext[]
}
interface LayoutDeclaration {
  readonly location: LayoutLocation
  readonly declaration: Declaration
  /** Source order among the sheet's geometry declarations. */
  readonly order: number
}
interface LayoutChange {
  readonly location: LayoutLocation
  readonly values: Map<string, CssNode | null>
  readonly guardLast: Set<string>
  /** Per changed property, the conditions of the plain rules for the same element that declare
   * it after the change in the edited sheet. */
  readonly later: Map<string, Set<string>>
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

/** At-rules around a plain rule compare by header, and a layer also by its order among the
 * same-header layers. */
const conditionKeys = (conditions: readonly LayoutContext[]): string[] =>
  conditions.map(({ header, occurrence }) => JSON.stringify([header, occurrence ?? null]))

function locationKey(location: LayoutLocation): string {
  // Ancestor occurrences distinguish authored scopes. A terminal target guard can be
  // split across equivalent rules; its occurrence and positions only guide insertion.
  return JSON.stringify([
    location.selector,
    location.path?.map(({ header, occurrence }, index, path) => [
      header,
      index === path.length - 1 ? null : (occurrence ?? null),
    ]) ?? conditionKeys(location.conditions),
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

/** The geometry properties that guards nested in a component rule write. */
function guardedProperties(nested: CssNode, selector: string): string[] {
  const properties: string[] = []
  walk(nested, {
    visit: 'Rule',
    enter(rule) {
      if (anchoredSelector(rule.prelude) !== selector) return
      rule.block.children.forEach((declaration) => {
        if (declaration.type === 'Declaration' && isGeometry(declaration.property))
          properties.push(declaration.property)
      })
    },
  })
  return properties
}

/** One property in the media scope `keepGuardsLast` compares. A guard's own media is not its
 * owner's scope, so a guard path counts only the conditions around its first rule. */
function guardKey({ path, conditions, selector }: LayoutLocation, property: string): string {
  const owner = path?.findIndex(({ header }) => !header.startsWith('@'))
  const scope = (path ? path.slice(0, owner) : conditions)
    .map(({ header }) => `${header}{`)
    .join('')
  return `${scope}${selector}{${property}`
}

function isLayerOrder(node: Rule | Atrule): boolean {
  return (
    node.type === 'Atrule' &&
    ident.decode(node.name).toLowerCase() === 'layer' &&
    Boolean(node.prelude) &&
    (!node.block || node.block.children.isEmpty)
  )
}

function nests(node: Rule | Atrule): boolean {
  return (
    node.type === 'Rule' &&
    node.block.children.some((child) => child.type === 'Rule' || child.type === 'Atrule')
  )
}

function declares(node: Rule | Atrule, property: string): boolean {
  return (
    node.type === 'Rule' &&
    node.block.children.some((child) => child.type === 'Declaration' && child.property === property)
  )
}

/** A guard's location, with the rule it is nested in numbered by the property it writes. */
function declaredBy(location: LayoutLocation, property: string): LayoutLocation {
  const { path } = location
  const host = path ? path.slice(0, -1).findLastIndex(({ nested }) => nested) : -1
  const declared = path?.[host]?.declaring?.get(property)
  if (!path || !declared) return location
  return {
    ...location,
    path: path.map((context, index) =>
      index === host ? { ...context, declared: { property, ...declared } } : context,
    ),
  }
}

function declarations(css: string): Declarations {
  const result: Declarations = new Map()
  let order = 0
  const visit = (block: LayoutBlock, path: LayoutContext[]): void => {
    const occurrences = new Map<string, number>()
    const nestings = new Map<string, number>()
    const siblings: {
      node: Rule | Atrule
      header: string
      occurrence: number
      nesting?: number
      preceding?: LayoutSibling
      following?: LayoutSibling
    }[] = []
    block.children.forEach((node) => {
      if (node.type !== 'Rule' && node.type !== 'Atrule') return
      const header = contextHeader(node)
      const occurrence = occurrences.get(header) ?? 0
      if (!isLayerOrder(node)) occurrences.set(header, occurrence + 1)
      const nesting = nests(node) ? (nestings.get(header) ?? 0) : undefined
      if (nesting !== undefined) nestings.set(header, nesting + 1)
      siblings.push({ node, header, occurrence, ...(nesting === undefined ? {} : { nesting }) })
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
            ? {
                header: previous.header,
                occurrence: previous.occurrence,
                count: occurrences.get(previous.header) ?? 0,
              }
            : undefined
        if (boundary) sibling[direction] = boundary
        previous = sibling
      }
    }
    siblings.forEach(({ node, header, occurrence, nesting, preceding, following }, position) => {
      const ordered =
        !isLayerOrder(node) &&
        (node.type === 'Rule' || ident.decode(node.name).toLowerCase() === 'layer')
      const declaring =
        nesting === undefined || node.type !== 'Rule'
          ? undefined
          : new Map(
              node.block.children.toArray().flatMap((child) => {
                if (child.type !== 'Declaration' || !isGeometry(child.property)) return []
                const same = siblings.filter(
                  (sibling) => sibling.header === header && declares(sibling.node, child.property),
                )
                const occurrence = same.findIndex((sibling) => sibling.node === node)
                return [[child.property, { occurrence, count: same.length }] as const]
              }),
            )
      const context: LayoutContext = {
        header,
        position,
        ...(ordered ? { occurrence } : {}),
        ...(nesting === undefined
          ? {}
          : { nested: { occurrence: nesting, count: nestings.get(header) ?? 0 } }),
        ...(declaring ? { declaring } : {}),
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
            conditions: path,
            ...(anchored ? { path: nextPath } : {}),
          }
          const key = locationKey(location)
          const values = result.get(key) ?? new Map<string, LayoutDeclaration>()
          node.block.children.forEach((declaration) => {
            if (declaration.type !== 'Declaration' || !isGeometry(declaration.property)) return
            const previous = values.get(declaration.property)?.declaration
            // Within this selector/context, important beats normal; ties retain source order.
            if (previous?.important && !declaration.important) return
            values.set(declaration.property, {
              declaration,
              location: declaredBy(location, declaration.property),
              order: order++,
            })
          })
          result.set(key, values)
        }
        visit(node.block, nextPath)
      } else if (node.block) visit(node.block, nextPath)
    })
  }
  const tree = parse(css)
  if (tree.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
  visit(tree, [])
  return result
}

const textHeight = new Map([
  ['height', parse('height:auto!important', { context: 'declaration' })],
  ['max-height', parse('max-height:none!important', { context: 'declaration' })],
])

/** The conditions of the plain rules for the same element that declare `property` after `edited`
 * in the edited sheet. */
function laterConditions(
  next: Declarations,
  edited: LayoutDeclaration,
  property: string,
): Set<string> {
  const later = new Set<string>()
  for (const values of next.values()) {
    const other = values.get(property)
    if (
      other &&
      !other.location.path &&
      other.location.selector === edited.location.selector &&
      other.order > edited.order
    )
      later.add(JSON.stringify(conditionKeys(other.location.conditions)))
  }
  return later
}

function layoutChanges(
  previous: Declarations,
  next: Declarations,
  guardLast: ReadonlySet<string>,
): LayoutChanges {
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
        guardLast: new Set<string>(),
        later: new Map<string, Set<string>>(),
      }
      changed.values.set(property, newValue?.declaration ?? null)
      if (guardLast.has(guardKey(location, property))) changed.guardLast.add(property)
      if (newValue && !location.path)
        changed.later.set(property, laterConditions(next, newValue, property))
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
  const same = siblings.filter(
    (node) => !isLayerOrder(node) && contextHeader(node) === sibling.header,
  )
  // Only the other sheets drop the rules a sync emptied, which renumbers the siblings after them.
  // Where a sheet holds fewer under the header than the path's sheet, an occurrence may name
  // another sibling, so it bounds nothing. A sync appends after every earlier sibling.
  const match = same.length < sibling.count ? undefined : same[sibling.occurrence]
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
  // Only the other sheets drop the rules a sync emptied, so their occurrences can shift. Rules
  // that nest keep their order: a sheet drops one only when the edited sheet's copy stopped
  // nesting too. While a sheet holds as many under the header as the path's sheet, that order
  // names the rule. Otherwise, as when the rule gains its first guard in this sync, the rule a
  // guard is nested in keeps its order among the rules that declare the property it writes.
  const nesting = context.nested && matches.filter(nests)
  const { declared } = context
  const declaring = declared && matches.filter((node) => declares(node, declared.property))
  const match =
    context.nested && nesting?.length === context.nested.count
      ? nesting[context.nested.occurrence]
      : declared && declaring?.length === declared.count
        ? declaring[declared.occurrence]
        : matches[context.occurrence]
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

/** Every component rule, with its properties keyed by the media conditions around the rule. Only
 * rules under identical conditions compare. Any other at-rule resets the scope and marks the rules
 * inside it conditional: they can have the last word, but nothing moves into or out of them. */
function eachComponentRule(
  block: LayoutBlock,
  visit: (
    rule: Rule,
    selector: string,
    key: (property: string) => string,
    conditional: boolean,
  ) => void,
  scope = '',
  conditional = false,
): void {
  block.children.forEach((node) => {
    if (node.type === 'Atrule') {
      if (!node.block) return
      const media = ident.decode(node.name).toLowerCase() === 'media'
      // A rule inside any other at-rule competes for the last word on the unconditional key.
      const nested = media ? `${scope}${contextHeader(node)}{` : ''
      eachComponentRule(node.block, visit, nested, conditional || !media)
      return
    }
    if (node.type !== 'Rule') return
    const selector = layoutSelector(node.prelude)
    if (selector)
      visit(node, selector, (property) => `${scope}${selector}{${property}`, conditional)
  })
}

/** The keys whose last word in a sheet is a guard: a nested guard takes the key, and a declaration
 * of the component rule takes it back. */
function guardLastKeys(css: string): Set<string> {
  const tree = parse(css)
  if (tree.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
  const keys = new Set<string>()
  eachComponentRule(tree, ({ block }, selector, key) => {
    block.children.forEach((child) => {
      if (child.type === 'Declaration') keys.delete(key(child.property))
      else for (const property of guardedProperties(child, selector)) keys.add(key(property))
    })
  })
  return keys
}

/** A guard nested in its component's own rule ties with that rule's declarations, so source
 * order alone decides. A sync can deliver either side first, even in one edit, so a declaration
 * behind the last guard for a key in `moved` goes directly ahead of that guard. A declaration
 * between two guards stays, because the last guard already follows it. `moved` holds a key only
 * when the edit changed that property or its guard and a guard has the last word on the key in the
 * edited sheet. Only unconditional rules under identical media conditions compare, so a move never
 * changes when the declaration applies. */
function keepGuardsLast(
  tree: StyleSheet,
  moved: ReadonlySet<string>,
  shrunk: Set<List<CssNode>>,
): void {
  const guards = new Map<string, { children: List<CssNode>; item: ListItem<CssNode> }>()
  eachComponentRule(tree, ({ block: { children } }, selector, key, conditional) => {
    if (conditional) return
    children.forEach((child, item) => {
      if (child.type === 'Declaration') return
      for (const property of guardedProperties(child, selector))
        guards.set(key(property), { children, item })
    })
  })
  const passed = new Set<string>()
  eachComponentRule(tree, ({ block: { children } }, selector, key, conditional) => {
    if (conditional) return
    children.forEach((child, item) => {
      if (child.type === 'Declaration') {
        const guard = guards.get(key(child.property))
        if (!guard || !moved.has(key(child.property)) || !passed.has(key(child.property))) return
        children.remove(item)
        shrunk.add(children)
        guard.children.insertData(child, guard.item)
        return
      }
      for (const property of guardedProperties(child, selector))
        if (guards.get(key(property))?.item === item) passed.add(key(property))
    })
  })
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

interface PlainRule {
  readonly rule: Rule
  readonly selector: string
  readonly conditions: LayoutContext[]
  /** From the sheet down to the rule: each block, with the item in it that holds the rule. */
  readonly items: readonly { readonly block: LayoutBlock; readonly item: ListItem<CssNode> }[]
}

/** Every plain component rule in source order, also one a layer inside another rule holds, with
 * its conditions numbered as `declarations()` numbers them. */
function plainRules(
  block: LayoutBlock,
  conditions: LayoutContext[] = [],
  items: PlainRule['items'] = [],
): PlainRule[] {
  const rules: PlainRule[] = []
  const occurrences = new Map<string, number>()
  let position = 0
  block.children.forEach((node, item) => {
    if (node.type !== 'Rule' && node.type !== 'Atrule') return
    const header = contextHeader(node)
    const occurrence = occurrences.get(header) ?? 0
    if (!isLayerOrder(node)) occurrences.set(header, occurrence + 1)
    const index = position++
    const here = [...items, { block, item }]
    if (node.type === 'Rule') {
      const selector = layoutSelector(node.prelude)
      if (selector) rules.push({ rule: node, selector, conditions, items: here })
    }
    if (!node.block) return
    const ordered =
      !isLayerOrder(node) &&
      (node.type === 'Rule' || ident.decode(node.name).toLowerCase() === 'layer')
    const context = { header, position: index, ...(ordered ? { occurrence } : {}) }
    rules.push(...plainRules(node.block, [...conditions, context], here))
  })
  return rules
}

/** A changed plain rule goes back ahead of the first rule for the same element that the edited
 * sheet holds after it, in the deepest block whose conditions both share. Otherwise it goes last
 * in its layer, or in the sheet. It never leaves its layer block, because a new anonymous layer
 * block would be another layer. */
function insertPlain(tree: StyleSheet, change: LayoutChange): void {
  const { location, values, later } = change
  const body = [...values.values()]
    .filter((v): v is CssNode => v !== null)
    .map((v) => generate(v))
    .join(';')
  if (!body) return
  const keys = conditionKeys(location.conditions)
  const shared = (conditions: LayoutContext[]): number => {
    const index = conditionKeys(conditions).findIndex((key, depth) => key !== keys[depth])
    return index < 0 ? conditions.length : index
  }
  const layer =
    location.conditions.findLastIndex(({ header }) => /^@layer(?:\s|$)/.test(header)) + 1
  const anchor = plainRules(tree).find(
    ({ rule, selector, conditions }) =>
      selector === location.selector &&
      shared(conditions) >= layer &&
      rule.block.children.some(
        (child) =>
          child.type === 'Declaration' &&
          Boolean(later.get(child.property)?.has(JSON.stringify(conditionKeys(conditions)))),
      ),
  )
  const depth = anchor ? shared(anchor.conditions) : layer
  const added = parse(
    location.conditions
      .slice(depth)
      .reduceRight((rule, { header }) => `${header}{${rule}}`, `${location.selector}{${body}}`),
  )
  if (added.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
  const at = anchor?.items[depth]
  if (at) at.block.children.insertList(added.children, at.item)
  else if (!layer) tree.children.appendList(added.children)
  else {
    const scope = location.conditions.slice(0, layer)
    const block = contextBlocks(tree, scope).at(-1) ?? ensureContext(tree, scope)
    block.children.appendList(added.children)
  }
}

/** Apply one delta to a theme or language. `source` only corrects clipping in the edited sheet. */
function applyLayout(
  changes: LayoutChanges,
  other: string,
  targets?: ReadonlyMap<string, LayoutTarget>,
  source?: Declarations,
): string {
  const mapped: LayoutChanges = new Map()
  for (const { location, values, guardLast, later } of changes.values()) {
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
      conditions: location.conditions.map((context) => mapContext(context, targets)),
      ...(location.path
        ? { path: location.path.map((context) => mapContext(context, targets)) }
        : {}),
    }
    if (changed.size)
      mapped.set(placementKey(next), { location: next, values: changed, guardLast, later })
  }
  if (!mapped.size) return other
  const tree = parse(other)
  if (tree.type !== 'StyleSheet') throw new Error('Sidans layout saknar sitt CSS-träd.')
  const shrunk = new Set<List<CssNode>>()
  // A plain change replaces the property only under the conditions of the edited rule.
  for (const { rule, selector, conditions } of plainRules(tree)) {
    const changed = mapped.get(placementKey({ selector, conditions }))
    if (!changed || changed.location.path) continue
    rule.block.children.forEach((declaration, item) => {
      if (declaration.type === 'Declaration' && changed.values.has(declaration.property)) {
        rule.block.children.remove(item)
        shrunk.add(rule.block.children)
      }
    })
  }
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
  for (const change of mapped.values()) if (!change.location.path) insertPlain(tree, change)
  const moved = new Set<string>()
  for (const { location, values, guardLast } of mapped.values())
    for (const property of values.keys())
      if (guardLast.has(property)) moved.add(guardKey(location, property))
  keepGuardsLast(tree, moved, shrunk)
  dropEmptied(tree, shrunk)
  return generate(tree)
}

/** Copy only changed geometry, preserving independent colors and untouched layout drift. */
export function syncLayout(before: string, after: string, other: string): string {
  return applyLayout(
    layoutChanges(declarations(before), declarations(after), guardLastKeys(after)),
    other,
  )
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
  const changes = layoutChanges(previous, next, guardLastKeys(edited.content[lang].css[mode]))
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
