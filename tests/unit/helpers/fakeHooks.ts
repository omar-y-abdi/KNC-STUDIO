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

type Deps = readonly unknown[] | undefined

/** An effect `commit()` ran: the dependencies it ran with and the cleanup it handed back. */
interface CommittedEffect {
  readonly deps: Deps
  readonly cleanup: (() => void) | undefined
}

/** The dependency list each effect of the last render was given, in call order. */
let effectDeps: Deps[] = []
/** What `commit()` left running, in call order. */
let committed: readonly CommittedEffect[] = []

export const useRef = (current: unknown): { current: unknown } =>
  (hooks.refs[hooks.refCursor++] ??= { current })
export const useEffect = vi.fn((effect: Effect, deps?: readonly unknown[]) => {
  hooks.effects.push(effect)
  effectDeps.push(deps)
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
  effectDeps = []
  committed = []
  useState.mockClear()
  useEffect.mockClear()
  useLayoutEffect.mockClear()
}

export function render<T>(component: () => T): T {
  hooks.cursor = 0
  hooks.refCursor = 0
  hooks.effects = []
  effectDeps = []
  return component()
}

export function mount(): () => void {
  const cleanups = hooks.effects.map((effect) => effect())
  return () => {
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
  }
}

function sameDeps(before: Deps, now: Deps): boolean {
  if (before === undefined || now === undefined || before.length !== now.length) return false
  return before.every((value, index) => Object.is(value, now[index]))
}

/**
 * Run the effects of the last render the way the renderer does after each render, where `mount()`
 * runs all of them once. An effect whose dependencies are the ones it last ran with is left alone.
 * Any other effect is cleaned up, when it ran before, and runs again. An effect that ran before and
 * was not rendered this time is cleaned up: its component is gone. Effects are told apart by the
 * order they were rendered in; state and refs of a component that is gone stay as they were.
 */
export function commit(): void {
  const before = committed
  const kept = hooks.effects.map((_, index) => {
    const earlier = before[index]
    return earlier !== undefined && sameDeps(earlier.deps, effectDeps[index]) ? earlier : null
  })
  before.forEach((earlier, index) => {
    if (kept[index] !== earlier) earlier.cleanup?.()
  })
  committed = hooks.effects.map((effect, index) => {
    const earlier = kept[index]
    if (earlier !== null && earlier !== undefined) return earlier
    const cleanup = effect()
    return { deps: effectDeps[index], cleanup: typeof cleanup === 'function' ? cleanup : undefined }
  })
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
