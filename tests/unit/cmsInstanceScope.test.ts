import { createRef, Fragment, h, type VNode } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { ident } from 'css-tree'
import { createInstanceScope, nativeNodeId } from '../../src/cms/instanceScope'

function fixture() {
  const click = vi.fn()
  const ref = createRef<HTMLButtonElement>()
  const source = h(
    'article',
    { id: 'owner.card' },
    h('label', { for: 'owner.input' }, 'Literal knc-my-booking-card-0'),
    h('input', { id: 'owner.input', 'aria-labelledby': 'owner.label outside' }),
    h('p', { id: 'owner.label' }, 'Owner label'),
    h('button', { id: 'owner.button', key: 'stable-key', ref, onClick: click }, 'Action'),
    h('a', { href: '#owner.input' }, 'Local'),
    h('a', { href: 'https://outside.example/#owner.input' }, 'External'),
    h(
      'svg',
      {},
      h('defs', {}, h('linearGradient', { id: 'paint' })),
      h('rect', { fill: 'url(#paint)' }),
    ),
  )
  return { source, click, ref }
}
function nodes(root: VNode): VNode<Record<string, unknown>>[] {
  return [
    root as VNode<Record<string, unknown>>,
    ...[root.props.children]
      .flat(Infinity)
      .filter((child): child is VNode =>
        Boolean(child && typeof child === 'object' && 'type' in child),
      )
      .flatMap(nodes),
  ]
}

describe('render-time instance identity isolation', () => {
  it('namespaces identities and references without changing content, events, refs or keys', () => {
    const { source, click, ref } = fixture()
    const scope = createInstanceScope('my-booking-card', 'booking/1', null)
    const output = scope.tree(source) as VNode
    const rendered = nodes(output)
    const get = (tag: string) => rendered.find((node) => node.type === tag)?.props
    const inputId = get('input')?.['id']
    expect(get('label')?.['for']).toBe(inputId)
    expect(get('a')?.['href']).toBe(`#${inputId}`)
    expect(rendered.filter((n) => n.type === 'a')[1]?.props['href']).toBe(
      'https://outside.example/#owner.input',
    )
    expect(get('input')?.['aria-labelledby']).toBe(`${get('p')?.['id']} outside`)
    expect(get('label')?.['children']).toBe('Literal knc-my-booking-card-0')
    const button = rendered.find((n) => n.type === 'button')
    expect(button?.key).toBe('stable-key')
    expect(button?.ref).toBe(ref)
    expect(button?.props['onClick']).toBe(click)
    expect(get('rect')?.['fill']).toBe(`url(#${get('linearGradient')?.['id']})`)
    expect(source.props['id']).toBe('owner.card')
  })
  it('rewrites only identifier-bearing CSS tokens, including escaped selectors', () => {
    const scope = createInstanceScope('my-booking-card', '1', null)
    const rendered = nodes(scope.tree(fixture().source) as VNode)
    const input = rendered.find((n) => n.type === 'input')?.props['id']
    const css = scope.css(
      '#owner\\.input,[for="owner.input"],[aria-controls~="owner.input"]{background:url(#paint);content:"knc-my-booking-card-0 #owner.input"} .owner{background:url(https://outside.example/x.svg#paint)}',
    )
    expect(css).toContain(`#${ident.encode(String(input))}`)
    expect(css).toContain(`[for="${input}"]`)
    expect(css).toContain(`[aria-controls~="${input}"]`)
    expect(css).toContain('content:"knc-my-booking-card-0 #owner.input"')
    expect(css).toContain('https://outside.example/x.svg#paint')
  })
  it('keeps long and colliding-looking instance names distinct and IDs bounded', () => {
    const source = fixture().source
    const scoped = ['a/b', 'a_b', 'å', 'a', 'x'.repeat(150)]
      .map((instance) => {
        const scope = createInstanceScope('my-booking-card', instance, null)
        const first = nodes(scope.tree(source) as VNode)
          .map((n) => n.props['id'])
          .filter(Boolean)
        expect(
          nodes(scope.tree(source) as VNode)
            .map((n) => n.props['id'])
            .filter(Boolean),
        ).toEqual(first)
        for (const id of first) expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/)
        return first
      })
      .flat()
    expect(new Set(scoped).size).toBe(scoped.length)
    expect(nativeNodeId('my-booking-card', '0')).toBe('knc-my-booking-card-0')
  })
  it('retains component VNodes instead of executing their render functions', () => {
    const component = vi.fn(() => h('p', {}, 'Child'))
    const child = h(component, { key: 'child' })
    const root = h(Fragment, {}, h('section', { id: 'parent' }, child))
    const output = createInstanceScope('card', '1', null).tree(root) as VNode
    expect(nodes(output).find((n) => n.type === component)).toBe(child)
    expect(component).not.toHaveBeenCalled()
  })
})
