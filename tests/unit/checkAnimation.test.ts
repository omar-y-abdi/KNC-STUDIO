import { describe, expect, it, vi } from 'vitest'
import {
  CHECK_LAND,
  DISC_POP,
  checkMoves,
  checkTargets,
  discRipple,
  inkOf,
  playCheck,
} from '../../modules/public-web/src/booking/checkAnimation'

// The confirmation's check entrance: when it plays, which elements it finds, and what it plays.

interface Stub {
  readonly tagName: string
  readonly childElementCount: number
  readonly firstElementChild: Stub | null
  readonly previousElementSibling: Stub | null
  readonly querySelector: (selector: string) => Stub | null
  readonly animate: ReturnType<typeof vi.fn>
}

function stub(tagName: string, children: readonly Stub[] = [], previous: Stub | null = null): Stub {
  return {
    tagName,
    childElementCount: children.length,
    firstElementChild: children[0] ?? null,
    previousElementSibling: previous,
    querySelector: () => null,
    animate: vi.fn(() => ({})),
  }
}

/** A card holding `disc` right above the title with id `title`. */
function cardWith(disc: Stub | null, title = 'knc-booked-title'): Element {
  const heading = stub('DIV', [], disc)
  const card = {
    ...stub('DIV'),
    querySelector: (selector: string) => (selector === `[id="${title}"]` ? heading : null),
  }
  // A stand-in for the few Element members the lookup reads.
  return card as unknown as Element
}

describe('check entrance', () => {
  it.each([
    ['animate', 'full', 'site', true],
    ['still', 'full', 'site', false],
    ['animate', 'reduced', 'site', false],
    ['animate', 'full', 'source', false],
  ] as const)('plays for %s, %s motion, %s frame: %s', (entrance, motion, frame, plays) => {
    expect(checkMoves(entrance, motion, frame)).toBe(plays)
  })

  it.each([
    ['rgb(28, 28, 30)', '28,28,30'],
    ['rgb(245, 245, 247)', '245,245,247'],
    ['rgba(28, 28, 30, 0.5)', '28,28,30'],
    ['rgb(28 28 30)', '28,28,30'],
    ['rgb(28 28 30 / 0.5)', '28,28,30'],
  ])('reads the ink of %s', (color, ink) => {
    expect(inkOf(color)).toBe(ink)
  })

  it.each([
    '',
    'transparent',
    'color(srgb 0.1 0.1 0.1)',
    'rgb(256, 0, 0)',
    'rgb(1.5, 2, 3)',
    'rgb(1234, 5, 6)',
  ])('has no ink for %j', (color) => {
    expect(inkOf(color)).toBeUndefined()
  })

  it('finds the disc right above the title and the check image inside it', () => {
    const check = stub('IMG')
    const disc = stub('DIV', [check])
    expect(checkTargets(cardWith(disc), 'knc-booked-title')).toEqual({ disc, check })
  })

  it.each([
    ['no title', () => cardWith(stub('DIV', [stub('IMG')]), 'another-title')],
    ['nothing above the title', () => cardWith(null)],
    ['another element above the title', () => cardWith(stub('P', [stub('IMG')]))],
    ['a disc that holds more', () => cardWith(stub('DIV', [stub('IMG'), stub('SPAN')]))],
    ['a disc without the image', () => cardWith(stub('DIV', [stub('SPAN')]))],
  ])('finds nothing once a presentation has rearranged it: %s', (_label, card) => {
    expect(checkTargets(card(), 'knc-booked-title')).toBeUndefined()
  })

  it('pops the disc, ripples it in the ink and lands the check, each once', () => {
    const check = stub('IMG')
    const disc = stub('DIV', [check])
    const targets = { disc: disc as unknown as Element, check: check as unknown as Element }
    expect(playCheck(targets, '28,28,30')).toHaveLength(3)
    expect(disc.animate.mock.calls).toEqual([
      [DISC_POP.keyframes, DISC_POP.timing],
      [discRipple('28,28,30').keyframes, discRipple('28,28,30').timing],
    ])
    expect(check.animate.mock.calls).toEqual([[CHECK_LAND.keyframes, CHECK_LAND.timing]])
  })

  it('leaves the ripple out without an ink', () => {
    const check = stub('IMG')
    const disc = stub('DIV', [check])
    const targets = { disc: disc as unknown as Element, check: check as unknown as Element }
    expect(playCheck(targets, undefined)).toHaveLength(2)
    expect(disc.animate.mock.calls).toEqual([[DISC_POP.keyframes, DISC_POP.timing]])
    expect(check.animate).toHaveBeenCalledOnce()
  })

  // The decided design (design spec section 2), value by value.
  it('plays the designed keyframes and timings', () => {
    expect(DISC_POP).toEqual({
      keyframes: [
        {
          offset: 0,
          transform: 'scale(0.3)',
          opacity: 0,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
        { offset: 0.55, transform: 'scale(1.12)', opacity: 1, easing: 'ease-in-out' },
        { offset: 0.78, transform: 'scale(0.96)', opacity: 1, easing: 'ease-out' },
        { offset: 1, transform: 'scale(1)', opacity: 1 },
      ],
      timing: { delay: 140, duration: 560, fill: 'backwards', easing: 'linear' },
    })
    expect(discRipple('245,245,247')).toEqual({
      keyframes: [
        { offset: 0, boxShadow: '0 0 0 0 rgba(245,245,247,0.30), 0 0 0 0 rgba(245,245,247,0.16)' },
        { offset: 1, boxShadow: '0 0 0 14px rgba(245,245,247,0), 0 0 0 28px rgba(245,245,247,0)' },
      ],
      timing: {
        delay: 440,
        duration: 700,
        fill: 'none',
        easing: 'cubic-bezier(0.16, 0.84, 0.3, 1)',
      },
    })
    expect(CHECK_LAND).toEqual({
      keyframes: [
        { offset: 0, clipPath: 'inset(0 100% 0 0)', transform: 'scale(0.6)' },
        { offset: 0.6, clipPath: 'inset(0 0 0 0)', transform: 'scale(1.14)' },
        { offset: 1, clipPath: 'inset(0 0 0 0)', transform: 'scale(1)' },
      ],
      timing: {
        delay: 360,
        duration: 460,
        fill: 'backwards',
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    })
  })
})
