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
const CONTROL_TAGS = new Set([
  'input',
  'select',
  'textarea',
  'option',
  'form',
  'label',
  'fieldset',
])
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

interface CssNudgeState {
  kind: 'css'
  baseRaw: string
  baseX: number
  baseY: number
  x: number
  y: number
}

interface SvgNudgeState {
  kind: 'svg'
  baseTransform: string
  x: number
  y: number
}

type NudgeState = CssNudgeState | SvgNudgeState

const nudgeState = new WeakMap<Component, NudgeState>()

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
  if (CONTROL_TAGS.has(tag) || LOW_LEVEL_SVG.has(tag) || hasFunctionalHook(component))
    return false
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

  const existing = nudgeState.get(component)
  if (tagOf(component) === 'g') {
    const current: SvgNudgeState =
      existing?.kind === 'svg'
        ? existing
        : {
            kind: 'svg',
            baseTransform: String(component.getAttributes()['transform'] ?? ''),
            x: 0,
            y: 0,
          }
    const next: SvgNudgeState = {
      ...current,
      x: current.x + dx * step,
      y: current.y + dy * step,
    }
    const translate = next.x || next.y ? `translate(${next.x} ${next.y})` : ''
    const transform = [next.baseTransform, translate].filter(Boolean).join(' ')
    if (transform) component.addAttributes({ transform })
    else component.removeAttributes('transform')
    nudgeState.set(component, next)
    return [next.x, next.y]
  }

  let current: CssNudgeState | null = existing?.kind === 'css' ? existing : null
  if (!current) {
    const raw = component.getStyle()['translate']
    const baseRaw = typeof raw === 'string' ? raw : ''
    const base = parseTranslate(baseRaw)
    if (!base) return null
    current = {
      kind: 'css',
      baseRaw,
      baseX: base[0],
      baseY: base[1],
      x: 0,
      y: 0,
    }
  }
  const next: CssNudgeState = {
    ...current,
    x: current.x + dx * step,
    y: current.y + dy * step,
  }
  const x = next.baseX + next.x
  const y = next.baseY + next.y
  component.addStyle({ translate: `${x}px ${y}px` })
  nudgeState.set(component, next)
  return [x, y]
}

export function resetComponentPosition(component: Component | null | undefined): boolean {
  if (!component) return false
  const current = nudgeState.get(component)
  if (!current) return false

  if (current.kind === 'svg') {
    if (current.baseTransform) component.addAttributes({ transform: current.baseTransform })
    else component.removeAttributes('transform')
  } else if (current.baseRaw) component.addStyle({ translate: current.baseRaw })
  else component.removeStyle('translate')

  nudgeState.delete(component)
  return true
}
