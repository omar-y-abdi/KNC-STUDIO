export type ComponentStyle = Record<string, unknown>

function px(value: unknown): number {
  if (typeof value !== 'string') return 0
  const text = value.trim()
  if (!text.endsWith('px')) return 0
  const number = Number(text.slice(0, -2))
  return Number.isFinite(number) ? number : 0
}

function translate(value: unknown): [number, number] {
  const parts = typeof value === 'string' ? value.trim().split(/\s+/) : []
  return [px(parts[0]), px(parts[1] ?? '0px')]
}

export function nudgeStyle(
  style: ComponentStyle,
  dx: number,
  dy: number,
  step = 1,
): ComponentStyle {
  const [x, y] = translate(style['translate'])
  return { ...style, translate: `${x + dx * step}px ${y + dy * step}px` }
}

export function resetNudgeStyle(style: ComponentStyle): ComponentStyle {
  const next = { ...style }
  delete next['translate']
  return next
}
