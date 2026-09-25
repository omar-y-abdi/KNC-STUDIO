import { nativeNodeId } from './cms-native-id'
import type { ResourceDestination } from './cms-resource-assignment'

type Attributes = Readonly<Record<string, unknown>>
/** One identity-based resolver shared by the canvas and the website inventory.
 * The chain starts at the graphic and ends at its outermost ancestor. */
export function resourceTarget(
  chain: readonly Attributes[],
  people: readonly { id: string }[],
): ResourceDestination | undefined {
  const graphic = chain[0]
  if (!graphic) return undefined
  for (let index = 1; index < chain.length; index++) {
    const parent = chain[index]
    if (parent?.['data-knc-fold'] !== 'barber-marquee') continue
    const source = String(parent['data-knc-source'] ?? '')
    if (!source.startsWith('knc-about-')) return undefined
    const child = chain[index - 1]?.['data-knc-source']
    const person = people.find(({ id }) => {
      const key = id
        .split('')
        .map((char) => char.charCodeAt(0).toString(16))
        .join('x')
      return child === nativeNodeId('about', `${source.slice('knc-about-'.length)}-k${key}`)
    })
    return person ? { purpose: 'profile', barberId: person.id } : undefined
  }
  if (
    graphic['data-knc-source'] &&
    ['0 0 460 258', '0 0 460 330'].includes(String(graphic['viewBox'] ?? graphic['viewbox'] ?? ''))
  )
    return { purpose: 'logo' }
  try {
    const path = new URL(String(graphic['src'] ?? ''), 'https://site.invalid').pathname
    const gallery = path.match(/\/storage\/v1\/object\/public\/gallery\/(salon|cuts|logo)\//)
    if (gallery) return { purpose: gallery[1] as 'salon' | 'cuts' | 'logo' }
    const profile = path.match(/\/storage\/v1\/object\/public\/barber-photos\/([a-z0-9-]+)\//)
    if (profile?.[1] && people.some((person) => person.id === profile[1]))
      return { purpose: 'profile', barberId: profile[1] }
  } catch {
    /* Invalid URLs cannot identify a destination. */
  }
  return undefined
}
