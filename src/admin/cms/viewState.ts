import type { Component, Editor } from 'grapesjs'

export type CmsInspectorTab = 'style' | 'layers' | 'blocks'
export type CmsComponentViewKey =
  | { kind: 'cms'; value: string }
  | { kind: 'id'; value: string }

export interface CmsInspectorScrollState {
  inspector?: number
  styles?: number
  traits?: number
  layers?: number
  blocks?: number
}

export interface CmsEditorViewState {
  selected?: CmsComponentViewKey | null
  coords?: { x: number; y: number }
  scroll?: { x: number; y: number }
  device?: string
  zoom?: number
  tab?: CmsInspectorTab
  compare?: boolean
  inspector: CmsInspectorScrollState
}

interface CaptureOptions {
  device?: string
  zoom?: number
  tab?: CmsInspectorTab | string
  compare?: boolean
  root?: ParentNode | null
}

interface RestoreOptions {
  setTab?: (tab: CmsInspectorTab) => void
  setCompare?: (compare: boolean) => void
  root?: ParentNode | null
}

const storedViews = new Map<string, string>()
const inspectorSelectors: ReadonlyArray<
  readonly [keyof CmsInspectorScrollState, string]
> = [
  ['inspector', '.cms-authored-inspector'],
  ['styles', '#cms-gjs-styles'],
  ['traits', '#cms-gjs-traits'],
  ['layers', '#cms-gjs-layers'],
  ['blocks', '#cms-gjs-blocks'],
]

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeInspectorTab(value: unknown): CmsInspectorTab | undefined {
  return value === 'style' || value === 'layers' || value === 'blocks' ? value : undefined
}

function rootFor(root?: ParentNode | null): ParentNode | null {
  if (root !== undefined) return root
  return typeof document === 'undefined' ? null : document
}

function selector(value: string, name: string): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `[${name}="${escaped}"]`
}

function stableComponentKey(component: Component | null | undefined): CmsComponentViewKey | null {
  if (!component) return null
  const attributes = component.getAttributes?.() ?? {}
  const cms = attributes['data-cms-node']
  if (typeof cms === 'string' && cms) return { kind: 'cms', value: cms }
  const id = attributes['id']
  if (typeof id === 'string' && id) return { kind: 'id', value: id }
  return null
}

function findComponent(editor: Editor, key: CmsComponentViewKey | null | undefined): Component | null {
  if (!key) return null
  const wrapper = editor.getWrapper?.()
  if (!wrapper?.find) return null
  const attribute = key.kind === 'cms' ? 'data-cms-node' : 'id'
  return wrapper.find(selector(key.value, attribute))[0] ?? null
}

export function normalizeViewZoom(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 100
  return Math.min(200, Math.max(25, number))
}

export function captureInspectorScroll(root?: ParentNode | null): CmsInspectorScrollState {
  const scope = rootFor(root)
  if (!scope?.querySelector) return {}
  const state: CmsInspectorScrollState = {}
  for (const [key, css] of inspectorSelectors) {
    const element = scope.querySelector(css)
    if (element && 'scrollTop' in element)
      state[key] = finite((element as HTMLElement).scrollTop)
  }
  return state
}

export function restoreInspectorScroll(
  snapshot: CmsInspectorScrollState | null | undefined,
  root?: ParentNode | null,
): void {
  if (!snapshot) return
  const scope = rootFor(root)
  if (!scope?.querySelector) return
  for (const [key, css] of inspectorSelectors) {
    const element = scope.querySelector(css)
    if (element && 'scrollTop' in element && snapshot[key] !== undefined)
      (element as HTMLElement).scrollTop = finite(snapshot[key])
  }
}

export function captureEditorView(editor: Editor, options: CaptureOptions = {}): CmsEditorViewState {
  const canvas = editor.Canvas
  const frameWindow = canvas?.getWindow?.()
  const rawCoords = canvas?.getCoords?.() ?? { x: 0, y: 0 }
  const rawZoom =
    options.zoom ??
    (typeof canvas?.getZoom === 'function' ? canvas.getZoom() : undefined) ??
    100
  return {
    selected: stableComponentKey(editor.getSelected?.()),
    coords: { x: finite(rawCoords.x), y: finite(rawCoords.y) },
    scroll: {
      x: finite(frameWindow?.scrollX),
      y: finite(frameWindow?.scrollY),
    },
    device: options.device ?? editor.getDevice?.() ?? undefined,
    zoom: normalizeViewZoom(rawZoom),
    tab: normalizeInspectorTab(options.tab),
    compare: options.compare,
    inspector: captureInspectorScroll(options.root),
  }
}

export function restoreEditorView(
  editor: Editor,
  snapshot: CmsEditorViewState | null | undefined,
  options: RestoreOptions = {},
): void {
  if (!snapshot) return

  if (snapshot.device && typeof editor.setDevice === 'function') editor.setDevice(snapshot.device)
  if (snapshot.zoom !== undefined && typeof editor.Canvas?.setZoom === 'function')
    editor.Canvas.setZoom(normalizeViewZoom(snapshot.zoom))

  if (snapshot.coords && typeof editor.Canvas?.setCoords === 'function')
    editor.Canvas.setCoords(finite(snapshot.coords.x), finite(snapshot.coords.y))

  const frameWindow = editor.Canvas?.getWindow?.()
  if (frameWindow && snapshot.scroll && typeof frameWindow.scrollTo === 'function')
    frameWindow.scrollTo(finite(snapshot.scroll.x), finite(snapshot.scroll.y))

  const selected = findComponent(editor, snapshot.selected)
  if (selected) editor.select(selected)
  else if (typeof editor.select === 'function') editor.select(null)

  if (snapshot.tab && options.setTab) options.setTab(snapshot.tab)
  if (typeof snapshot.compare === 'boolean' && options.setCompare)
    options.setCompare(snapshot.compare)
  restoreInspectorScroll(snapshot.inspector, options.root)
}

export function saveEditorViewState(identity: string, state: CmsEditorViewState): void {
  if (!identity) return
  storedViews.set(identity, JSON.stringify(state))
}

export function loadEditorViewState(identity: string): CmsEditorViewState | null {
  const raw = identity ? storedViews.get(identity) : undefined
  if (!raw) return null
  try {
    return JSON.parse(raw) as CmsEditorViewState
  } catch {
    storedViews.delete(identity)
    return null
  }
}

export function clearEditorViewState(identity?: string): void {
  if (identity) storedViews.delete(identity)
  else storedViews.clear()
}
