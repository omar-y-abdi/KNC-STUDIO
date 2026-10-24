import { describe, expect, it } from 'vitest'
import { loopFloor, type LoopSlide } from '../../src/about/useBarberMarquee'

/** Mobile strip slides: equal cards with 24 px margins in a container at x = 0. */
function strip(cards: number, width: number): LoopSlide[] {
  return Array.from({ length: cards }, (_, index) => ({
    left: 24 + index * (width + 48),
    width,
    marginEnd: 24,
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
