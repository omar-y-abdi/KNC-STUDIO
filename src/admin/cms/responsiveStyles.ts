import { generate, parse, walk, type CssNode } from 'css-tree'

// Appearance is theme-specific; geometry is shared by light/dark and scoped by device.
const geometryProperties = new Set(
  'display position top right bottom left z-index translate transform rotate scale zoom width height gap row-gap column-gap order box-sizing float clear text-align font-size line-height letter-spacing white-space object-fit object-position'.split(
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

function declarations(css: string): Map<string, Map<string, CssNode>> {
  const result = new Map<string, Map<string, CssNode>>()
  walk(parse(css), {
    visit: 'Rule',
    enter(rule) {
      const selector = generate(rule.prelude)
      if (!/^#[\w-]+$/.test(selector)) return
      const media =
        this.atrule?.name === 'media' && this.atrule.prelude ? generate(this.atrule.prelude) : ''
      const key = JSON.stringify([selector, media])
      const values = result.get(key) ?? new Map<string, CssNode>()
      rule.block.children.forEach((declaration) => {
        if (declaration.type === 'Declaration' && isGeometry(declaration.property))
          values.set(declaration.property, declaration)
      })
      result.set(key, values)
    },
  })
  return result
}

/** Copy only changed geometry, preserving the other theme's independent colors and effects. */
export function syncLayout(before: string, after: string, other: string): string {
  const previous = declarations(before)
  const next = declarations(after)
  const changes = new Map<string, Map<string, CssNode | null>>()
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const a = previous.get(key) ?? new Map()
    const b = next.get(key) ?? new Map()
    const changed = new Map<string, CssNode | null>()
    for (const property of new Set([...a.keys(), ...b.keys()])) {
      const oldValue = a.get(property)
      const newValue = b.get(property)
      if ((oldValue && generate(oldValue)) !== (newValue && generate(newValue)))
        changed.set(property, newValue ?? null)
    }
    if (changed.size) changes.set(key, changed)
  }
  const tree = parse(other)
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      const media =
        this.atrule?.name === 'media' && this.atrule.prelude ? generate(this.atrule.prelude) : ''
      const changed = changes.get(JSON.stringify([generate(rule.prelude), media]))
      if (!changed) return
      rule.block.children.forEach((declaration, item) => {
        if (declaration.type === 'Declaration' && changed.has(declaration.property))
          rule.block.children.remove(item)
      })
    },
  })
  let result = generate(tree)
  for (const [key, values] of changes) {
    const [selector, media] = JSON.parse(key) as [string, string]
    const body = [...values.values()]
      .filter((v): v is CssNode => v !== null)
      .map((v) => generate(v))
      .join(';')
    if (body) result += media ? `@media ${media}{${selector}{${body}}}` : `${selector}{${body}}`
  }
  return result
}
