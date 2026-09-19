import { h, createRef } from 'preact'
import { expect, it, vi } from 'vitest'
import { nativeTree } from '../../src/cms/NativeSurface'

it('keeps original action handlers and refs instead of reconstructing booking behavior', () => {
  const onClick = vi.fn()
  const ref = createRef<HTMLButtonElement>()
  const source = h('button', { onClick, ref, type: 'button' }, 'Book')
  const result = nativeTree(source, 'desktop-home')
  const button = result.nodes.get('knc-desktop-home-0')
  expect(button?.props['onClick']).toBe(onClick)
  expect(button?.ref).toBe(ref)
  expect(button?.props['data-knc-required']).toBe('true')
})

it('keeps keyed native identities attached to the same entity across insertion and reorder', () => {
  const render = (ids: string[]) =>
    nativeTree(
      h(
        'div',
        null,
        ids.map((id) => h('p', { key: id }, id)),
      ),
      'about',
    )
  const before = render(['a', 'b'])
  const after = render(['c', 'b', 'a'])
  for (const [id, node] of before.nodes) {
    if (node.type === 'p')
      expect(after.nodes.get(id)?.props['children']).toEqual(node.props['children'])
  }
})

it('retains a code-owned runtime component as a live slot, not serialized replacement logic', () => {
  const Runtime = () => h('span', null, 'Runtime')
  const runtime = h(Runtime, {})
  const result = nativeTree(h('main', null, runtime), 'desktop-booking')
  expect(result.slots.size).toBe(1)
  expect([...result.slots.values()][0]?.props['children']).toBe(runtime)
})
