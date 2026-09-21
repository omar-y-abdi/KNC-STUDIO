import { createContext, Fragment, h, isValidElement } from 'preact'
import type { ComponentChild, ComponentChildren, JSX, VNode } from 'preact'
import { useContext, useEffect, useMemo, useState } from 'preact/hooks'
import {
  validatePresentation,
  type CmsLang,
  type CmsMode,
  type CmsPresentation,
  type CmsPage,
} from '../../shared/cms'

const NativeContext = createContext<{
  presentation: CmsPresentation | null
  source: boolean
} | null>(null)

export function useCmsPageLinks(): readonly CmsPage[] {
  return (
    useContext(NativeContext)?.presentation?.pages.filter(
      (page) =>
        page.inMenu &&
        page.kind === 'page' &&
        !['/', '/about', '/booking', '/my-bookings', '/privacy', '/terms'].includes(page.path),
    ) ?? []
  )
}

interface NativeRenderContext {
  template: Element | null
  mode: CmsMode
}
const RenderContext = createContext<NativeRenderContext | null>(null)
const SlotContext = createContext<(NativeRenderContext & { identity: string }) | null>(null)

function NativeSlot({
  identity,
  children,
}: {
  identity: string
  children?: ComponentChildren
}): JSX.Element {
  const parent = useContext(RenderContext)
  const template = parent?.template?.querySelector(`[data-knc-surface="${identity}"]`) ?? null
  return (
    <SlotContext.Provider value={parent ? { ...parent, identity, template } : null}>
      {children}
    </SlotContext.Provider>
  )
}

/** Opt a code-owned component into presentation editing without replacing its hooks or handlers. */
export function useNativeChild(): (source: JSX.Element) => JSX.Element {
  const context = useContext(SlotContext)
  return (source) => {
    if (!context) return source
    const root =
      isValidElement(source) && typeof source.type === 'string'
        ? source
        : h('div', { style: 'display:contents' }, source)
    const native = nativeTree(root, context.identity)
    return (
      <RenderContext.Provider value={context}>
        {context.template ? projectNativeTree(native, context.template, context.mode) : native.tree}
      </RenderContext.Provider>
    )
  }
}

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

function nodeIdentity(surface: string, path: string): string {
  const identity = `knc-${surface}-${path}`
  if (identity.length <= 120) return identity
  // Nested component paths and entity UUIDs still need to fit the public element-ID contract.
  let hash = 14695981039346656037n
  for (const char of identity)
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 1099511628211n)
  return `knc-node-${hash.toString(16)}`
}

/** Keep actual handlers, refs and component instances; HTML supplies presentation only. */
export function nativeTree(
  source: ComponentChild,
  surface: string,
): {
  tree: ComponentChild
  nodes: Map<string, NativeNode>
  slots: Map<string, NativeNode>
  parents: Map<string, string>
} {
  const nodes = new Map<string, NativeNode>()
  const slots = new Map<string, NativeNode>()
  const parents = new Map<string, string>()
  const visit = (value: ComponentChild, path: string, parent?: string): ComponentChild => {
    if (!isValidElement(value)) return value
    const props = value.props as Record<string, unknown>
    const identity = nodeIdentity(surface, path)
    if (value.type === Fragment)
      return h(
        Fragment,
        null,
        childrenOf(props['children'] as ComponentChildren).map((child, index) =>
          visit(child, `${path}-${childKey(child, index)}`, parent),
        ),
      )
    if (parent) parents.set(identity, parent)
    if (typeof value.type !== 'string') {
      const slot = h<Record<string, unknown>>(
        'div',
        {
          id: identity,
          key: value.key ?? path,
          'data-knc-slot': identity,
          style: 'display:contents',
        },
        h(NativeSlot, { identity }, value),
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
        key: value.key ?? path,
        ref: value.ref,
        'data-knc-source': identity,
        ...(required ? { 'data-knc-required': 'true' } : {}),
        ...(path === '0' ? { 'data-knc-surface': surface } : {}),
      },
      childrenOf(props['children'] as ComponentChildren).map((child, index) =>
        visit(child, `${path}-${childKey(child, index)}`, identity),
      ),
    )
    nodes.set(identity, node)
    return node
  }
  return { tree: visit(source, '0'), nodes, slots, parents }
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

function baselineChildren(element: Element): string[] | null {
  const before = baseline(element)
  try {
    const value: unknown = JSON.parse(
      typeof before['children'] === 'string' ? before['children'] : 'null',
    )
    return Array.isArray(value) && value.every((id) => typeof id === 'string') ? value : null
  } catch {
    return null
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
  mode: CmsMode = 'light',
): ComponentChild {
  const identities = new Set<string>()
  const captured = new Set<string>()
  let capturedChildren = false
  for (const element of [
    template,
    ...template.querySelectorAll('[data-knc-source],[data-knc-slot]'),
  ]) {
    const id = element.getAttribute('data-knc-source') ?? element.getAttribute('data-knc-slot')
    if (!id) continue
    if (identities.has(id)) return source.tree
    identities.add(id)
    const children = baselineChildren(element)
    if (children) {
      capturedChildren = true
      for (const child of children) captured.add(child)
    }
  }
  for (const [id, node] of source.nodes) {
    if (!node.props['data-knc-required'] || identities.has(id)) continue
    if (!capturedChildren) return source.tree
    // A previously captured action (or its container) may not be removed. A new live action may appear.
    for (
      let current: string | undefined = id;
      current && !identities.has(current);
      current = source.parents.get(current)
    )
      if (captured.has(current)) return source.tree
  }

  const visit = (node: Node): ComponentChild => {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1) return null
    const element = node as Element
    const slot = element.getAttribute('data-knc-slot')
    if (slot) return source.slots.get(slot) ?? null
    const identity = element.getAttribute('data-knc-source')
    const original = identity ? source.nodes.get(identity) : undefined
    const logoImage =
      original?.type === 'svg' &&
      original.props['role'] === 'img' &&
      !original.props['data-knc-required'] &&
      element.tagName.toLowerCase() === 'img'
    if (identity && (!original || (original.type !== element.tagName.toLowerCase() && !logoImage)))
      return null
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
      props['style'] =
        (mode === 'dark' ? element.getAttribute('data-knc-dark') : null) ??
        element.getAttribute('style') ??
        ''
    }
    delete props['children']
    delete props['dangerouslySetInnerHTML']
    if (logoImage) {
      delete props['viewBox']
      delete props['fill']
      return h('img', props)
    }
    const directText = [...element.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent ?? '')
      .join('')
    const unchangedText = original && before['text'] === directText
    const liveText = ['']
    const liveElements: unknown[] = []
    const readText = (value: ComponentChild): void => {
      if (isValidElement(value)) {
        if (value.type === Fragment) childrenOf(value.props.children).forEach(readText)
        else {
          liveText.push('')
          const childProps = value.props as Record<string, unknown>
          liveElements.push(childProps['data-knc-source'] ?? childProps['data-knc-slot'])
        }
      } else if (typeof value === 'string' || typeof value === 'number') {
        liveText[liveText.length - 1] += String(value)
      }
    }
    if (unchangedText) childrenOf(original.props['children'] as ComponentChildren).forEach(readText)
    const templateElements = [...element.children].map(
      (child) => child.getAttribute('data-knc-source') ?? child.getAttribute('data-knc-slot'),
    )
    const textGaps = [false]
    for (const child of element.childNodes) {
      if (child.nodeType === 1) textGaps.push(false)
      else if (child.nodeType === 3 && child.textContent) textGaps[textGaps.length - 1] = true
    }
    // Owner insertion/deletion/reorder changes gap positions. Preserve authored children then;
    // substituting by the old source position could erase text or resurrect a removed icon.
    const bothLeaves = templateElements.length === 0 && liveElements.length === 0
    const alignedText =
      unchangedText &&
      (bothLeaves ||
        (templateElements.length === liveElements.length &&
          templateElements.every((id, index) => id === liveElements[index]) &&
          before['textGaps'] === JSON.stringify(textGaps)))
    let gap = 0
    const children =
      alignedText && bothLeaves
        ? childrenOf(original.props['children'] as ComponentChildren)
        : [...element.childNodes].map((child) => {
            if (child.nodeType === 1) gap++
            if (child.nodeType === 3 && alignedText) {
              const text = liveText[gap] ?? ''
              liveText[gap] = ''
              return text
            }
            return visit(child)
          })
    // Newly loaded entities and conditional runtime UI must not be frozen by an old snapshot.
    // The original child list distinguishes them from presentation children the owner removed.
    const previousChildren = baselineChildren(element)
    if (original)
      for (const child of childrenOf(original.props['children'] as ComponentChildren)) {
        if (!isValidElement(child)) continue
        const props = child.props as Record<string, unknown>
        const id = props['data-knc-slot'] ?? props['data-knc-source']
        if (
          typeof id === 'string' &&
          !identities.has(id) &&
          (previousChildren ? !previousChildren.includes(id) : Boolean(props['data-knc-slot']))
        )
          children.push(child)
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
  if (!context || (!context.source && !template)) return h(Fragment, null, source)
  const native = nativeTree(source, surface)
  return (
    <>
      {template && <style>{page?.content[lang].css[mode] ?? ''}</style>}
      <RenderContext.Provider value={{ template, mode }}>
        {template ? projectNativeTree(native, template, mode) : native.tree}
      </RenderContext.Provider>
    </>
  )
}
