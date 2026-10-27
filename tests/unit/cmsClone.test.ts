import type { Component } from 'grapesjs'
import { describe, expect, it } from 'vitest'
import { cloneComponent } from '../../src/admin/cms/clone'

// Only the component model operations cloneComponent uses; no editor or browser is needed.
class Model {
  readonly attributes: Record<string, string>
  readonly children: Model[]
  readonly style: Record<string, string>

  constructor(
    attributes: Record<string, string> = {},
    children: Model[] = [],
    style: Record<string, string> = {},
  ) {
    this.attributes = attributes
    this.children = children
    this.style = style
  }
  clone(): Model {
    return new Model(
      { ...this.attributes },
      this.children.map((child) => child.clone()),
      {
        ...this.style,
      },
    )
  }
  components(): Model[] {
    return this.children
  }
  getAttributes(): Record<string, string> {
    return this.attributes
  }
  addAttributes(patch: Record<string, string>): void {
    Object.assign(this.attributes, patch)
  }
  removeAttributes(names: readonly string[]): void {
    for (const name of names) Reflect.deleteProperty(this.attributes, name)
  }
  getStyle(): Record<string, string> {
    return this.style
  }
  addStyle(patch: Record<string, string>): void {
    Object.assign(this.style, patch)
  }
}

function copy(model: Model): Model {
  return cloneComponent(model as unknown as Component) as unknown as Model
}

describe('CMS component copies', () => {
  it('remaps nested IDs and every internal link, ARIA, label and CSS reference without changing the source', () => {
    const source = new Model({ id: 'card' }, [
      new Model({ id: 'title' }),
      new Model({ id: 'description' }),
      new Model({ id: 'input' }),
      new Model({ id: 'clip' }),
      new Model(
        {
          href: '#title',
          'xlink:href': '#clip',
          'aria-labelledby': 'title external',
          'aria-describedby': 'description',
          'aria-controls': 'input',
          for: 'input',
          fill: 'url("#clip")',
        },
        [],
        { clipPath: "url('#clip')", color: 'red' },
      ),
    ])
    const before = JSON.stringify(source)
    const cloned = copy(source)
    const [title, description, input, clip, linked] = cloned.children
    const ids = [cloned, title, description, input, clip].map((node) => node?.attributes.id)
    expect(ids.every((id) => typeof id === 'string' && id.startsWith('cms-copy-'))).toBe(true)
    expect(new Set(ids).size).toBe(5)
    expect(linked?.attributes).toEqual({
      href: `#${title?.attributes.id}`,
      'xlink:href': `#${clip?.attributes.id}`,
      'aria-labelledby': `${title?.attributes.id} external`,
      'aria-describedby': description?.attributes.id,
      'aria-controls': input?.attributes.id,
      for: input?.attributes.id,
      fill: `url(#${clip?.attributes.id})`,
    })
    expect(linked?.style).toEqual({ clipPath: `url(#${clip?.attributes.id})`, color: 'red' })
    expect(JSON.stringify(source)).toBe(before)
    expect(copy(source).attributes.id).not.toBe(cloned.attributes.id)
  })

  it('preserves external references and strips runtime ownership from the entire copy', () => {
    const runtime = {
      'data-knc-source': 'source',
      'data-knc-required': 'required',
      'data-knc-slot': 'slot',
      'data-knc-surface': 'surface',
      'data-knc-native': 'native',
    }
    const cloned = copy(
      new Model({ ...runtime, id: 'root' }, [
        new Model({
          ...runtime,
          href: 'https://example.test/#root',
          'aria-labelledby': 'external',
          fill: 'url(#external)',
          title: 'Owner title',
        }),
      ]),
    )
    expect(Object.keys(cloned.attributes)).toEqual(['id'])
    expect(cloned.children[0]?.attributes).toEqual({
      href: 'https://example.test/#root',
      'aria-labelledby': 'external',
      fill: 'url(#external)',
      title: 'Owner title',
    })
  })
})
