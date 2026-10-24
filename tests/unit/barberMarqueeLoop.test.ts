import { describe, expect, it } from 'vitest'
import {
  gaplessLoopFloor,
  loopFloor,
  MAX_FIT_PASSES,
  passFloor,
  type LoopSlide,
} from '../../src/about/useBarberMarquee'

/** Mobile strip slides: equal cards with 24 px margins in a container at x = 0. */
function strip(cards: number, width: number): LoopSlide[] {
  return Array.from({ length: cards }, (_, index) => ({
    left: 24 + index * (width + 48),
    width,
    marginEnd: 24,
  }))
}

/** Slides of these widths after a start gap, each followed by its gap, the last by an end margin. */
function laidOut(
  widths: readonly number[],
  gap: (index: number) => number,
  start: number,
  end: number,
): LoopSlide[] {
  let left = start
  return widths.map((width, index) => {
    const slide = { left, width, marginEnd: end }
    left += width + gap(index)
    return slide
  })
}

/** Cards without margins spread by justify-content: space-between, at offsets rounded like offsetLeft. */
function spread(view: number, cards: number, width: number): LoopSlide[] {
  const gap = Math.max(0, (view - cards * width) / (cards - 1))
  return Array.from({ length: cards }, (_, index) => ({
    left: Math.round(index * (width + gap)),
    width: Math.round(width),
    marginEnd: 0,
  }))
}

/** Embla 8.6 SlideLooper.canLoop over the same offsets (SlideSizes.measureWithGaps). */
function canLoop(view: number, slides: readonly LoopSlide[]): boolean {
  const sizes = slides.map((slide, index) => {
    if (index === 0) return slide.width + slide.left
    if (index === slides.length - 1) return slide.width + slide.marginEnd
    return (slides[index + 1]?.left ?? 0) - slide.left
  })
  const total = sizes.reduce((sum, size) => sum + size, 0)
  return sizes.every((size) => view - (total - size) <= 0.1)
}

describe('loopFloor', () => {
  it('is the smallest whole-pixel card width Embla can loop at 390 px', () => {
    for (const [cards, floor] of [
      [2, 366],
      [3, 171],
      [4, 98],
    ] as const) {
      expect(loopFloor(390, 0, strip(cards, 100))).toBe(floor)
      expect(canLoop(390, strip(cards, floor)), `${cards} cards at ${floor}px`).toBe(true)
      expect(canLoop(390, strip(cards, floor - 1)), `${cards} cards at ${floor - 1}px`).toBe(false)
    }
  })

  it('depends only on the gaps, not on the width the cards have now', () => {
    for (const width of [40, 183, 366])
      expect(loopFloor(768, 0, strip(3, width))).toBe(loopFloor(768, 0, strip(3, 100)))
  })
})

describe('gaplessLoopFloor', () => {
  const views = [320, 390, 401, 768, 1024, 1367]
  const counts = [2, 3, 4, 5, 6, 7, 8]

  it('loops whatever non-negative gaps surround slides at least that wide', () => {
    // No gaps, even gaps, uneven gaps, and one wide gap before the last slide.
    const gaps = (count: number): ((index: number) => number)[] => [
      () => 0,
      () => 7,
      (index) => (index * 13) % 50,
      (index) => (index === count - 2 ? 400 : 1),
    ]
    // Equal slides at the floor, and unequal ones above it.
    const extras: ((index: number) => number)[] = [() => 0, (index) => (index * 37) % 90]
    for (const view of views)
      for (const count of counts) {
        const floor = gaplessLoopFloor(view, count)
        for (const gap of gaps(count))
          for (const start of [0, 24, 300])
            for (const end of [0, 24, 300])
              for (const extra of extras) {
                const widths = Array.from({ length: count }, (_, index) => floor + extra(index))
                expect(
                  canLoop(view, laidOut(widths, gap, start, end)),
                  `${count} slides of ${floor}px or more in ${view} px`,
                ).toBe(true)
              }
      }
  })

  it('is the narrowest such width: a pixel less fails without gaps', () => {
    for (const view of views)
      for (const count of counts) {
        const width = gaplessLoopFloor(view, count) - 1
        const widths = Array.from({ length: count }, () => width)
        expect(
          canLoop(
            view,
            laidOut(widths, () => 0, 0, 0),
          ),
          `${count} slides of ${width}px in ${view} px`,
        ).toBe(false)
      }
  })
})

describe('passFloor', () => {
  it('takes the measured estimate before the last pass, a pixel wider than the floor at least', () => {
    expect(passFloor(0, 0, 390, 0, strip(4, 100))).toBe(98)
    expect(passFloor(0, 120, 390, 0, strip(4, 100))).toBe(121)
  })

  it('ends looping when widening shrinks the distributed gaps', () => {
    // Six 4vw cards spread by space-between in a 768 px strip, re-measured after every pass.
    let floor = 0
    const floors: number[] = []
    for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
      floor = passFloor(pass, floor, 768, 0, spread(768, 6, Math.max(0.04 * 768, floor)))
      floors.push(floor)
    }
    expect(floors).toEqual([84, 122, 154])
    expect(canLoop(768, spread(768, 6, floor))).toBe(true)
    // The estimate alone would stop at 150 px, where the other five slides cover only 750 px.
    expect(loopFloor(768, 0, spread(768, 6, 122))).toBe(150)
    expect(canLoop(768, spread(768, 6, 150))).toBe(false)
  })
})
