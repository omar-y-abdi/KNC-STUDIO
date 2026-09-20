import { generate, parse, walk } from 'css-tree'
import type { Editor } from 'grapesjs'
import type { CmsMode, PageVariant } from '../../../shared/cms'

const attributes = ['class', 'title', 'href', 'target', 'rel', 'src', 'alt', 'aria-label']

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

export function nativeCanvas(variant: PageVariant, mode: CmsMode): { html: string; css: string } {
  if (!variant.html.includes('data-knc-native="1"'))
    return { html: variant.html, css: variant.css[mode] }
  const doc = new DOMParser().parseFromString(variant.html, 'text/html')
  const rules: string[] = []
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
    if (style && element.id) rules.push(`#${CSS.escape(element.id)}{${style}}`)
    element.removeAttribute('style')
  }
  return { html: doc.body.innerHTML, css: rules.join('\n') + '\n' + variant.css[mode] }
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
  for (const element of doc.querySelectorAll('[data-knc-baseline]')) {
    const style = document.createElement('span').style
    style.cssText =
      element.getAttribute(`data-knc-${mode}`) ?? element.getAttribute('data-knc-light') ?? ''
    if (element.id) originalStyles.set(element.id, style)
    const light = readBaseline(element, 'light')
    const current = mode === 'dark' ? readBaseline(element, 'dark') : light
    for (const name of attributes) {
      if (element.getAttribute(name) !== (current[name] ?? null)) continue
      if (light[name] === undefined) element.removeAttribute(name)
      else element.setAttribute(name, light[name])
    }
    element.removeAttribute('style')
  }
  const stylesheet = parse(css)
  walk(stylesheet, {
    visit: 'Rule',
    enter(rule) {
      const selector = generate(rule.prelude)
      const match = /^#([a-zA-Z][a-zA-Z0-9_-]*)$/.exec(selector)
      const original = match?.[1] ? originalStyles.get(match[1]) : undefined
      if (!original) return
      rule.block.children.forEach((declaration, item) => {
        if (declaration.type !== 'Declaration') return
        const name = declaration.property
        const value = generate(declaration.value)
        const normalized = document.createElement('span').style
        normalized.setProperty(name, value)
        if (normalized.getPropertyValue(name) === original.getPropertyValue(name))
          rule.block.children.remove(item)
        else declaration.important = true
      })
    },
  })
  return { html: doc.body.innerHTML, css: generate(stylesheet) }
}

/** Preserve declarations that CSSOM expands to empty longhands (notably var/env shorthands). */
export function parseCanvasCss(
  css: string,
  editor: Editor,
): ReturnType<Editor['Parser']['parseCss']> {
  const declarations = new Map<string, { property: string; value: string }>()
  const tree = parse(css, { parseCustomProperty: true })
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
