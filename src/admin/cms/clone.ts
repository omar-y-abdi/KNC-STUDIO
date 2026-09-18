import type { Component } from 'grapesjs'

const referenceAttributes = ['href', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'for'] as const

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
      const next = `${id}-copy-${crypto.randomUUID().slice(0, 8)}`
      ids.set(id, next)
      item.addAttributes({ id: next })
    }
  })
  walk(copy, (item) => {
    const attributes = item.getAttributes()
    const patch: Record<string, string> = {}
    for (const name of referenceAttributes) {
      const value = attributes[name]
      if (typeof value !== 'string') continue
      if (name === 'href' && value.startsWith('#')) {
        const next = ids.get(value.slice(1))
        if (next) patch[name] = `#${next}`
      } else {
        const tokens = value.split(/\s+/).map((token) => ids.get(token) ?? token)
        if (tokens.join(' ') !== value) patch[name] = tokens.join(' ')
      }
    }
    if (Object.keys(patch).length) item.addAttributes(patch)
    const style = item.getStyle()
    for (const [name, value] of Object.entries(style)) {
      if (typeof value !== 'string') continue
      let next = value
      for (const [before, after] of ids) next = next.replaceAll(`#${before}`, `#${after}`)
      if (next !== value) item.addStyle({ [name]: next })
    }
  })
  return copy
}
