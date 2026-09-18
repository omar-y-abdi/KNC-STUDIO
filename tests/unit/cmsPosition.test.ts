import { describe, expect, it } from 'vitest'
import {
  isPositionableComponent,
  nudgeComponent,
  parseTranslate,
  resetComponentPosition,
} from '../../src/admin/cms/position'

type Positionable = Parameters<typeof nudgeComponent>[0]

interface MockComponent {
  tag: string
  type: string
  style: Record<string, string>
  attributes: Record<string, string>
  get: (key: string) => unknown
  getStyle: () => Record<string, string>
  addStyle: (style: Record<string, string>) => void
  removeStyle: (property: string) => void
  getAttributes: () => Record<string, string>
  addAttributes: (attributes: Record<string, string>) => void
  removeAttributes: (attribute: string) => void
}

function mockComponent({
  tag = 'div',
  type = '',
  style = {},
  attributes = {},
}: {
  tag?: string
  type?: string
  style?: Record<string, string>
  attributes?: Record<string, string>
} = {}): MockComponent {
  const component: MockComponent = {
    tag,
    type,
    style: { ...style },
    attributes: { ...attributes },
    get(key) {
      if (key === 'tagName') return component.tag
      if (key === 'type') return component.type
      return undefined
    },
    getStyle: () => component.style,
    addStyle(next) {
      Object.assign(component.style, next)
    },
    removeStyle(property) {
      delete component.style[property]
    },
    getAttributes: () => component.attributes,
    addAttributes(next) {
      Object.assign(component.attributes, next)
    },
    removeAttributes(attribute) {
      delete component.attributes[attribute]
    },
  }
  return component
}

function positionable(component: MockComponent): NonNullable<Positionable> {
  return component as unknown as NonNullable<Positionable>
}

describe('CMS GrapesJS component positioning', () => {
  it('parses pixel translations without treating unsupported units as zero', () => {
    expect(parseTranslate('none')).toEqual([0, 0])
    expect(parseTranslate('4px -2px')).toEqual([4, -2])
    expect(parseTranslate('0 6px')).toEqual([0, 6])
    expect(parseTranslate('10% 0')).toBeNull()
  })

  it('accumulates 1 px and Shift-style 10 px nudges without touching transform', () => {
    const component = mockComponent({ style: { transform: 'rotate(18deg) scale(1.1)' } })

    expect(nudgeComponent(positionable(component), 1, 0)).toEqual([1, 0])
    expect(nudgeComponent(positionable(component), 0, -1, 10)).toEqual([1, -10])

    expect(component.style['translate']).toBe('1px -10px')
    expect(component.style['transform']).toBe('rotate(18deg) scale(1.1)')
  })

  it('restores a pre-existing individual translate instead of deleting it', () => {
    const component = mockComponent({
      style: { translate: '3px 4px', transform: 'skewX(8deg)' },
    })

    expect(nudgeComponent(positionable(component), 1, 0)).toEqual([4, 4])
    expect(resetComponentPosition(positionable(component))).toBe(true)

    expect(component.style['translate']).toBe('3px 4px')
    expect(component.style['transform']).toBe('skewX(8deg)')
  })

  it('rejects functional runtime hooks without mutating their presentation', () => {
    const component = mockComponent({ attributes: { 'data-booking-action': 'submit' } })

    expect(isPositionableComponent(positionable(component))).toBe(false)
    expect(nudgeComponent(positionable(component), 1, 0)).toBeNull()
    expect(component.style).toEqual({})
  })

  it('preserves an SVG group transform exactly when nudge is reset', () => {
    const component = mockComponent({
      tag: 'g',
      attributes: { transform: 'rotate(15 5 5) scale(2)' },
    })

    expect(nudgeComponent(positionable(component), 1, 0)).toEqual([1, 0])
    expect(nudgeComponent(positionable(component), 0, 1, 10)).toEqual([1, 10])
    expect(component.attributes['transform']).toBe('rotate(15 5 5) scale(2) translate(1 10)')

    expect(resetComponentPosition(positionable(component))).toBe(true)
    expect(component.attributes['transform']).toBe('rotate(15 5 5) scale(2)')
  })

  it('does not reset translation it did not create in the current editor session', () => {
    const component = mockComponent({ style: { translate: '8px 9px' } })

    expect(resetComponentPosition(positionable(component))).toBe(false)
    expect(component.style['translate']).toBe('8px 9px')
  })
})
