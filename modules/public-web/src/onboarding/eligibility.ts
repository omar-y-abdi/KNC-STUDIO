import { offersHomeScreenGuide, onIphone } from './trigger'

/** A: Safari 27 and later, B: Safari 26, C: Safari 18 and earlier (design spec, STEPS). */
export type GuideVariant = 'A' | 'B' | 'C'

export type GuideSkip =
  'few-bookings' | 'shown' | 'not-iphone' | 'not-safari' | 'installed' | 'unknown-version'

export type GuideDecision =
  | { readonly kind: 'show'; readonly variant: GuideVariant }
  | { readonly kind: 'skip'; readonly reason: GuideSkip }

export interface GuideVisitor {
  readonly userAgent: string
  /** `navigator.standalone === true`. */
  readonly standalone: boolean
  readonly displayStandalone: boolean
  readonly displayFullscreen: boolean
  /** Bookings this device lists, the one just made included. */
  readonly bookings: number
  readonly shown: boolean
}

/** Other browsers and in-app views on iPhone, the unsourced ones too: a wrong one only hides it. */
export const OTHER_BROWSER_MARKERS = [
  'CriOS',
  'FxiOS',
  'EdgiOS',
  'FBAN',
  'FBAV',
  'LinkedInApp',
  'Brave',
  'Ddg',
  'OPT',
  'YaBrowser',
  'GSA',
  'Instagram',
] as const

// The Safari major; never the `iPhone OS` token, which Safari has frozen since 26.
const SAFARI_MAJOR = /Version\/(\d+)(?:[.\s]|$)/

function variantOf(major: number): GuideVariant | undefined {
  if (major >= 27) return 'A'
  if (major === 26) return 'B'
  return major <= 18 ? 'C' : undefined
}

export function decideHomeScreenGuide(visitor: GuideVisitor): GuideDecision {
  const skip = (reason: GuideSkip): GuideDecision => ({ kind: 'skip', reason })
  const agent = visitor.userAgent
  if (!offersHomeScreenGuide(visitor.bookings)) return skip('few-bookings')
  if (visitor.shown) return skip('shown')
  if (!onIphone(agent)) return skip('not-iphone')
  if (
    !agent.includes('Version/') ||
    !agent.includes('Safari/') ||
    OTHER_BROWSER_MARKERS.some((marker) => agent.includes(marker))
  )
    return skip('not-safari')
  if (visitor.standalone || visitor.displayStandalone || visitor.displayFullscreen)
    return skip('installed')
  const major = SAFARI_MAJOR.exec(agent)?.[1]
  const variant = major === undefined ? undefined : variantOf(Number(major))
  return variant === undefined ? skip('unknown-version') : { kind: 'show', variant }
}
