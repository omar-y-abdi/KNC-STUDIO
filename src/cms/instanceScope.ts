import { nativeNodeId } from '../../shared/cms-native-id'
export { nativeNodeId } from '../../shared/cms-native-id'
import { cloneElement, Fragment, isValidElement } from 'preact'
import type { ComponentChild, ComponentChildren, VNode } from 'preact'
import { generate, ident, parse, walk } from 'css-tree'

const identityAttributes = new Set(['id', 'data-knc-source', 'data-knc-slot', 'data-knc-surface'])
const tokenReferences = new Set([
  'for',
  'htmlFor',
  'form',
  'list',
  'headers',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-activedescendant',
  'aria-details',
  'aria-errormessage',
])
const fragmentReferences = new Set(['href', 'xlink:href', 'xlinkHref'])
const urlAttributes = new Set(['fill', 'stroke', 'filter', 'clip-path', 'clipPath', 'mask'])

/** Project against canonical template identities first. Namespace only the rendered
 * result, so hashed descendants, component slots and authored IDs share one mapping.
 * Text, classes, external links, keys, handlers and refs are never rewritten.
 */
export function createInstanceScope(surface: string, instance: string, template: Element | null) {
  const namespace = `${surface}-instance-${Array.from(instance, (char) => (char.codePointAt(0) ?? 0).toString(16)).join('-')}`
  const ids = new Map<string, string>()
  const register = (id: string): string => {
    let scoped = ids.get(id)
    if (!scoped) {
      scoped = nativeNodeId(namespace, id)
      ids.set(id, scoped)
    }
    return scoped
  }
  if (template)
    for (const node of [template, ...template.querySelectorAll('*')])
      for (const name of identityAttributes) {
        const value = node.getAttribute(name)
        if (value) register(value)
      }

  const reference = (name: string, value: string): string => {
    if (identityAttributes.has(name)) return ids.get(value) ?? value
    if (tokenReferences.has(name)) return value.replace(/\S+/g, (id) => ids.get(id) ?? id)
    if (fragmentReferences.has(name) && value.startsWith('#')) {
      const next = ids.get(value.slice(1))
      if (next) return `#${next}`
    }
    return value
  }
  const css = (
    value: string,
    context: 'stylesheet' | 'declarationList' | 'value' = 'stylesheet',
  ): string => {
    if (!value) return value
    const ast = parse(value, { context, parseCustomProperty: true })
    walk(ast, (node) => {
      if (node.type === 'IdSelector') {
        const next = ids.get(ident.decode(node.name))
        if (next) node.name = ident.encode(next)
      } else if (node.type === 'Url') {
        node.value = reference('href', node.value)
      } else if (
        node.type === 'AttributeSelector' &&
        node.value &&
        (node.matcher === '=' || node.matcher === '~=')
      ) {
        const name = ident.decode(node.name.name)
        const value =
          node.value.type === 'String' ? node.value.value : ident.decode(node.value.name)
        const next = reference(name, value)
        if (next !== value) node.value = { type: 'String', value: next }
      }
    })
    return generate(ast)
  }
  const children = (value: ComponentChildren): ComponentChild[] =>
    Array.isArray(value) ? value.flatMap(children) : [value]
  const isHost = (value: ComponentChild): value is VNode<Record<string, unknown>> =>
    isValidElement(value) && (typeof value.type === 'string' || value.type === Fragment)
  const collect = (value: ComponentChild): void => {
    if (!isHost(value)) return
    for (const name of identityAttributes) {
      const id = value.props[name]
      if (typeof id === 'string' && id) register(id)
    }
    children(value.props['children'] as ComponentChildren).forEach(collect)
  }
  const visit = (value: ComponentChild): ComponentChild => {
    // Components retain their identity and execute normally. NativeSlot passes this
    // scope through context; opt-in children namespace their own projected output.
    if (!isHost(value)) return value
    const props: Record<string, unknown> = {}
    for (const [name, cell] of Object.entries(value.props)) {
      if (typeof cell === 'string') {
        const next =
          name === 'style'
            ? css(cell, 'declarationList')
            : urlAttributes.has(name)
              ? css(cell, 'value')
              : reference(name, cell)
        if (next !== cell) props[name] = next
      } else if (name === 'style' && cell && typeof cell === 'object') {
        props[name] = Object.fromEntries(
          Object.entries(cell).map(([property, entry]) => [
            property,
            typeof entry === 'string' && entry.includes('url(') ? css(entry, 'value') : entry,
          ]),
        )
      }
    }
    return cloneElement(
      value,
      props,
      ...children(value.props['children'] as ComponentChildren).map(visit),
    )
  }
  return {
    css,
    tree(value: ComponentChild): ComponentChild {
      collect(value)
      return visit(value)
    },
  }
}

export type InstanceScope = ReturnType<typeof createInstanceScope>
