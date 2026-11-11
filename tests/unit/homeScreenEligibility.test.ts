import { describe, expect, it } from 'vitest'
import {
  OTHER_BROWSER_MARKERS,
  decideHomeScreenGuide,
  type GuideVisitor,
} from '../../modules/public-web/src/onboarding/eligibility'
import {
  guideOffer,
  offersHomeScreenGuide,
  onIphone,
} from '../../modules/public-web/src/onboarding/trigger'

// Who is shown the home-screen guide, and which steps: a pure function of what the page can read.

const safari = (version: string, os = '18_6'): string =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 ` +
  `(KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`

const visitor = (overrides: Partial<GuideVisitor> = {}): GuideVisitor => ({
  userAgent: safari('27.0'),
  standalone: false,
  displayStandalone: false,
  displayFullscreen: false,
  bookings: 3,
  shown: false,
  ...overrides,
})

describe('home-screen guide trigger', () => {
  it.each([
    [0, false],
    [2, false],
    [3, true],
    [4, true],
  ])('offers the guide for %i known bookings: %s', (bookings, offered) => {
    expect(offersHomeScreenGuide(bookings)).toBe(offered)
  })

  it.each([
    ['read after the booking just made', { after: 4, count: 3 }, 4, 3],
    ['of two bookings', { after: 4, count: 2 }, 4, null],
    ['read before the booking just made', { after: 3, count: 5 }, 4, null],
    ['not in yet', null, 4, null],
  ] as const)('offers from a list %s: %s', (_label, listed, completed, offer) => {
    expect(guideOffer(listed, completed)).toBe(offer)
  })

  // The boot path's only device test: it decides whether the guide's chunk is fetched at all.
  it.each([
    ['Safari on iPhone', safari('27.0'), true],
    [
      'Chrome on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      true,
    ],
    [
      'an iPad',
      'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
      false,
    ],
    [
      'a Mac',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
      false,
    ],
    [
      'Android',
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      false,
    ],
    ['an empty agent', '', false],
  ])('counts %s as an iPhone: %s', (_label, userAgent, iphone) => {
    expect(onIphone(userAgent)).toBe(iphone)
  })
})

describe('home-screen guide eligibility', () => {
  it.each([
    ['27.0', 'A'],
    ['27.2.1', 'A'],
    ['28.1', 'A'],
    ['26.0', 'B'],
    ['26.7.3', 'B'],
    ['18.6', 'C'],
    ['17.4', 'C'],
  ] as const)('shows Safari %s variant %s', (version, variant) => {
    expect(decideHomeScreenGuide(visitor({ userAgent: safari(version) }))).toEqual({
      kind: 'show',
      variant,
    })
  })

  it('reads the version from Safari, never from the frozen iPhone OS token', () => {
    expect(decideHomeScreenGuide(visitor({ userAgent: safari('18.6', '26_0') }))).toEqual({
      kind: 'show',
      variant: 'C',
    })
    expect(decideHomeScreenGuide(visitor({ userAgent: safari('27.0', '18_6') }))).toEqual({
      kind: 'show',
      variant: 'A',
    })
  })

  it.each(['19.0', '25.9', 'abc', '2a'])(
    'skips a Safari version that maps to no variant: %s',
    (version) => {
      expect(decideHomeScreenGuide(visitor({ userAgent: safari(version) }))).toEqual({
        kind: 'skip',
        reason: 'unknown-version',
      })
    },
  )

  it('needs more than two bookings: 2 is not enough, 3 is', () => {
    expect(decideHomeScreenGuide(visitor({ bookings: 2 }))).toEqual({
      kind: 'skip',
      reason: 'few-bookings',
    })
    expect(decideHomeScreenGuide(visitor({ bookings: 3 })).kind).toBe('show')
  })

  it('is shown once', () => {
    expect(decideHomeScreenGuide(visitor({ shown: true }))).toEqual({
      kind: 'skip',
      reason: 'shown',
    })
  })

  it.each([
    [
      'an iPad',
      'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
    ],
    [
      'an iPhone asking for the desktop site',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
    ],
    [
      'Android',
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    ],
  ])('skips %s', (_label, userAgent) => {
    expect(decideHomeScreenGuide(visitor({ userAgent }))).toEqual({
      kind: 'skip',
      reason: 'not-iphone',
    })
  })

  it.each([
    [
      'without Version/ (an in-app web view)',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    ],
    [
      'without Safari/',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148',
    ],
    [
      'Chrome, which sends no Version/',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
    ],
  ])('skips a browser %s', (_label, userAgent) => {
    expect(decideHomeScreenGuide(visitor({ userAgent }))).toEqual({
      kind: 'skip',
      reason: 'not-safari',
    })
  })

  it('lists every marker the research names, sourced or not', () => {
    expect([...OTHER_BROWSER_MARKERS].sort()).toEqual(
      [
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
      ].sort(),
    )
  })

  it.each(OTHER_BROWSER_MARKERS)('skips a Safari-like agent that carries %s', (marker) => {
    const userAgent = safari('27.0').replace('Mobile/15E148', `Mobile/15E148 ${marker}/1.0`)
    expect(decideHomeScreenGuide(visitor({ userAgent }))).toEqual({
      kind: 'skip',
      reason: 'not-safari',
    })
  })

  it.each([
    ['navigator.standalone', { standalone: true }],
    ['(display-mode: standalone)', { displayStandalone: true }],
    ['(display-mode: fullscreen)', { displayFullscreen: true }],
  ] as const)('skips the installed web app by %s alone', (_label, flag) => {
    expect(decideHomeScreenGuide(visitor(flag))).toEqual({ kind: 'skip', reason: 'installed' })
  })
})
