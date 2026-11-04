import { cmsFontFaceCss } from '../../shared/cms'
import { SUPABASE_URL } from '../backend/config'
import { siteThemeCss, themeStyleValue } from '../../shared/site-theme'
import { repairDesktopCss } from '../../shared/cms-device-css'
import { nativeNodeId } from '../../shared/cms-native-id'
import type { createInstanceScope, InstanceScope } from './instanceScope'
import { createContext, Fragment, h, isValidElement } from 'preact'
import type { ComponentChild, ComponentChildren, JSX, VNode } from 'preact'
import { useLocation } from 'wouter-preact'
import { useContext, useEffect, useMemo, useState } from 'preact/hooks'
import {
  validatePresentation,
  isSitePage,
  type CmsLang,
  type CmsMode,
  type CmsPresentation,
  type CmsPage,
} from '../../shared/cms'
import {
  CMS_REVISION_ATTRIBUTE,
  isNativePublicPath,
  parseCmsRevision,
  presentationPath,
} from '../site/routeMetadata'

const NativeContext = createContext<{
  presentation: CmsPresentation | null
  source: boolean
  projectSource: boolean
} | null>(null)

export function useCmsPresentation(): CmsPresentation | null {
  return useContext(NativeContext)?.presentation ?? null
}

export function useNativeSource(): boolean {
  return useContext(NativeContext)?.source ?? false
}

export function useCmsPageLinks(): readonly CmsPage[] {
  return (
    useContext(NativeContext)?.presentation?.pages.filter(
      (page) => page.inMenu && isSitePage(page),
    ) ?? []
  )
}

interface NativeRenderContext {
  template: Element | null
  mode: CmsMode
  scope?: InstanceScope | null
}
const RenderContext = createContext<NativeRenderContext | null>(null)
const SlotContext = createContext<(NativeRenderContext & { identity: string }) | null>(null)

type PublishedState = 'idle' | 'loading' | 'ready' | 'error'

function readInlinePresentation(): CmsPresentation | null {
  if (typeof document === 'undefined') return null
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
}

/** Pauses before the automatic re-reads of the published presentation. A slow database answers one
 * read with 503; the error state follows only the read after the last pause (PERF-5). */
export const PRESENTATION_RETRY_DELAYS_MS: readonly number[] = [500, 1500]

function pauseFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** One read, then one more after each pause while reads fail; rejects with the last failure. An
 * aborted signal ends the sequence: no further read starts. */
export async function readWithRetries<T>(
  read: () => Promise<T>,
  delays: readonly number[],
  signal: AbortSignal,
  pause: (ms: number, signal: AbortSignal) => Promise<void> = pauseFor,
): Promise<T> {
  for (const ms of delays) {
    try {
      return await read()
    } catch (error) {
      if (signal.aborted) throw error
    }
    await pause(ms, signal)
  }
  return read()
}

async function fetchPublishedPresentation(signal: AbortSignal): Promise<CmsPresentation> {
  // The Worker names the revision it rendered this shell from; that revision comes from the edge.
  const revision = parseCmsRevision(document.documentElement.getAttribute(CMS_REVISION_ATTRIBUTE))
  const response = await fetch(presentationPath(revision), { signal })
  if (!response.ok) throw new Error('CMS presentation unavailable')
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || !('presentation' in value))
    throw new Error('Invalid CMS presentation')
  validatePresentation(value.presentation)
  return value.presentation
}

const VISUALLY_HIDDEN: JSX.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/** While the presentation is read, the page is its pre-painted background (R12); only assistive
 * technology hears the status. A failure after the last retry stays visible with a manual retry. */
function PublicPresentationGate({
  error,
  onRetry,
}: {
  error: boolean
  onRetry: () => void
}): JSX.Element {
  if (!error)
    return (
      <main aria-busy="true">
        <div role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
          Laddar webbplatsen…
        </div>
      </main>
    )
  return (
    <main
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'transparent',
        color: 'CanvasText',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <div role="alert" aria-live="polite">
        <p>Webbplatsen kunde inte laddas just nu.</p>
        <button type="button" onClick={onRetry}>
          Försök igen
        </button>
      </div>
    </main>
  )
}

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
    const native = nativeTree(root, context.identity, context.mode)
    const projected = context.template
      ? projectNativeTree(native, context.template, context.mode)
      : native.tree
    return (
      <RenderContext.Provider value={context}>
        {context.scope ? context.scope.tree(projected) : projected}
      </RenderContext.Provider>
    )
  }
}

export function NativeSiteProvider({
  children,
  presentation,
  source = false,
  projectSource = false,
}: {
  children: ComponentChildren
  presentation?: CmsPresentation | null
  source?: boolean
  projectSource?: boolean
}): JSX.Element {
  const [pathname] = useLocation()
  const publicNativeRoute = !source && presentation === undefined && isNativePublicPath(pathname)
  const [published, setPublished] = useState<CmsPresentation | null>(() =>
    source || presentation !== undefined ? null : readInlinePresentation(),
  )
  const [publishedState, setPublishedState] = useState<PublishedState>(() =>
    published === null ? 'idle' : 'ready',
  )
  const [retryCount, setRetryCount] = useState(0)
  useEffect(() => {
    if (source || presentation !== undefined || !publicNativeRoute || published !== null) return
    const controller = new AbortController()
    const { signal } = controller
    setPublishedState('loading')
    void readWithRetries(
      () => fetchPublishedPresentation(signal),
      PRESENTATION_RETRY_DELAYS_MS,
      signal,
    ).then(
      (value) => {
        if (signal.aborted) return
        setPublished(value)
        setPublishedState('ready')
      },
      () => {
        if (!signal.aborted) setPublishedState('error')
      },
    )
    return () => controller.abort()
  }, [presentation, source, publicNativeRoute, published, retryCount])
  const current = presentation === undefined ? published : presentation
  const fonts = cmsFontFaceCss(current?.fonts, SUPABASE_URL ?? '')
  if (publicNativeRoute && publishedState !== 'ready') {
    return (
      <PublicPresentationGate
        error={publishedState === 'error'}
        onRetry={() => {
          setPublishedState('idle')
          setRetryCount((count) => count + 1)
        }}
      />
    )
  }
  return (
    <NativeContext.Provider
      value={{
        presentation: presentation === undefined ? published : presentation,
        source,
        projectSource,
      }}
    >
      {fonts && <style>{fonts}</style>}
      {children}
    </NativeContext.Provider>
  )
}

type NativeNode = VNode<Record<string, unknown>>
const editableAttributes = [
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
  mode: CmsMode = 'light',
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
    const identity = nativeNodeId(surface, path)
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
    const nativeStyle = props['style']
    const themedStyle =
      nativeStyle && typeof nativeStyle === 'object'
        ? Object.fromEntries(
            Object.entries(nativeStyle).map(([key, cell]) => [
              key,
              typeof cell === 'string'
                ? themeStyleValue(
                    key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
                    cell,
                    mode,
                  )
                : cell,
            ]),
          )
        : nativeStyle
    const required = Boolean(value.ref) || Object.keys(props).some((key) => /^on[A-Z]/.test(key))
    const node = h<Record<string, unknown>>(
      value.type,
      {
        ...props,
        style: themedStyle,
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

/** Replacing a decorative graphic must not discard a nested action or live slot. */
function containsRuntimeAction(value: ComponentChild): boolean {
  if (!isValidElement(value)) return false
  const props = value.props as Record<string, unknown>
  return (
    Boolean(value.ref || props['data-knc-required'] || props['data-knc-slot']) ||
    childrenOf(props['children'] as ComponentChildren).some(containsRuntimeAction)
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
    // Optional resource branches can change between a component slot and a native image.
    if (slot) return source.slots.get(slot) ?? source.nodes.get(slot) ?? null
    const identity = element.getAttribute('data-knc-source')
    const original = identity ? source.nodes.get(identity) : undefined
    const graphicImage =
      original?.type === 'svg' &&
      !containsRuntimeAction(original) &&
      element.tagName.toLowerCase() === 'img'
    if (identity && !original) return source.slots.get(identity) ?? null
    // A calendar cell can change between an empty span and a live date button. Preserve that
    // runtime transition; the captured month's tag must never remove a later month's dates.
    if (original && original.type !== element.tagName.toLowerCase() && !graphicImage)
      return original
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
    if (graphicImage) {
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

/** Instanced regions supply their scope from their lazy feature chunk. */
export type NativeInstanceOptions =
  | { instance?: undefined; scopeFactory?: undefined }
  | { instance: string; scopeFactory: typeof createInstanceScope }

export function useNativeSurface(
  source: ComponentChild,
  surface: string,
  lang: CmsLang,
  mode: CmsMode,
  instanceOptions: NativeInstanceOptions = {},
): JSX.Element {
  const context = useContext(NativeContext)
  const path = surface.startsWith('my-booking')
    ? '/my-bookings'
    : surface.endsWith('-booking') || surface.startsWith('booking-')
      ? '/booking'
      : surface === 'about'
        ? '/about'
        : '/'
  const page = context?.presentation?.pages.find((candidate) => candidate.path === path)
  const html = context?.source && !context.projectSource ? '' : (page?.content[lang].html ?? '')
  const template = useMemo(() => {
    if (!html || typeof DOMParser === 'undefined') return null
    return new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector(`[data-knc-surface="${surface}"]`)
  }, [html, surface])
  const scope = useMemo(
    () =>
      instanceOptions.instance === undefined
        ? null
        : instanceOptions.scopeFactory(surface, instanceOptions.instance, template),
    [surface, instanceOptions.instance, template, instanceOptions.scopeFactory],
  )
  if (
    !context ||
    (!context.source && !template && !Object.keys(context.presentation?.themes[mode] ?? {}).length)
  )
    return h(Fragment, null, source)
  const native = nativeTree(source, surface, mode)
  const projected = template ? projectNativeTree(native, template, mode) : native.tree
  const output = scope ? scope.tree(projected) : projected
  const css = repairDesktopCss(page?.content[lang].css[mode] ?? '')
  return (
    <>
      {context.presentation && <style>{siteThemeCss(context.presentation, mode)}</style>}
      {template && <style>{scope ? scope.css(css) : css}</style>}
      <RenderContext.Provider value={{ template, mode, scope }}>{output}</RenderContext.Provider>
    </>
  )
}

/** A conditional runtime region with its own editable template on the owning page. */
export function NativeRegion({
  children,
  surface,
  lang,
  mode,
  ...instanceOptions
}: {
  children: JSX.Element
  surface: string
  lang: CmsLang
  mode: CmsMode
} & NativeInstanceOptions): JSX.Element {
  return useNativeSurface(children, surface, lang, mode, instanceOptions)
}
