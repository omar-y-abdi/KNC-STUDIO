import { h, isValidElement, render, type ComponentChildren, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import type * as PreactHooks from 'preact/hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyPresentation } from '../../shared/cms'
import {
  NativeRegion,
  type NativeInstanceOptions,
  type useNativeSurface,
} from '../../src/cms/NativeSurface'
import { createInstanceScope } from '../../src/cms/instanceScope'

type RegionProps = Parameters<typeof NativeRegion>[0]
type SurfaceOptions = NonNullable<Parameters<typeof useNativeSurface>[4]>

const regionProps = {
  surface: 'my-booking-card',
  lang: 'sv',
  mode: 'light',
  children: h('article', {}),
} as const
// @ts-expect-error An instanced region requires its factory.
void ({ ...regionProps, instance: 'booking/1' } satisfies RegionProps)
// @ts-expect-error A region factory requires its instance.
void ({ ...regionProps, scopeFactory: createInstanceScope } satisfies RegionProps)
// @ts-expect-error The hook also requires the factory with an instance.
void ({ instance: 'booking/1' } satisfies SurfaceOptions)
// @ts-expect-error The hook also requires an instance with its factory.
void ({ scopeFactory: createInstanceScope } satisfies SurfaceOptions)

// Render the region inside a probe that returns null. Preact runs the real memo hooks while
// the node environment needs no host DOM; the emitted VNodes remain inspectable.
vi.mock('preact/hooks', async (original) => ({
  ...(await original<typeof PreactHooks>()),
  useContext: () => ({ presentation: emptyPresentation(), source: true, projectSource: false }),
}))

function nodes(value: ComponentChildren): VNode<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!isValidElement(value)) return []
  const node = value as VNode<Record<string, unknown>>
  return [node, ...nodes(node.props['children'] as ComponentChildren)]
}

const containers: HTMLElement[] = []
// Preact's render compares its parent with `document`, which the node environment lacks.
beforeEach(() => vi.stubGlobal('document', {}))
afterEach(() => {
  for (const container of containers) act(() => render(null, container))
  containers.length = 0
  vi.unstubAllGlobals()
})

function probe() {
  const container = {} as HTMLElement
  containers.push(container)
  let output: ComponentChildren = null
  function Probe(props: Parameters<typeof NativeRegion>[0]) {
    output = NativeRegion(props)
    return null
  }
  return {
    draw(instanceOptions: NativeInstanceOptions = {}) {
      act(() =>
        render(
          h(Probe, {
            surface: 'my-booking-card',
            lang: 'sv',
            mode: 'light',
            ...instanceOptions,
            children: h(
              'article',
              { id: 'owner-card' },
              h('label', { for: 'owner-input' }, 'Owner label'),
              h('input', { id: 'owner-input' }),
            ),
          }),
          container,
        ),
      )
      return nodes(output)
    },
  }
}

describe('NativeRegion scope factory', () => {
  it('uses the supplied factory and shares its scope with nested runtime children', () => {
    const factory = vi.fn(createInstanceScope)
    const rendered = probe().draw({ instance: 'booking/1', scopeFactory: factory })
    expect(factory).toHaveBeenCalledExactlyOnceWith('my-booking-card', 'booking/1', null)
    const inputId = rendered.find((node) => node.type === 'input')?.props['id']
    expect(inputId).toMatch(/^knc-my-booking-card-instance-/)
    expect(rendered.find((node) => node.type === 'label')?.props['for']).toBe(inputId)
    expect(rendered.find((node) => node.props['value'] !== undefined)?.props['value']).toEqual({
      template: null,
      mode: 'light',
      scope: factory.mock.results[0]?.value,
    })
  })

  it('reuses the scope until its instance or injected factory changes', () => {
    const view = probe()
    const factory = vi.fn(createInstanceScope)
    const first = view.draw({ instance: 'booking/1', scopeFactory: factory })
    view.draw({ instance: 'booking/1', scopeFactory: factory })
    expect(factory).toHaveBeenCalledTimes(1)
    const second = view.draw({ instance: 'booking/2', scopeFactory: factory })
    expect(factory).toHaveBeenCalledTimes(2)
    expect(second.find((node) => node.type === 'input')?.props['id']).not.toBe(
      first.find((node) => node.type === 'input')?.props['id'],
    )
    const replacement = vi.fn(createInstanceScope)
    view.draw({ instance: 'booking/2', scopeFactory: replacement })
    expect(replacement).toHaveBeenCalledExactlyOnceWith('my-booking-card', 'booking/2', null)
    view.draw()
    expect(replacement).toHaveBeenCalledTimes(1)
  })

  it('keeps example regions unscoped when the instance and factory are absent', () => {
    const rendered = probe().draw()
    expect(rendered.find((node) => node.type === 'input')?.props['id']).toBe('owner-input')
    expect(rendered.find((node) => node.type === 'label')?.props['for']).toBe('owner-input')
    expect(rendered.find((node) => node.props['value'] !== undefined)?.props['value']).toEqual({
      template: null,
      mode: 'light',
      scope: null,
    })
  })
})
