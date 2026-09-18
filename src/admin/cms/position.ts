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
const NUDGE_OFFSET_ATTRIBUTE = 'data-cms-nudge-offset'
const NUDGE_BASE_TRANSLATE_ATTRIBUTE = 'data-cms-nudge-base-translate'

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

function parseOwnedOffset(value: unknown): [number, number] | null {
  const match = String(value ?? '')
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/)
  return match ? [Number(match[1]), Number(match[2])] : null
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

  const attributes = component.getAttributes()
  const hasOwnedOffset = Object.prototype.hasOwnProperty.call(attributes, NUDGE_OFFSET_ATTRIBUTE)
  const ownedOffset = hasOwnedOffset
    ? parseOwnedOffset(attributes[NUDGE_OFFSET_ATTRIBUTE])
    : ([0, 0] as [number, number])
  if (!ownedOffset) return null

  const nextOffset: [number, number] = [
    ownedOffset[0] + dx * step,
    ownedOffset[1] + dy * step,
  ]

  if (tagOf(component) === 'g') {
    const transform = String(attributes['transform'] ?? '')
    const baseTransform = hasOwnedOffset ? stripOwnedSvgTranslate(transform, ownedOffset) : transform
    if (baseTransform === null) return null
    component.addAttributes({
      transform: [baseTransform, `translate(${nextOffset[0]} ${nextOffset[1]})`]
        .filter(Boolean)
        .join(' '),
      [NUDGE_OFFSET_ATTRIBUTE]: `${nextOffset[0]} ${nextOffset[1]}`,
    })
    return nextOffset
  }

  const hasBaseTranslate = Object.prototype.hasOwnProperty.call(
    attributes,
    NUDGE_BASE_TRANSLATE_ATTRIBUTE,
  )
  if (hasOwnedOffset && !hasBaseTranslate) return null
  const raw = hasOwnedOffset
    ? String(attributes[NUDGE_BASE_TRANSLATE_ATTRIBUTE] ?? '')
    : component.getStyle()['translate']
  const baseRaw = typeof raw === 'string' ? raw : ''
  const base = parseTranslate(baseRaw)
  if (!base) return null

  const x = base[0] + nextOffset[0]
  const y = base[1] + nextOffset[1]
  component.addStyle({ translate: `${x}px ${y}px` })
  component.addAttributes({
    [NUDGE_OFFSET_ATTRIBUTE]: `${nextOffset[0]} ${nextOffset[1]}`,
    [NUDGE_BASE_TRANSLATE_ATTRIBUTE]: baseRaw,
  })
  return [x, y]
}

export function resetComponentPosition(component: Component | null | undefined): boolean {
  if (!component) return false
  const attributes = component.getAttributes()
  if (!Object.prototype.hasOwnProperty.call(attributes, NUDGE_OFFSET_ATTRIBUTE)) return false
  const ownedOffset = parseOwnedOffset(attributes[NUDGE_OFFSET_ATTRIBUTE])
  if (!ownedOffset) return false

  if (tagOf(component) === 'g') {
    const baseTransform = stripOwnedSvgTranslate(String(attributes['transform'] ?? ''), ownedOffset)
    if (baseTransform === null) return false
    if (baseTransform) component.addAttributes({ transform: baseTransform })
    else component.removeAttributes('transform')
    component.removeAttributes(NUDGE_OFFSET_ATTRIBUTE)
    return true
  }

  if (!Object.prototype.hasOwnProperty.call(attributes, NUDGE_BASE_TRANSLATE_ATTRIBUTE)) return false
  const baseRaw = String(attributes[NUDGE_BASE_TRANSLATE_ATTRIBUTE] ?? '')
  if (baseRaw) component.addStyle({ translate: baseRaw })
  else component.removeStyle('translate')
  component.removeAttributes([NUDGE_OFFSET_ATTRIBUTE, NUDGE_BASE_TRANSLATE_ATTRIBUTE])
  return true
}
