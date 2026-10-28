import { themeDeclarations } from '../../../shared/site-theme-declarations'
import { modeCss } from '../../../shared/cms-mode-css'
import { repairDesktopCss } from '../../../shared/cms-device-css'
import { clone, generate, ident, List, parse, walk, type CssNode, type StyleSheet } from 'css-tree'
import type { Editor } from 'grapesjs'
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
  return (
    (editor.getConfig().protectedCss ?? '') +
    editor.CodeManager.getCode(null, 'css', {
      ...editor.getConfig().optsCss,
      cssc: editor.Css,
      keepUnusedStyles: true,
    })
  )
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

/** Preserve declarations that CSSOM expands to empty longhands (notably var/env shorthands). */
export function parseCanvasCss(
  css: string | CssNode,
  editor: Editor,
): ReturnType<Editor['Parser']['parseCss']> {
  const declarations = new Map<string, { property: string; value: string }>()
  // Masking declaration names is destructive; retain the prepared tree for deferred previews.
  const tree = typeof css === 'string' ? parseCanvasSheet(css) : clone(css)
  walk(tree, {
    visit: 'Block',
    enter(block) {
      if (!this.rule) return
      block.children.forEach((declaration) => {
        if (declaration.type !== 'Declaration') return
        const key = `--cms-internal-parse-${declarations.size}`
        declarations.set(key, {
          property: declaration.property,
          value: generate(declaration.value) + (declaration.important ? ' !important' : ''),
        })
        declaration.property = key
      })
    },
  })
  const restore = (style: Record<string, unknown>): Record<string, unknown> => {
    const restored: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(style)) {
      const original = declarations.get(key)
      if (original) {
        const previous = restored[original.property]
        restored[original.property] =
          previous === undefined ? original.value : [previous, original.value].flat()
      } else {
        restored[key] =
          value && typeof value === 'object' && !Array.isArray(value)
            ? restore(value as Record<string, unknown>)
            : value
      }
    }
    return restored
  }
  return editor.Parser.parseCss(generate(tree)).map((rule) => ({
    ...rule,
    style: restore(rule['style'] ?? {}),
  }))
}
