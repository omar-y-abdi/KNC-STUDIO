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
  type Rule,
  type Selector,
  type StyleSheet,
} from 'css-tree'
import type { Component, CssRule, Editor, StyleProps } from 'grapesjs'
import type { CmsMode } from '../../../shared/cms'
import {
  normalizeNativeOwnerRules,
  parseCanvasCss,
  parseCanvasSheet,
  readCanvasRuleCss,
  renderCanvasCss,
} from './nativeCanvas'

interface CardGeometry {
  width: string
  zoom: number
  horizontalInset: number
  horizontalMargin: number
  stretch: boolean
}

/** Zoom scales fixed lengths. Percentages resolve against the unzoomed containing block,
 * so scale their coefficients too, including on subsequent edits of the generated calc(). */
export function desktopMarqueeCardStyle(
  style: StyleProps,
  scale: number,
  geometry: CardGeometry,
): StyleProps {
  const factor = scale / geometry.zoom
  const sourceWidth = geometry.width.replace(/\s*!important\s*$/i, '').trim()
  const important = /!important\s*$/i.test(geometry.width) ? '!important' : ''
  let width: string | undefined
  if (sourceWidth && sourceWidth !== 'auto') {
    const value = parse(sourceWidth, { context: 'value' })
    let changed = false
    walk(value, {
      visit: 'Percentage',
      enter(node) {
        node.value = String(Number((Number(node.value) * factor).toFixed(6)))
        changed = true
      },
    })
    width = changed ? `${generate(value)}${important}` : geometry.width
  } else if (geometry.stretch) {
    const percent = `${Number((factor * 100).toFixed(6))}%`
    const inset = geometry.horizontalInset + geometry.horizontalMargin
    width = `${inset ? `calc(${percent} - ${Number(inset.toFixed(6))}px)` : percent}${important}`
  }
  return { ...style, ...(width === undefined ? {} : { width }), zoom: String(scale) }
}

type Scope = Rule | Atrule
interface Root {
  model: CssRule
  element: HTMLElement
  tree: StyleSheet
  normalized: boolean
}
interface Source {
  root: Root
  scopes: Scope[]
  declaration: Declaration
}
interface Sample extends CardGeometry {
  component: Component
  widthSource?: Source
  zoomSource?: Source
  widthBranch: number
  zoomBranch: number
}

export interface ResizeBaseline {
  target: CssRule
  style: StyleProps
  mode?: CmsMode
  measurement?: { component: Component; axis: 'width' | 'height'; requested: number }
}

const prefix = '--cms-internal-resize-'
const probes = {
  horizontal: ['raw-h', 'width-h', 'source-h', 'fallback-h'],
  vertical: ['raw-v', 'width-v', 'source-v', 'fallback-v'],
  zoom: ['zoom', 'zoom-source', 'zoom-fallback'],
  branches: ['width-branch', 'zoom-branch'],
} as const
const name = (suffix: string): string => prefix + suffix
const keyword = (value: string): string => ident.decode(value.trim()).toLowerCase()
const cssWide = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer'])
const typedWidth =
  '<length-percentage> | auto | min-content | max-content | fit-content | stretch | contain'

function declaration(
  property: string,
  value: string,
  important: Declaration['important'] = false,
): Declaration {
  const result = parse(`${property}:${value}${important ? '!important' : ''}`, {
    context: 'declaration',
    parseCustomProperty: true,
  })
  if (result.type !== 'Declaration') throw new Error('En storleksregel kunde inte förberedas.')
  return result
}

function anchor(branch: Selector, id: string): Selector {
  const result = clone(branch)
  const target = parse(`:where(#${ident.encode(id)})`, { context: 'selector' })
  if (result.type !== 'Selector' || target.type !== 'Selector')
    throw new Error('Komponenten saknar ett giltigt storleksmål.')
  result.children.appendList(target.children)
  return result
}

function targetRule(selector: string, declarations: Declaration[]): Rule {
  const result = parse(`${selector}{}`, { context: 'rule' })
  if (result.type !== 'Rule') throw new Error('En storleksselektor kunde inte förberedas.')
  result.block.children = new List<CssNode>().fromArray(declarations)
  return result
}

function scopedBranch(source: Source, branch: number, id: string): string {
  const owner = source.scopes.at(-1)
  if (owner?.type !== 'Rule') return `&:where(#${ident.encode(id)})`
  if (owner.prelude.type !== 'SelectorList')
    throw new Error('En storleksselektor kunde inte läsas.')
  const selector = owner.prelude.children.toArray()[branch]
  if (selector?.type !== 'Selector') throw new Error('En matchande storleksselektor saknas.')
  return generate(anchor(selector, id))
}

function branchProbe(source: Source, component: Component, property: string): string {
  const owner = source.scopes.at(-1)
  if (owner?.type !== 'Rule' || owner.prelude.type !== 'SelectorList') return ''
  let body = owner.prelude.children
    .toArray()
    .map((branch, index) => {
      if (branch.type !== 'Selector') throw new Error('En storleksselektor kunde inte läsas.')
      return `${generate(anchor(branch, component.getId()))}{${property}:b${index}!important}`
    })
    .join('')
  // Keep every ancestor selector and condition. Only the source rule's list is split;
  // the browser chooses the matching branch with the winning specificity.
  for (const scope of source.scopes.slice(0, -1).reverse()) {
    const wrapper = clone(scope)
    if (wrapper.type !== 'Rule' && wrapper.type !== 'Atrule')
      throw new Error('Ett storleksvillkor saknar sin CSS-källa.')
    if (!wrapper.block) throw new Error('Ett storleksvillkor saknar sitt CSS-block.')
    wrapper.block.children = parseCanvasSheet(body).children
    body = generate(wrapper)
  }
  return body
}

function readSamples(
  editor: Editor,
  components: Component[],
  baseline?: ResizeBaseline,
): { samples: Sample[]; normalizedRoots: Root[]; dimension?: number } {
  const doc = editor.Canvas.getDocument()
  const view = doc?.defaultView
  if (!doc?.body || !view) throw new Error('Redigeringsytan är inte redo att ändra storlek.')
  const elements = components.map((component) => {
    const element = component.getEl()
    if (!element) throw new Error('Komponenten saknar sin redigeringsyta.')
    return element
  })
  if (
    !baseline?.mode &&
    elements.some(
      (element) =>
        element.hasAttribute('data-knc-baseline') && element.closest('[data-knc-native="1"]'),
    )
  )
    throw new Error('Sidans färgläge saknas för storleksändringen.')
  const roots: Root[] = editor.Css.getAll()
    .models.filter((model) => !model.isNested() && Object.keys(model.get('style') ?? {}).length)
    .map((model) => {
      const element = model.getView()?.el
      if (!element || element.nodeName !== 'STYLE')
        throw new Error('En storleksregel saknar sin redigeringsvy.')
      const tree = parseCanvasSheet(
        readCanvasRuleCss(model, model === baseline?.target ? baseline.style : undefined),
      )
      return { model, element, tree, normalized: false }
    })
  if (baseline?.mode) {
    const before = roots.map((root) => generate(root.tree))
    // One originals map and declaration pass covers every root, including inactive
    // owner contexts. The list references each root's nodes without moving them.
    normalizeNativeOwnerRules(
      {
        type: 'StyleSheet',
        children: new List<CssNode>().fromArray(
          roots.flatMap((root) => root.tree.children.toArray()),
        ),
      },
      elements,
      baseline.mode,
    )
    roots.forEach((root, index) => {
      root.normalized = before[index] !== generate(root.tree)
    })
  }
  const sources = new Map<string, Source>()
  const restore: { element: HTMLElement; css: string | null }[] = []
  const temporary = doc.createElement('style')
  const register = (suffix: string, syntax: string, initial: string): string =>
    `@property ${name(suffix)}{syntax:"${syntax}";inherits:false;initial-value:${initial}}`
  const registration =
    [...probes.horizontal, ...probes.vertical]
      .map((suffix, index) =>
        register(suffix, index % 4 === 1 ? typedWidth : '*', index % 4 < 2 ? 'auto' : 'none'),
      )
      .join('') +
    probes.zoom
      .map((suffix, index) =>
        register(
          suffix,
          index === 0 ? '<number> | <percentage> | normal' : '*',
          index === 0 ? '1' : 'none',
        ),
      )
      .join('') +
    probes.branches.map((suffix) => register(suffix, '*', 'none')).join('')
  temporary.textContent = registration
  const instrument = (node: CssNode, original: CssNode, root: Root, scopes: Scope[]): void => {
    if (node.type === 'Rule' || node.type === 'Atrule') {
      // Frames are animation data, not element selectors. Normal dimension edits
      // leave active owner animations authoritative and edit only their underlying rules.
      if (node.type === 'Atrule' && ['keyframes', '-webkit-keyframes'].includes(keyword(node.name)))
        return
      if (original.type !== 'Rule' && original.type !== 'Atrule')
        throw new Error('Storleksregelns källträd ändrades.')
      scopes = [...scopes, original]
      if (!node.block || !original.block) return
      const entries = original.block.children.toArray()
      const augmented: CssNode[] = []
      node.block.children.toArray().forEach((child, index) => {
        const sourceNode = entries[index]
        if (!sourceNode) throw new Error('Storleksregelns källa saknas.')
        augmented.push(child)
        if (child.type !== 'Declaration' || sourceNode.type !== 'Declaration') {
          instrument(child, sourceNode, root, scopes)
          return
        }
        const property = keyword(child.property)
        const value = generate(child.value)
        // Invalid declarations are ignored by the real property, not by an unconstrained
        // custom property. A var() can still become invalid at computed-value time below.
        const horizontal = ['width', 'inline-size', '-webkit-logical-width', 'all'].includes(
          property,
        )
        const vertical = ['width', 'block-size', '-webkit-logical-height', 'all'].includes(property)
        const zoom = property === 'zoom' || property === 'all'
        if (!horizontal && !vertical && !zoom) return
        if (!view.CSS.supports(property, value)) return
        const key = `r${sources.size}`
        sources.set(key, { root, scopes, declaration: sourceNode })
        const reset = ['revert', 'revert-layer'].includes(keyword(value)) ? value : key
        const extras: CssNode[] = []
        for (const axis of [
          horizontal ? probes.horizontal : null,
          vertical ? probes.vertical : null,
        ])
          if (axis)
            extras.push(
              declaration(name(axis[0]), value, child.important),
              declaration(name(axis[1]), value, child.important),
              declaration(name(axis[2]), reset, child.important),
              declaration(name(axis[3]), key, child.important),
            )
        if (zoom)
          extras.push(
            declaration(name(probes.zoom[0]), value, child.important),
            declaration(name(probes.zoom[1]), reset, child.important),
            declaration(name(probes.zoom[2]), key, child.important),
          )
        augmented.push(...extras)
      })
      node.block.children = new List<CssNode>().fromArray(augmented)
    } else if (node.type === 'StyleSheet' && original.type === 'StyleSheet') {
      const entries = original.children.toArray()
      node.children.toArray().forEach((child, index) => {
        const sourceNode = entries[index]
        if (sourceNode) instrument(child, sourceNode, root, scopes)
      })
    }
  }
  try {
    // Branch probes must not declare a named layer before the owner's first declaration.
    doc.body.appendChild(temporary)
    for (const root of roots) {
      const tree = clone(root.tree)
      const count = sources.size
      instrument(tree, root.tree, root, [])
      if (sources.size === count && !root.normalized && root.model !== baseline?.target) continue
      restore.push({ element: root.element, css: root.element.textContent })
      root.element.textContent = renderCanvasCss(editor, generate(tree))
    }
    const samples: Sample[] = components.map((component) => {
      const element = component.getEl()
      if (!element) throw new Error('Komponenten saknar sin redigeringsyta.')
      const computed = view.getComputedStyle(element)
      const axis = computed.writingMode.startsWith('horizontal')
        ? probes.horizontal
        : probes.vertical
      const widthKey = computed.getPropertyValue(name(axis[2])).trim()
      const widthSource =
        sources.get(widthKey) ?? sources.get(computed.getPropertyValue(name(axis[3])).trim())
      const zoomSource =
        sources.get(computed.getPropertyValue(name(probes.zoom[1])).trim()) ??
        sources.get(computed.getPropertyValue(name(probes.zoom[2])).trim())
      const zoom = computed.getPropertyValue(name(probes.zoom[0])).trim()
      const raw = computed.getPropertyValue(name(axis[0])).trim()
      let width = computed.getPropertyValue(name(axis[1])).trim()
      if (!view.CSS.supports('width', raw)) width = 'auto'
      else if (width === 'auto' && raw !== 'auto' && !cssWide.has(keyword(raw))) width = raw
      if (!width) throw new Error('Webbläsaren kunde inte lösa kortets bredd.')
      const parent = element.parentElement
      const alignment =
        computed.justifySelf === 'auto' && parent
          ? view.getComputedStyle(parent).justifyItems
          : computed.justifySelf
      return {
        component,
        width,
        zoom: (parseFloat(zoom) || 1) / (zoom.endsWith('%') ? 100 : 1),
        horizontalInset:
          computed.boxSizing === 'border-box'
            ? 0
            : [
                computed.paddingLeft,
                computed.paddingRight,
                computed.borderLeftWidth,
                computed.borderRightWidth,
              ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0),
        horizontalMargin:
          (parseFloat(computed.marginLeft) || 0) + (parseFloat(computed.marginRight) || 0),
        stretch: !alignment || alignment === 'normal' || alignment === 'stretch',
        ...(widthSource ? { widthSource } : {}),
        ...(zoomSource ? { zoomSource } : {}),
        widthBranch: 0,
        zoomBranch: 0,
      }
    })
    const branches: string[] = []
    for (const sample of samples)
      for (const [source, suffix] of [
        [sample.widthSource, probes.branches[0]],
        [sample.zoomSource, probes.branches[1]],
      ] as const)
        if (source) branches.push(branchProbe(source, sample.component, name(suffix)))
    temporary.textContent = renderCanvasCss(editor, registration + branches.join(''))
    for (const sample of samples) {
      const element = sample.component.getEl()
      if (!element) throw new Error('Komponenten försvann under storleksmätningen.')
      const computed = view.getComputedStyle(element)
      for (const [source, suffix, axis] of [
        [sample.widthSource, probes.branches[0], 'widthBranch'],
        [sample.zoomSource, probes.branches[1], 'zoomBranch'],
      ] as const) {
        const owner = source?.scopes.at(-1)
        if (owner?.type !== 'Rule') continue
        const result = computed.getPropertyValue(name(suffix)).trim()
        if (!/^b\d+$/.test(result))
          throw new Error('En matchande storleksselektor kunde inte lösas.')
        sample[axis] = Number(result.slice(1))
      }
    }
    const measurement = baseline?.measurement
    const dimension = measurement?.component.getEl()?.getBoundingClientRect()[measurement.axis]
    if (measurement && (!dimension || !Number.isFinite(dimension) || dimension <= 0))
      throw new Error('Komponentens aktuella storlek kunde inte mätas.')
    return {
      samples,
      normalizedRoots: roots.filter((root) => root.normalized),
      ...(dimension === undefined ? {} : { dimension }),
    }
  } finally {
    for (const entry of restore.reverse()) entry.element.textContent = entry.css
    temporary.remove()
  }
}

interface Edit {
  source: Source
  sample: Sample
  branch: number
  declarations: Declaration[]
}

function projectedSource(source: Source, component: Component, property: string): boolean {
  if (keyword(source.declaration.property) !== property) return false
  if (
    !source.scopes.some(
      (scope) =>
        scope.type === 'Atrule' &&
        keyword(scope.name) === 'media' &&
        scope.prelude &&
        generate(scope.prelude).replace(/\s/g, '').toLowerCase() === '(min-width:769px)',
    )
  )
    return false
  const owner = source.scopes.at(-1)
  if (
    owner?.type !== 'Rule' ||
    owner.prelude.type !== 'SelectorList' ||
    owner.prelude.children.size !== 1
  )
    return false
  const branch = owner.prelude.children.first
  if (branch?.type !== 'Selector') return false
  const suffix = branch.children.last
  // Theme and language sync replaces a plain component declaration wherever its counterpart
  // keeps it. A guard could land before that counterpart and lose to the stale value.
  if (property === 'zoom' && branch.children.size === 1 && suffix?.type === 'IdSelector')
    return ident.decode(suffix.name) === component.getId()
  if (suffix?.type !== 'PseudoClassSelector' || keyword(suffix.name) !== 'where') return false
  const targets = suffix.children?.first
  if (targets?.type !== 'SelectorList' || targets.children.size !== 1) return false
  const target = targets.children.first
  if (target?.type !== 'Selector' || target.children.size !== 1) return false
  const id = target.children.first
  return id?.type === 'IdSelector' && ident.decode(id.name) === component.getId()
}

/** Plan all cards first. The probe edits only live style nodes and always restores them;
 * no composer model, undo stack, export or token definition participates in measurement. */
export function planDesktopCardResize(
  editor: Editor,
  components: Component[],
  factor: number,
  baseline?: ResizeBaseline,
): { measurements: CardGeometry[]; apply: () => void } {
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error('Storleksändringen saknar en giltig skala.')
  const { samples, normalizedRoots, dimension } = readSamples(editor, components, baseline)
  if (baseline?.measurement) {
    const zoom =
      samples.find((sample) => sample.component === baseline.measurement?.component)?.zoom ??
      samples[0]?.zoom
    const requested = baseline.measurement.requested
    if (
      dimension === undefined ||
      zoom === undefined ||
      !Number.isFinite(zoom) ||
      zoom <= 0 ||
      !Number.isFinite(requested) ||
      requested <= 0
    )
      throw new Error('Storleksändringen saknar en giltig mätning.')
    factor = Math.max(0.1, Math.min(4, (zoom * requested) / dimension)) / zoom
  }
  const edits = new Map<Declaration, Edit[]>()
  const extra = new Map<string, Record<string, string>>()
  const roots = new Set<Root>(normalizedRoots)
  const add = (
    sample: Sample,
    source: Source | undefined,
    branch: number,
    property: string,
    value: string,
  ): void => {
    const item = declaration(property, value, source?.declaration.important)
    if (!source) {
      const id = sample.component.getId()
      const style = extra.get(id) ?? {}
      style[property] = value
      extra.set(id, style)
      return
    }
    roots.add(source.root)
    if (projectedSource(source, sample.component, property)) {
      source.declaration.value = item.value
      source.declaration.important = item.important
      return
    }
    const entries = edits.get(source.declaration) ?? []
    const existing = entries.find((entry) => entry.sample === sample && entry.branch === branch)
    if (existing) existing.declarations.push(item)
    else entries.push({ source, sample, branch, declarations: [item] })
    edits.set(source.declaration, entries)
  }
  for (const sample of samples) {
    const style = desktopMarqueeCardStyle({}, Number((sample.zoom * factor).toFixed(6)), sample)
    const width = style['width']
    if (typeof width === 'string' && width !== sample.width)
      add(sample, sample.widthSource, sample.widthBranch, 'width', width)
    add(sample, sample.zoomSource, sample.zoomBranch, 'zoom', String(style['zoom']))
  }
  const guards = (entries: Edit[], implicit: boolean): CssNode[] =>
    entries.map((entry) => {
      const selector = implicit
        ? `&:where(#${ident.encode(entry.sample.component.getId())})`
        : scopedBranch(entry.source, entry.branch, entry.sample.component.getId())
      const group = parse('@media(min-width:769px){}', { context: 'atrule' })
      if (group.type !== 'Atrule' || !group.block)
        throw new Error('Desktop-villkoret kunde inte förberedas.')
      group.block.children.appendData(targetRule(selector, entry.declarations))
      return group
    })
  function rewriteRule(node: Rule): CssNode[] {
    if (node.prelude.type !== 'SelectorList') return [node]
    const multiple = node.prelude.children.size > 1
    const replacements: CssNode[] = []
    let segment: CssNode[] = []
    const flush = (): void => {
      if (!segment.length) return
      replacements.push({
        ...node,
        block: { ...node.block, children: new List<CssNode>().fromArray(segment) },
      })
      segment = []
    }
    for (const child of node.block.children.toArray()) {
      if (child.type === 'Rule') segment.push(...rewriteRule(child))
      else {
        if (child.type === 'Atrule' && child.block) rewriteBlock(child.block)
        segment.push(child)
      }
      const entries = child.type === 'Declaration' ? edits.get(child) : undefined
      if (!entries) continue
      if (multiple) {
        flush()
        replacements.push(...guards(entries, false))
      } else segment.push(...guards(entries, true))
    }
    flush()
    return replacements
  }
  function rewriteBlock(block: Block | StyleSheet): void {
    const children: CssNode[] = []
    for (const node of block.children.toArray()) {
      if (node.type === 'Rule') children.push(...rewriteRule(node))
      else {
        if (node.type === 'Atrule' && node.block) rewriteBlock(node.block)
        children.push(node)
        const entries = node.type === 'Declaration' ? edits.get(node) : undefined
        if (entries) children.push(...guards(entries, true))
      }
    }
    block.children = new List<CssNode>().fromArray(children)
  }
  const replacements = [...roots].map((root) => {
    rewriteBlock(root.tree)
    return { root, definitions: parseCanvasCss(root.tree, editor) }
  })
  const additions = [...extra].map(([id, style]) => {
    const css = Object.entries(style)
      .map(([property, value]) => generate(declaration(property, value)))
      .join(';')
    const tree = parseCanvasSheet(`@media(min-width:769px){#${ident.encode(id)}{${css}}}`)
    if (baseline?.mode)
      normalizeNativeOwnerRules(
        tree,
        components.flatMap((component) => {
          const element = component.getEl()
          return element ? [element] : []
        }),
        baseline.mode,
      )
    const [definition] = parseCanvasCss(tree, editor)
    const mediaText: unknown = definition?.['mediaText']
    if (typeof mediaText !== 'string')
      throw new Error('Desktop-regelns villkor kunde inte förberedas.')
    const normalizedStyle = definition?.['style']
    if (!normalizedStyle) throw new Error('Desktop-regelns stilar kunde inte förberedas.')
    const plannedStyle = Object.fromEntries(
      Object.entries(normalizedStyle).map(([key, value]) => {
        if (typeof value !== 'string')
          throw new Error('Desktop-regelns storleksvärde kunde inte förberedas.')
        return [key, value]
      }),
    )
    return { id, style: plannedStyle, mediaText }
  })
  return {
    measurements: samples.map(({ width, zoom, horizontalInset, horizontalMargin, stretch }) => ({
      width,
      zoom,
      horizontalInset,
      horizontalMargin,
      stretch,
    })),
    apply: () => {
      const collection = editor.Css.getAll()
      for (const { root, definitions } of replacements) {
        const descendants = collection.models.filter((rule) => {
          let parent = rule.parentRule
          while (parent) {
            if (parent === root.model) return true
            parent = parent.parentRule
          }
          return false
        })
        const next = collection.models
          .slice(collection.indexOf(root.model) + 1)
          .find((rule) => !rule.isNested())
        collection.remove([root.model, ...descendants])
        // Nested models can precede their root in GJS's flat collection. Removing them
        // changes numeric indexes; anchor the replacement to the next surviving root.
        collection.add(structuredClone(definitions), {
          at: next ? collection.indexOf(next) : collection.length,
        })
      }
      for (const { id, style, mediaText } of additions) {
        const existing = editor.Css.getIdRule(id, { mediaText, state: '' })
        if (existing) existing.addStyle(style)
        else editor.Css.setIdRule(id, style, { mediaText, state: '' })
      }
    },
  }
}
