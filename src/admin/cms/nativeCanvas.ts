import { themeDeclarations } from '../../../shared/site-theme-declarations'
import { modeCss } from '../../../shared/cms-mode-css'
import { repairDesktopCss } from '../../../shared/cms-device-css'
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
  type StyleSheet,
} from 'css-tree'
import type { CssRule, Editor } from 'grapesjs'
import type { CmsMode, PageVariant } from '../../../shared/cms'
import { INFORMATION_PAGE_PATHS } from '../../../shared/cms'

/** /terms, /privacy and /contact render on the base sheets the Worker inlines. The canvas links the
 * same files and pins the edited mode, as `?mode` does publicly, so the owner edits what visitors
 * see. Other pages get neither. Linked sheets sit outside the editor's CSS, so nothing is exported. */
export function legalCanvasBase(path: string, mode: CmsMode): { styles: string[]; scheme: string } {
  return INFORMATION_PAGE_PATHS.includes(path)
    ? { styles: ['/tokens.css', '/info.css'], scheme: mode }
    : { styles: [], scheme: '' }
}

/** The CMS keeps every composer rule and uses avoidInlineStyle. Resolving each
 * component's style only to collect unused selector IDs makes full export quadratic. */
export function readCanvasCss(editor: Editor): string {
  return (editor.getConfig().protectedCss ?? '') + canvasRules(editor).map(canvasRuleCss).join('')
}

function canvasRules(editor: Editor): CssRule[] {
  // Keep every unused source rule, but selection can create empty component rules.
  // Empty layers live inside a nonempty envelope and remain in the export.
  return editor.Css.getAll().models.filter(
    (rule) => !rule.isNested() && Object.keys(rule.get('style') ?? {}).length > 0,
  )
}

const canvasStyleOptions = { withNested: true, allowEmpty: true }

function canvasStyleCss(style: CanvasStyle): string {
  return Object.entries(style)
    .map(([key, value]) =>
      typeof value === 'object' && !Array.isArray(value)
        ? `${key}{${canvasStyleCss(value)}}`
        : (Array.isArray(value) ? value : [value]).map((item) => `${key}:${item};`).join(''),
    )
    .join('')
}

function canvasRuleCss(rule: CssRule): string {
  // These root envelopes preserve anonymous layer identity and complete keyframes.
  // Their frame keys need not fit GrapesJS's punctuation-only nested-key heuristic.
  if (rule.get('singleAtRule') && !rule.getAtRule() && !rule.selectorsToString())
    return canvasStyleCss(rule.toJSON().style ?? {})
  return rule.toCSS({ important: rule.get('important') ?? false, ...canvasStyleOptions })
}

/** GrapesJS defaults both nested and empty blocks off. Layer ordering requires the
 * empty blocks too; keep canvas mounting and every export on the same options. */
export function connectCanvasStyles(editor: Editor): () => void {
  editor.getConfig().optsCss = { ...editor.getConfig().optsCss, ...canvasStyleOptions }
  let active = true
  let queued = false
  let loaded = false
  const owned = new Set<HTMLElement>()
  const order = (): void => {
    queued = false
    if (!active) return
    const doc = editor.Canvas.getDocument()
    if (!doc?.body) return
    const elements = canvasRules(editor).map((rule) => rule.getView()?.el)
    if (elements.some((element) => !element || element.nodeName !== 'STYLE')) {
      if (loaded) throw new Error('En CSS-regel saknar sin redigeringsvy.')
      return
    }
    const current = new Set<HTMLElement>()
    let next: Node | null = null
    for (const element of [...elements].reverse()) {
      if (!element) continue
      current.add(element)
      // FrameView has a separate component wrapper. Body styles follow linked bases.
      if (element.parentNode !== doc.body || element.nextSibling !== next)
        doc.body.insertBefore(element, next)
      next = element
    }
    for (const element of owned) if (!current.has(element)) element.remove()
    owned.clear()
    for (const element of current) owned.add(element)
  }
  const schedule = (): void => {
    if (queued || !active) return
    queued = true
    queueMicrotask(order)
  }
  const ready = (): void => {
    loaded = true
    schedule()
  }
  const mount = (event: { rule: CssRule; css: string }): void => {
    event.css = event.rule.isNested() ? '' : canvasRuleCss(event.rule)
  }
  editor.on('css:mount:before', mount)
  editor.on('css:mount', schedule)
  editor.on('load canvas:frame:load', ready)
  editor.Css.getAll().on('reset add remove', schedule)
  schedule()
  return () => {
    active = false
    editor.off('css:mount:before', mount)
    editor.off('css:mount', schedule)
    editor.off('load canvas:frame:load', ready)
    editor.Css.getAll().off('reset add remove', schedule)
    for (const element of owned) element.remove()
    owned.clear()
  }
}

const attributes = [
  'class',
  'title',
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'aria-label',
  'placeholder',
]

function readBaseline(element: Element, mode: CmsMode): Record<string, string> {
  const value: unknown = JSON.parse(
    (mode === 'dark' ? element.getAttribute('data-knc-dark-attrs') : null) ??
      element.getAttribute('data-knc-baseline') ??
      '{}',
  )
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Ogiltig källmetadata. Läs in den befintliga sidan igen.')
  return value as Record<string, string>
}

interface NativeStyle {
  css: string
  style: CSSStyleDeclaration
  declarations?: CssNode
}

export interface CanvasTree {
  html: string
  sheet: StyleSheet
}

/** A microtask alone does not let the browser dispatch input or paint. */
export function yieldCanvasTask(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0))
}

/** Parse stored sheets once; subsequent canvas passes operate on this tree. */
export function parseCanvasSheet(css: string): StyleSheet {
  return parse(css, { parseCustomProperty: true }) as StyleSheet
}

function nativeStyle(
  element: Element,
  mode: CmsMode,
  cache: Map<string, NativeStyle>,
): NativeStyle {
  const source =
    element.getAttribute(`data-knc-${mode}`) ?? element.getAttribute('data-knc-light') ?? ''
  const cached = cache.get(source)
  if (cached) return cached
  const css = themeDeclarations(source, mode)
  const style = document.createElement('span').style
  style.cssText = css
  const value = { css, style }
  cache.set(source, value)
  return value
}

function normalizeNativeCss(
  stylesheet: StyleSheet,
  originals: ReadonlyMap<string, CSSStyleDeclaration>,
  removeUnchanged: boolean,
): StyleSheet {
  const normalized = document.createElement('span').style
  const values = new Map<string, string>()
  const normalizeValue = (value: string): string => {
    const cached = values.get(value)
    if (cached !== undefined) return cached
    const result = generate(parse(value, { context: 'value' }))
    values.set(value, result)
    return result
  }
  walk(stylesheet, {
    visit: 'Rule',
    enter(rule) {
      // Source mobile rules carry a structural :where() marker; only bare IDs are owner rules.
      if (rule.prelude.type !== 'SelectorList' || rule.prelude.children.size !== 1) return
      const selector = rule.prelude.children.first
      if (selector?.type !== 'Selector' || selector.children.size !== 1) return
      const id = selector.children.first
      const original = id?.type === 'IdSelector' ? originals.get(ident.decode(id.name)) : undefined
      if (!original) return
      rule.block.children.forEach((declaration, item) => {
        if (declaration.type !== 'Declaration') return
        const name = declaration.property
        // Invalid declarations must not retain a previous value in the scratch style.
        normalized.cssText = ''
        normalized.setProperty(name, generate(declaration.value))
        const unchanged =
          !this.atrule &&
          normalizeValue(normalized.getPropertyValue(name)) ===
            normalizeValue(original.getPropertyValue(name))
        if (unchanged) {
          if (removeUnchanged) rule.block.children.remove(item)
        } else declaration.important = true
      })
    },
  })
  return stylesheet
}

export function nativeCanvasTree(variant: PageVariant, mode: CmsMode): CanvasTree {
  const stored = repairDesktopCss(parseCanvasSheet(variant.css[mode]))
  if (!variant.html.includes('data-knc-native="1"')) {
    const sheet = parseCanvasSheet('body{background-color:inherit;color:inherit}')
    sheet.children.appendList(modeCss(stored, mode).children)
    return { html: variant.html, sheet }
  }
  const doc = new DOMParser().parseFromString(variant.html, 'text/html')
  const sheet: StyleSheet = { type: 'StyleSheet', children: new List() }
  const originalStyles = new Map<string, CSSStyleDeclaration>()
  // Scoped to this conversion: no retained owner documents or stale cross-theme values.
  const styles = new Map<string, NativeStyle>()
  for (const element of doc.querySelectorAll('[data-knc-baseline]')) {
    const light = readBaseline(element, 'light')
    const current = mode === 'dark' ? readBaseline(element, 'dark') : light
    for (const name of attributes) {
      if (element.getAttribute(name) !== (light[name] ?? null)) continue
      if (current[name] === undefined) element.removeAttribute(name)
      else element.setAttribute(name, current[name])
    }
    const style =
      element.getAttribute(`data-knc-${mode}`) ?? element.getAttribute('data-knc-light') ?? ''
    const native = nativeStyle(element, mode, styles)
    if (element.id) originalStyles.set(element.id, native.style)
    if (style && element.id) {
      native.declarations ??= parse(native.css, {
        context: 'declarationList',
        parseCustomProperty: true,
      })
      const declarations = clone(native.declarations)
      if (declarations.type !== 'DeclarationList') throw new Error('Invalid native declarations')
      sheet.children.appendData({
        type: 'Rule',
        prelude: {
          type: 'SelectorList',
          children: new List<CssNode>().fromArray([
            {
              type: 'Selector',
              children: new List<CssNode>().fromArray([
                { type: 'IdSelector', name: ident.encode(element.id) },
              ]),
            },
          ]),
        },
        block: { type: 'Block', children: declarations.children },
      })
    }
    element.removeAttribute('style')
  }
  sheet.children.appendList(normalizeNativeCss(stored, originalStyles, false).children)
  return { html: doc.body.innerHTML, sheet }
}

export function nativeCanvas(variant: PageVariant, mode: CmsMode): { html: string; css: string } {
  const canvas = nativeCanvasTree(variant, mode)
  return { html: canvas.html, css: generate(canvas.sheet) }
}

/** Only owner changes override inline runtime styling; snapshots never freeze live layout state. */
export function exportNativeCanvas(
  html: string,
  css: string,
  mode: CmsMode,
): { html: string; css: string } {
  if (!html.includes('data-knc-native="1"')) return { html, css }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const originalStyles = new Map<string, CSSStyleDeclaration>()
  // Scoped to this conversion: no retained owner documents or stale cross-theme values.
  const styles = new Map<string, NativeStyle>()
  for (const element of doc.querySelectorAll('[data-knc-baseline]')) {
    const native = nativeStyle(element, mode, styles)
    if (element.id) originalStyles.set(element.id, native.style)
    const light = readBaseline(element, 'light')
    const current = mode === 'dark' ? readBaseline(element, 'dark') : light
    for (const name of attributes) {
      if (element.getAttribute(name) !== (current[name] ?? null)) continue
      if (light[name] === undefined) element.removeAttribute(name)
      else element.setAttribute(name, light[name])
    }
    element.removeAttribute('style')
  }
  return {
    html: doc.body.innerHTML,
    css: generate(normalizeNativeCss(parse(css) as StyleSheet, originalStyles, true)),
  }
}

type CanvasStyle = { [key: string]: string | string[] | CanvasStyle }

/** JS style objects need distinct keys where CSS permits repeated blocks. Whitespace before
 * the opening brace/colon keeps the CSS identical, including separate anonymous layers. */
function appendCanvasStyle(style: CanvasStyle, property: string, value: CanvasStyle[string]): void {
  let key = property
  const nested = typeof value === 'object' && !Array.isArray(value)
  if (Object.hasOwn(style, key)) {
    const keys = Object.keys(style)
    if (!nested && keys.at(-1) === key) {
      const previous = style[key]
      if (
        (typeof previous === 'string' || Array.isArray(previous)) &&
        (typeof value === 'string' || Array.isArray(value))
      ) {
        style[key] = [previous, value].flat()
        return
      }
    }
    while (Object.hasOwn(style, key)) key += ' '
  }
  Object.defineProperty(style, key, { value, enumerable: true, configurable: true, writable: true })
}

function appendLayerOrder(style: CanvasStyle, node: Atrule): void {
  const list = node.prelude?.type === 'AtrulePrelude' ? node.prelude.children.first : null
  // css-tree's installed runtime supports LayerList/Layer; its type package is older.
  if (!list || String(list.type) !== 'LayerList' || !('children' in list) || !list.children)
    throw new Error('Ordningen på sidans CSS-lager kunde inte bevaras.')
  list.children.forEach((layer) => {
    appendCanvasStyle(style, `@layer ${generate(layer)}`, Object.create(null))
  })
}

function canvasNestedStyle(
  block: Block,
  withinRule = true,
  keyframes = false,
  envelope = false,
): CanvasStyle {
  const style: CanvasStyle = Object.create(null)
  block.children.forEach((node) => {
    if (node.type === 'Declaration') {
      appendCanvasStyle(
        style,
        node.property,
        generate(node.value) + (node.important ? ' !important' : ''),
      )
    } else if (
      node.type === 'Atrule' &&
      ident.decode(node.name).toLowerCase() === 'layer' &&
      !node.block
    ) {
      // Ordered empty named blocks establish exactly the same layer ordering.
      appendLayerOrder(style, node)
    } else if (node.type === 'Rule' || (node.type === 'Atrule' && node.block)) {
      let key =
        node.type === 'Rule'
          ? generate(node.prelude)
          : `@${node.name}${node.prelude ? ` ${generate(node.prelude)}` : ''}`
      // GrapesJS recognizes nested style keys by punctuation. An explicit nesting
      // selector preserves the descendant meaning of a bare type selector as well.
      if (node.type === 'Rule' && !envelope && !keyframes && !/^[&.#:[>+~*]/.test(key)) {
        if (withinRule) key = `& ${key}`
        else if (node.prelude.type === 'SelectorList')
          key = node.prelude.children
            .toArray()
            .map((branch) => `:is(${generate(branch)})`)
            .join(',')
        else throw new Error('En CSS-selektor i ett lager kunde inte bevaras.')
      }
      // GJS copies style objects into ordinary objects. These selector names must
      // remain own data keys rather than special prototype/constructor properties.
      if (envelope && ['__proto__', 'constructor', 'prototype'].includes(key)) key += ' '
      if (
        node.type === 'Atrule' &&
        ![
          'media',
          'supports',
          'container',
          'layer',
          'font-face',
          'keyframes',
          '-webkit-keyframes',
        ].includes(ident.decode(node.name).toLowerCase())
      )
        throw new Error(`Kan inte bevara nästlad @${node.name} i sidans CSS.`)
      appendCanvasStyle(
        style,
        key,
        canvasNestedStyle(
          node.block!,
          node.type === 'Rule' || withinRule,
          node.type === 'Atrule' &&
            ['keyframes', '-webkit-keyframes'].includes(ident.decode(node.name).toLowerCase()),
          envelope,
        ),
      )
    } else throw new Error('Sidans CSS innehåller ett block som inte kan bevaras.')
  })
  return style
}

/** Preserve declarations that CSSOM expands to empty longhands (notably var/env shorthands).
 * GrapesJS also assumes every nested CSSOM rule has `.style`; grouping rules do not. Mask
 * nested blocks too, then restore their syntax from the prepared tree after selector parsing. */
export function parseCanvasCss(
  css: string | CssNode,
  editor: Editor,
): ReturnType<Editor['Parser']['parseCss']> {
  const declarations = new Map<string, { property: string; value: CanvasStyle[string] }>()
  const layerRoots = new Map<string, CanvasStyle>()
  // Masking declaration names is destructive; retain the prepared tree for deferred previews.
  const tree = typeof css === 'string' ? parseCanvasSheet(css) : clone(css)
  walk(tree, (node) => {
    if (node.type === 'Raw')
      throw new Error('Sidans CSS innehåller syntax som inte kan bevaras. Källan har bevarats.')
  })
  if (tree.type === 'StyleSheet')
    tree.children.forEach((node, item) => {
      let hasLayer = false
      let groups = 0
      walk(node, (child) => {
        if (child.type !== 'Atrule') return
        groups++
        if (ident.decode(child.name).toLowerCase() === 'layer') hasLayer = true
      })
      if (
        node.type !== 'Atrule' ||
        (!hasLayer &&
          groups < 2 &&
          !['keyframes', '-webkit-keyframes'].includes(ident.decode(node.name).toLowerCase()))
      )
        return
      const key = `--cms-internal-layer-${layerRoots.size}`
      layerRoots.set(
        key,
        canvasNestedStyle(
          { type: 'Block', children: new List<CssNode>().fromArray([node]) },
          false,
          false,
          true,
        ),
      )
      tree.children.replace(
        item,
        tree.children.createItem(parse(`html{${key}:initial}`, { context: 'rule' })),
      )
    })
  walk(tree, {
    visit: 'Block',
    enter(block) {
      if (!this.rule) return
      block.children.forEach((declaration, item) => {
        const key = `--cms-internal-parse-${declarations.size}`
        if (declaration.type === 'Declaration' && layerRoots.has(declaration.property)) return
        if (declaration.type === 'Declaration') {
          declarations.set(key, {
            property: declaration.property,
            value: generate(declaration.value) + (declaration.important ? ' !important' : ''),
          })
          declaration.property = key
        } else if (
          declaration.type === 'Rule' ||
          (declaration.type === 'Atrule' && declaration.block)
        ) {
          const nested = canvasNestedStyle({
            ...block,
            children: new List<CssNode>().fromArray([declaration]),
          })
          const property = Object.keys(nested)[0]!
          declarations.set(key, { property, value: nested[property]! })
          block.children.replace(
            item,
            block.children.createItem(parse(`${key}:initial`, { context: 'declaration' })),
          )
        }
      })
    },
  })
  const seen = new Set<string>()
  const seenLayers = new Set<string>()
  const restore = (style: Record<string, unknown>): CanvasStyle => {
    const restored: CanvasStyle = Object.create(null)
    for (const [key, value] of Object.entries(style)) {
      const original = declarations.get(key)
      if (original) {
        seen.add(key)
        appendCanvasStyle(restored, original.property, original.value)
      } else {
        const restoredValue =
          value && typeof value === 'object' && !Array.isArray(value)
            ? restore(value as Record<string, unknown>)
            : value
        appendCanvasStyle(restored, key, restoredValue as CanvasStyle[string])
      }
    }
    return restored
  }
  let failure: unknown
  const recordFailure = (event: { error?: unknown }): void => {
    failure = event.error
  }
  editor.on('parse:css', recordFailure)
  let rules: ReturnType<Editor['Parser']['parseCss']>
  try {
    rules = editor.Parser.parseCss(generate(tree)).map((rule) => {
      const layerKey = Object.keys(rule['style'] ?? {}).find((key) => layerRoots.has(key))
      if (layerKey) {
        seenLayers.add(layerKey)
        return {
          selectors: [],
          singleAtRule: true,
          style: layerRoots.get(layerKey)!,
        }
      }
      return { ...rule, style: restore(rule['style'] ?? {}) }
    })
  } finally {
    editor.off('parse:css', recordFailure)
  }
  if (failure) throw failure
  if (seen.size !== declarations.size || seenLayers.size !== layerRoots.size)
    throw new Error('Sidans CSS kunde inte läsas in utan att förlora regler. Källan har bevarats.')
  return rules
}
