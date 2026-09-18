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

export function nudgeStyle<T extends ComponentStyle>(
  style: T,
  dx: number,
  dy: number,
  step = 1,
): T {
  const [x, y] = translate(style['translate'])
  return { ...style, translate: `${x + dx * step}px ${y + dy * step}px` } as T
}

export function resetNudgeStyle<T extends ComponentStyle>(style: T): T {
  const next = { ...style } as T
  delete next['translate']
  return next
}
