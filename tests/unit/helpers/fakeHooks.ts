import { vi } from 'vitest'

type Effect = () => undefined | (() => void)

export const hooks = {
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  effects: [] as Effect[],
}

export const useState = vi.fn((initial: unknown) => {
  const index = hooks.cursor++
  if (!(index in hooks.values))
    hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
  return [
    hooks.values[index],
    vi.fn((next: unknown) => {
      hooks.values[index] =
        typeof next === 'function'
          ? (next as (previous: unknown) => unknown)(hooks.values[index])
          : next
    }),
  ] as const
})

export const useRef = (current: unknown): { current: unknown } =>
  (hooks.refs[hooks.refCursor++] ??= { current })
export const useEffect = vi.fn((effect: Effect) => {
  hooks.effects.push(effect)
})
// These tests mount passive effects explicitly and leave layout effects inert.
export const useLayoutEffect = vi.fn()
export const useMemo = <T>(factory: () => T): T => factory()
export const useCallback = <T>(callback: T): T => callback
export const useContext = () => null

export function reset(): void {
  hooks.values = []
  hooks.refs = []
  hooks.cursor = 0
  hooks.refCursor = 0
  hooks.effects = []
  useState.mockClear()
  useEffect.mockClear()
  useLayoutEffect.mockClear()
}

export function render<T>(component: () => T): T {
  hooks.cursor = 0
  hooks.refCursor = 0
  hooks.effects = []
  return component()
}

export function mount(): () => void {
  const cleanups = hooks.effects.map((effect) => effect())
  return () => {
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
  }
}

export function ref(index: number, value: unknown): void {
  const target = hooks.refs[index]
  if (!target) throw new Error(`Missing component ref ${index}`)
  target.current = value
}

export interface RenderedNode {
  readonly type: unknown
  readonly props: { readonly children?: unknown; readonly [key: string]: unknown }
}

export function nodes(node: unknown, options: { expandComponents?: boolean } = {}): RenderedNode[] {
  if (Array.isArray(node)) return node.flatMap((child: unknown) => nodes(child, options))
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as RenderedNode
  if (options.expandComponents && typeof vnode.type === 'function') {
    const component = vnode.type as (props: RenderedNode['props']) => unknown
    return nodes(component(vnode.props), options)
  }
  return [vnode, ...nodes(vnode.props?.children, options)]
}
