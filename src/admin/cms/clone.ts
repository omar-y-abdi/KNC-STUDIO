import type { Component } from 'grapesjs'

const referenceAttributes = [
  'href',
  'xlink:href',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'for',
] as const

function walk(component: Component, visit: (component: Component) => void): void {
  visit(component)
  component.components().forEach((child: Component) => walk(child, visit))
}

export function cloneComponent(component: Component): Component {
  const copy = component.clone()
  const ids = new Map<string, string>()
  walk(copy, (item) => {
    const attributes = item.getAttributes()
    const id = attributes['id']
    if (typeof id === 'string' && id) {
      const next = `cms-copy-${crypto.randomUUID()}`
      ids.set(id, next)
      item.addAttributes({ id: next })
    }
    // A copy owns its presentation; it must not impersonate a live runtime node.
    item.removeAttributes([
      'data-knc-source',
      'data-knc-required',
      'data-knc-slot',
      'data-knc-surface',
      'data-knc-native',
    ])
  })
  const remapUrls = (value: string): string =>
    value.replaceAll(/url\(["']?#([^\s)"']+)["']?\)/g, (match, id: string) =>
      ids.has(id) ? `url(#${ids.get(id)})` : match,
    )
  walk(copy, (item) => {
    const attributes = item.getAttributes()
    const patch: Record<string, string> = {}
    for (const name of referenceAttributes) {
      const value = attributes[name]
      if (typeof value !== 'string') continue
      if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
        const next = ids.get(value.slice(1))
        if (next) patch[name] = `#${next}`
      } else if (name !== 'href' && name !== 'xlink:href') {
        const tokens = value.split(/\s+/).map((token) => ids.get(token) ?? token)
        if (tokens.join(' ') !== value) patch[name] = tokens.join(' ')
      }
    }
    for (const [name, value] of Object.entries(attributes)) {
      if (typeof value !== 'string') continue
      const next = remapUrls(value)
      if (next !== value) patch[name] = next
    }
    if (Object.keys(patch).length) item.addAttributes(patch)
    for (const [name, value] of Object.entries(item.getStyle())) {
      if (typeof value !== 'string') continue
      const next = remapUrls(value)
      if (next !== value) item.addStyle({ [name]: next })
    }
  })
  return copy
}
