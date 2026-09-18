import type { Component } from 'grapesjs'

const LAYOUT_TAGS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'nav',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'span',
  'a',
  'button',
  'img',
  'svg',
  'g',
])
const CONTROL_TAGS = new Set(['input', 'select', 'textarea', 'option', 'form', 'label', 'fieldset'])
const LOW_LEVEL_SVG = new Set([
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
])
const NUDGE_X_PROPERTY = '--cms-nudge-x'
const NUDGE_Y_PROPERTY = '--cms-nudge-y'

function tagOf(component: Component): string {
  return String(component.get('tagName') ?? 'div').toLowerCase()
}

function hasFunctionalHook(component: Component): boolean {
  const attributes = component.getAttributes()
  return Object.keys(attributes).some(
    (name) => name.startsWith('data-') && !name.startsWith('data-cms-'),
  )
}

export function isPositionableComponent(
  component: Component | null | undefined,
): component is Component {
  if (!component) return false
  const tag = tagOf(component)
  const type = component.get('type')
  if (CONTROL_TAGS.has(tag) || LOW_LEVEL_SVG.has(tag) || hasFunctionalHook(component)) return false
  return type === 'image' || type === 'text' || type === 'link' || LAYOUT_TAGS.has(tag)
}

function parseLength(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (text === '0' || text === '+0' || text === '-0') return 0
  const match = text.match(/^(-?\d+(?:\.\d+)?)px$/)
  return match ? Number(match[1]) : null
}

export function parseTranslate(value: unknown): [number, number] | null {
  const text = String(value ?? '').trim()
  if (!text || text === 'none') return [0, 0]
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length > 2) return null
  const x = parseLength(parts[0])
  const y = parseLength(parts[1] ?? '0')
  return x === null || y === null ? null : [x, y]
}

function ownedOffset(style: Record<string, unknown>): [number, number] | null | undefined {
  const hasX = Object.prototype.hasOwnProperty.call(style, NUDGE_X_PROPERTY)
  const hasY = Object.prototype.hasOwnProperty.call(style, NUDGE_Y_PROPERTY)
  if (!hasX && !hasY) return undefined
  if (!hasX || !hasY) return null
  const x = parseLength(style[NUDGE_X_PROPERTY])
  const y = parseLength(style[NUDGE_Y_PROPERTY])
  return x === null || y === null ? null : [x, y]
}

function stripOwnedSvgTranslate(transform: string, offset: [number, number]): string | null {
  const current = transform.trim()
  const suffix = `translate(${offset[0]} ${offset[1]})`
  if (current === suffix) return ''
  if (current.endsWith(` ${suffix}`)) return current.slice(0, -suffix.length).trim()
  return null
}

export function nudgeComponent(
  component: Component | null | undefined,
  dx: number,
  dy: number,
  step = 1,
): [number, number] | null {
  if (
    !isPositionableComponent(component) ||
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(step)
  )
    return null

  const style = component.getStyle() as Record<string, unknown>
  const existingOffset = ownedOffset(style)
  if (existingOffset === null) return null
  const offset = existingOffset ?? [0, 0]
  const nextOffset: [number, number] = [offset[0] + dx * step, offset[1] + dy * step]

  if (tagOf(component) === 'g') {
    const transform = String(component.getAttributes()['transform'] ?? '')
    const baseTransform = existingOffset
      ? stripOwnedSvgTranslate(transform, existingOffset)
      : transform
    if (baseTransform === null) return null
    component.addAttributes({
      transform: [baseTransform, `translate(${nextOffset[0]} ${nextOffset[1]})`]
        .filter(Boolean)
        .join(' '),
    })
    component.addStyle({
      [NUDGE_X_PROPERTY]: `${nextOffset[0]}px`,
      [NUDGE_Y_PROPERTY]: `${nextOffset[1]}px`,
    })
    return nextOffset
  }

  const current = parseTranslate(style['translate'])
  if (!current) return null
  const base: [number, number] = [current[0] - offset[0], current[1] - offset[1]]
  const x = base[0] + nextOffset[0]
  const y = base[1] + nextOffset[1]
  component.addStyle({
    translate: `${x}px ${y}px`,
    [NUDGE_X_PROPERTY]: `${nextOffset[0]}px`,
    [NUDGE_Y_PROPERTY]: `${nextOffset[1]}px`,
  })
  return [x, y]
}

export function resetComponentPosition(component: Component | null | undefined): boolean {
  if (!component) return false
  const style = component.getStyle() as Record<string, unknown>
  const offset = ownedOffset(style)
  if (!offset) return false

  if (tagOf(component) === 'g') {
    const baseTransform = stripOwnedSvgTranslate(
      String(component.getAttributes()['transform'] ?? ''),
      offset,
    )
    if (baseTransform === null) return false
    if (baseTransform) component.addAttributes({ transform: baseTransform })
    else component.removeAttributes('transform')
  } else {
    const current = parseTranslate(style['translate'])
    if (!current) return false
    const base: [number, number] = [current[0] - offset[0], current[1] - offset[1]]
    if (base[0] === 0 && base[1] === 0) component.removeStyle('translate')
    else component.addStyle({ translate: `${base[0]}px ${base[1]}px` })
  }

  component.removeStyle(NUDGE_X_PROPERTY)
  component.removeStyle(NUDGE_Y_PROPERTY)
  return true
}
