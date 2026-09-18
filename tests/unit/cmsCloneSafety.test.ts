import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  remapClone,
  remapCloneAttributes,
  remapCloneStyle,
  remapSelectorIds,
} from '../../src/admin/cms/cloneSafety'

class FakeComponent {
  attributes: Record<string, string>
  style: Record<string, string>
  children: FakeComponent[]
  model: Record<string, unknown> = {}

  constructor(
    private readonly id: string,
    attributes: Record<string, string> = {},
    style: Record<string, string> = {},
    children: FakeComponent[] = [],
  ) {
    this.attributes = { ...attributes }
    this.style = { ...style }
    this.children = children
  }

  getId(): string {
    return this.id
  }

  getAttributes(): Record<string, string> {
    return { ...this.attributes }
  }

  setAttributes(attributes: Record<string, string>): void {
    this.attributes = { ...attributes }
  }

  getStyle(): Record<string, string> {
    return { ...this.style }
  }

  setStyle(style: Record<string, string>): void {
    this.style = { ...style }
  }

  components(): {
    forEach: (fn: (child: FakeComponent, index: number) => void) => void
    at: (index: number) => FakeComponent | undefined
  } {
    return {
      forEach: (fn) => this.children.forEach(fn),
      at: (index) => this.children[index],
    }
  }

  get(name: string): unknown {
    return this.model[name]
  }

  set(name: string, value: unknown): void {
    this.model[name] = value
  }
}

class FakeRule {
  constructor(
    private readonly selectors: string,
    private style: Record<string, string>,
  ) {}

  getSelectorsString(): string {
    return this.selectors
  }

  getStyle(): Record<string, string> {
    return { ...this.style }
  }

  setStyle(style: Record<string, string>): void {
    this.style = { ...style }
  }

  get(name: string): unknown {
    if (name === 'atRuleType' || name === 'mediaText') return undefined
    return undefined
  }
}

describe('CMS GrapesJS clone safety', () => {
  it('remaps fragment, IDREF, SVG and inline CSS references without mutating the source attributes', () => {
    const ids = new Map([
      ['target', 'target-copy'],
      ['caption', 'caption-copy'],
      ['paint', 'paint-copy'],
      ['blur', 'blur-copy'],
    ])
    const source = {
      href: '#target',
      'aria-labelledby': 'target caption',
      for: 'target',
      fill: 'url(#paint)',
      filter: 'url("#blur")',
      style: 'clip-path:url(#paint);filter:url("#blur")',
      title: 'Keep #target as literal text',
    }
    const original = { ...source }

    const mapped = remapCloneAttributes(source, ids, '/about', 'https://example.test')

    expect(mapped).toMatchObject({
      href: '#target-copy',
      'aria-labelledby': 'target-copy caption-copy',
      for: 'target-copy',
    })
    expect(mapped.fill).toContain('#paint-copy')
    expect(mapped.filter).toContain('#blur-copy')
    expect(mapped.style).toContain('#paint-copy')
    expect(mapped.style).toContain('#blur-copy')
    expect(mapped.title).toBe('Keep #target as literal text')
    expect(source).toEqual(original)
  })

  it('remaps same-page path fragments but leaves another page unchanged', () => {
    const ids = new Map([['target', 'target-copy']])

    expect(
      remapCloneAttributes({ href: '/about#target' }, ids, '/about', 'https://example.test').href,
    ).toBe('/about#target-copy')
    expect(
      remapCloneAttributes({ href: '/booking#target' }, ids, '/about', 'https://example.test').href,
    ).toBe('/booking#target')
  })

  it('regenerates copied DOM IDs before remapping references', () => {
    const originalTarget = new FakeComponent('target-model', { id: 'target' })
    const originalLink = new FakeComponent('link-model', { href: '#target' })
    const original = new FakeComponent('section-model', { id: 'section' }, {}, [
      originalTarget,
      originalLink,
    ])

    const cloneTarget = new FakeComponent('target-clone-model', { id: 'target' })
    const cloneLink = new FakeComponent('link-clone-model', { href: '#target' })
    const clone = new FakeComponent('section-clone-model', { id: 'section' }, {}, [
      cloneTarget,
      cloneLink,
    ])
    const editor = {
      getWrapper: () => ({
        getAttributes: () => ({ 'data-page': '/about' }),
      }),
      Css: {
        getAll: () => ({ models: [] }),
        setRule: () => undefined,
      },
    }

    remapClone(original as never, clone as never, editor as never, {
      origin: 'https://example.test',
    })

    expect(clone.attributes.id).not.toBe('section')
    expect(cloneTarget.attributes.id).not.toBe('target')
    expect(cloneLink.attributes.href).toBe(`#${cloneTarget.attributes.id}`)
    expect(original.attributes.id).toBe('section')
    expect(originalTarget.attributes.id).toBe('target')
    expect(originalLink.attributes.href).toBe('#target')
  })

  it('remaps ID selectors and url references in component CSS values', () => {
    const ids = new Map([
      ['target', 'target-copy'],
      ['paint', 'paint-copy'],
    ])

    expect(remapSelectorIds('#target > .card:is(#target)', ids)).toBe(
      '#target-copy>.card:is(#target-copy)',
    )
    expect(
      remapCloneStyle(
        {
          color: '#fff',
          background: 'linear-gradient(#fff,#000)',
          filter: 'url(#paint)',
        },
        ids,
      ),
    ).toEqual({
      color: '#fff',
      background: 'linear-gradient(#fff,#000)',
      filter: 'url(#paint-copy)',
    })
  })

  it('makes a cloned subtree self-contained and copies ID-based CSS to cloned selectors', () => {
    const originalTarget = new FakeComponent('target', { id: 'target' })
    const originalLink = new FakeComponent('jump', { id: 'jump', href: '#target' })
    const originalLabel = new FakeComponent('label', {
      id: 'label',
      'aria-labelledby': 'target',
    })
    const originalPaint = new FakeComponent('paint', { id: 'paint' })
    const originalRect = new FakeComponent('rect', { fill: 'url(#paint)' })
    const original = new FakeComponent(
      'section',
      { id: 'section', 'data-cms-node': 'stable-original' },
      {},
      [originalTarget, originalLink, originalLabel, originalPaint, originalRect],
    )

    const cloneTarget = new FakeComponent('target-copy', { id: 'target-copy' })
    const cloneLink = new FakeComponent('jump-copy', { id: 'jump-copy', href: '#target' })
    const cloneLabel = new FakeComponent('label-copy', {
      id: 'label-copy',
      'aria-labelledby': 'target',
    })
    const clonePaint = new FakeComponent('paint-copy', { id: 'paint-copy' })
    const cloneRect = new FakeComponent('rect-copy', { fill: 'url(#paint)' })
    const clone = new FakeComponent(
      'section-copy',
      { id: 'section-copy', 'data-cms-node': 'stable-original' },
      {},
      [cloneTarget, cloneLink, cloneLabel, clonePaint, cloneRect],
    )

    const rules = [new FakeRule('#target', { color: 'rgb(201,32,17)' })]
    const createdRules: Array<{ selector: string; style: Record<string, string> }> = []
    const editor = {
      getWrapper: () => ({
        getAttributes: () => ({ 'data-page': '/about' }),
      }),
      Css: {
        getAll: () => ({ models: rules }),
        setRule: (selector: string, style: Record<string, string>) => {
          createdRules.push({ selector, style: { ...style } })
        },
      },
    }

    remapClone(original as never, clone as never, editor as never, {
      origin: 'https://example.test',
    })

    expect(cloneLink.attributes.href).toBe('#target-copy')
    expect(cloneLabel.attributes['aria-labelledby']).toBe('target-copy')
    expect(cloneRect.attributes.fill).toContain('#paint-copy')
    expect(clone.attributes['data-cms-node']).not.toBe('stable-original')
    expect(clone.model['cmsCloneIdentity']).toEqual(expect.any(String))
    expect(original.attributes['data-cms-node']).toBe('stable-original')
    expect(originalLink.attributes.href).toBe('#target')
    expect(originalRect.attributes.fill).toBe('url(#paint)')
    expect(createdRules).toContainEqual({
      selector: '#target-copy',
      style: { color: 'rgb(201,32,17)' },
    })

    const cloneReferences = [
      cloneLink.attributes.href,
      cloneLabel.attributes['aria-labelledby'],
      cloneRect.attributes.fill,
    ].join(' ')
    expect(cloneReferences).not.toMatch(/#(?:target|paint)(?!-copy)/)
  })

  it('is installed in the GrapesJS editor clone lifecycle', () => {
    const editorSource = readFileSync(resolve('src/admin/cms/AuthoredEditor.tsx'), 'utf8')
    expect(editorSource).toContain("import { installCloneSafety } from './cloneSafety'")
    expect(editorSource).toContain('installCloneSafety(gjs)')
  })
})
