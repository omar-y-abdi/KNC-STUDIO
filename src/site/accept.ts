/** Negotiate HTML and Markdown according to HTTP Accept preference and q-values. */
interface Entry {
  type: string
  q: number
  specificity: number
  order: number
}
export type Representation = 'html' | 'markdown'

function parseAccept(header: string): Entry[] {
  return header.split(',').flatMap((raw, order) => {
    const [rawType, ...parameters] = raw.trim().split(';')
    const type = rawType?.trim().toLowerCase() ?? ''
    if (!/^(?:\*\/\*|[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+))$/.test(type)) return []
    let q = 1
    for (const parameter of parameters) {
      const value = parameter.trim()
      if (!/^q\s*=/i.test(value)) continue
      const rawQuality = value.slice(value.indexOf('=') + 1).trim()
      const parts = rawQuality.split('.')
      if (
        parts.length > 2 ||
        !['0', '1'].includes(parts[0] ?? '') ||
        (parts[1] !== undefined &&
          (parts[1].length < 1 ||
            parts[1].length > 3 ||
            ![...parts[1]].every((digit) => digit >= '0' && digit <= '9')))
      )
        return []
      const quality = Number(rawQuality)
      if (quality > 1 || !Number.isFinite(quality)) return []
      q = quality
    }
    return [{ type, q, order, specificity: type === '*/*' ? 0 : type.endsWith('/*') ? 1 : 2 }]
  })
}

export function preferredRepresentation(header: string | null): Representation | null {
  if (!header?.trim()) return 'html'
  const entries = parseAccept(header)
  let best: Representation | null = null
  let bestQ = -1
  let bestOrder = Infinity
  for (const [type, representation] of [
    ['text/html', 'html'],
    ['text/markdown', 'markdown'],
  ] as const) {
    // Specific matches override ranges, including a specific q=0 rejection.
    const matches = entries
      .filter((entry) => entry.type === type || entry.type === 'text/*' || entry.type === '*/*')
      .sort((left, right) => right.specificity - left.specificity || left.order - right.order)
    const choice = matches[0]
    if (!choice || choice.q <= 0) continue
    if (choice.q > bestQ || (choice.q === bestQ && choice.order < bestOrder)) {
      best = representation
      bestQ = choice.q
      bestOrder = choice.order
    }
  }
  return best
}

export function varyAccept(headers: Headers): void {
  const existing = headers.get('Vary')
  if (!existing) headers.set('Vary', 'Accept')
  else if (!existing.split(',').some((part) => part.trim().toLowerCase() === 'accept'))
    headers.set('Vary', existing + ', Accept')
}
