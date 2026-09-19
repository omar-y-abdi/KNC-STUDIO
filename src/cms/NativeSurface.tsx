import { createContext, Fragment, h, isValidElement } from 'preact'
import type { ComponentChild, ComponentChildren, JSX, VNode } from 'preact'
import { useContext, useEffect, useMemo, useState } from 'preact/hooks'
import {
  validatePresentation,
  type CmsLang,
  type CmsMode,
  type CmsPresentation,
} from '../../shared/cms'

const NativeContext = createContext<{
  presentation: CmsPresentation | null
  source: boolean
} | null>(null)

export function NativeSiteProvider({
  children,
  presentation,
  source = false,
}: {
  children: ComponentChildren
  presentation?: CmsPresentation | null
  source?: boolean
}): JSX.Element {
  const [published, setPublished] = useState<CmsPresentation | null>(() => {
    if (typeof document === 'undefined' || source || presentation !== undefined) return null
    try {
      const value: unknown = JSON.parse(
        document.getElementById('cms-native-state')?.textContent ?? 'null',
      )
      if (value === null) return null
      validatePresentation(value)
      return value
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (source || presentation !== undefined || published !== null) return
    const controller = new AbortController()
    void fetch('/api/cms/presentation', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('CMS presentation unavailable')
        const value: unknown = await response.json()
        if (!value || typeof value !== 'object' || !('presentation' in value))
          throw new Error('Invalid CMS presentation')
        validatePresentation(value.presentation)
        setPublished(value.presentation)
      })
      .catch(() => {
        // An unavailable CMS never replaces the existing site with a placeholder.
      })
    return () => controller.abort()
  }, [presentation, source])
  return (
    <NativeContext.Provider
      value={{ presentation: presentation === undefined ? published : presentation, source }}
    >
      {children}
    </NativeContext.Provider>
  )
}

type NativeNode = VNode<Record<string, unknown>>
const editableAttributes = ['class', 'title', 'href', 'target', 'rel', 'src', 'alt', 'aria-label']
const authoredTags = new Set(
  'a abbr address article aside b blockquote br div em figure figcaption footer h1 h2 h3 h4 h5 h6 header hr i img li main nav ol p pre section small span strong table tbody td th thead tr ul'.split(
    ' ',
  ),
)

function childrenOf(value: ComponentChildren): ComponentChild[] {
  return Array.isArray(value) ? value.flatMap(childrenOf) : [value]
}

function childKey(value: ComponentChild, index: number): string {
  if (!isValidElement(value) || value.key === null || value.key === undefined) return `i${index}`
  return `k${String(value.key)
    .split('')
    .map((char) => char.charCodeAt(0).toString(16))
    .join('x')}`
}

/** Keep actual handlers, refs and component instances; HTML supplies presentation only. */
export function nativeTree(
  source: ComponentChild,
  surface: string,
): {
  tree: ComponentChild
  nodes: Map<string, NativeNode>
  slots: Map<string, NativeNode>
} {
  const nodes = new Map<string, NativeNode>()
  const slots = new Map<string, NativeNode>()
  const visit = (value: ComponentChild, path: string): ComponentChild => {
    if (!isValidElement(value)) return value
    const props = value.props as Record<string, unknown>
    const identity = `knc-${surface}-${path}`
    if (value.type === Fragment)
      return h(
        Fragment,
        null,
        childrenOf(props['children'] as ComponentChildren).map((child, index) =>
          visit(child, `${path}-${childKey(child, index)}`),
        ),
      )
    if (typeof value.type !== 'string') {
      const slot = h<Record<string, unknown>>(
        'div',
        {
          id: identity,
          key: value.key ?? identity,
          'data-knc-slot': identity,
          style: 'display:contents',
        },
        value,
      )
      slots.set(identity, slot)
      return slot
    }
    const required = Boolean(value.ref) || Object.keys(props).some((key) => /^on[A-Z]/.test(key))
    const node = h<Record<string, unknown>>(
      value.type,
      {
        ...props,
        id: props['id'] ?? identity,
        key: value.key ?? identity,
        ref: value.ref,
        'data-knc-source': identity,
        ...(required ? { 'data-knc-required': 'true' } : {}),
        ...(path === '0' ? { 'data-knc-surface': surface } : {}),
      },
      childrenOf(props['children'] as ComponentChildren).map((child, index) =>
        visit(child, `${path}-${childKey(child, index)}`),
      ),
    )
    nodes.set(identity, node)
    return node
  }
  return { tree: visit(source, '0'), nodes, slots }
}

function baseline(element: Element): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(element.getAttribute('data-knc-baseline') ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function safeAttribute(name: string, value: string): boolean {
  return (
    !['href', 'src'].includes(name) ||
    (![...value].some((char) => char.charCodeAt(0) <= 32 || char === '\\') &&
      /^(?:\/(?!\/)|#|https:\/\/|mailto:|tel:)/i.test(value))
  )
}

export function projectNativeTree(
  source: ReturnType<typeof nativeTree>,
  template: Element,
): ComponentChild {
  const identities = new Set<string>()
  for (const element of [
    template,
    ...template.querySelectorAll('[data-knc-source],[data-knc-slot]'),
  ]) {
    const id = element.getAttribute('data-knc-source') ?? element.getAttribute('data-knc-slot')
    if (!id) continue
    if (identities.has(id)) return source.tree
    identities.add(id)
  }
  for (const [id, node] of source.nodes)
    if (node.props['data-knc-required'] && !identities.has(id)) return source.tree

  const visit = (node: Node): ComponentChild => {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1) return null
    const element = node as Element
    const slot = element.getAttribute('data-knc-slot')
    if (slot) return source.slots.get(slot) ?? null
    const identity = element.getAttribute('data-knc-source')
    const original = identity ? source.nodes.get(identity) : undefined
    if (identity && (!original || original.type !== element.tagName.toLowerCase())) return null
    if (!original && !authoredTags.has(element.tagName.toLowerCase())) return null
    const props: Record<string, unknown> = original ? { ...original.props } : {}
    const before = baseline(element)
    for (const name of editableAttributes) {
      const value = element.getAttribute(name)
      if (!original || value !== (before[name] ?? null)) {
        if (value === null) Reflect.deleteProperty(props, name)
        else if (safeAttribute(name, value)) props[name] = value
      }
    }
    if (original) {
      props['key'] = original.key
      props['ref'] = original.ref
    } else {
      props['id'] = element.id || undefined
      props['style'] = element.getAttribute('style') ?? ''
    }
    delete props['children']
    delete props['dangerouslySetInnerHTML']
    const unchangedText =
      original && element.children.length === 0 && before['text'] === element.textContent
    const children = unchangedText
      ? childrenOf(original.props['children'] as ComponentChildren)
      : [...element.childNodes].map(visit)
    // Preserve live lazy children that did not exist when the source was inspected.
    if (original)
      for (const child of childrenOf(original.props['children'] as ComponentChildren)) {
        if (!isValidElement(child)) continue
        const id = (child.props as Record<string, unknown>)['data-knc-slot']
        if (typeof id === 'string' && !identities.has(id)) children.push(child)
      }
    return h(original ? String(original.type) : element.tagName.toLowerCase(), props, children)
  }
  return visit(template)
}

export function useNativeSurface(
  source: ComponentChild,
  surface: string,
  lang: CmsLang,
  mode: CmsMode,
): JSX.Element {
  const context = useContext(NativeContext)
  const path =
    surface === 'my-bookings'
      ? '/my-bookings'
      : surface.endsWith('-booking')
        ? '/booking'
        : surface === 'about'
          ? '/about'
          : '/'
  const page = context?.presentation?.pages.find((candidate) => candidate.path === path)
  const html = context?.source ? '' : (page?.content[lang].html ?? '')
  const template = useMemo(() => {
    if (!html || typeof DOMParser === 'undefined') return null
    return new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector(`[data-knc-surface="${surface}"]`)
  }, [html, surface])
  if (!context) return h(Fragment, null, source)
  const native = nativeTree(source, surface)
  return (
    <>
      {template && <style>{page?.content[lang].css[mode] ?? ''}</style>}
      {template ? projectNativeTree(native, template) : native.tree}
    </>
  )
}
