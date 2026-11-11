// Spotlight geometry of the staff tutorial. Every expected number is worked out by hand.

import { describe, expect, it } from 'vitest'
import {
  holeBox,
  holePath,
  paddedBox,
  placeCard,
  scrollDelta,
  type Box,
  type Size,
} from '../../modules/staff-admin/src/tour/tourPlacement'

const DESKTOP: Size = { width: 1280, height: 800 }
const DESKTOP_CARD: Size = { width: 320, height: 170 }
const PHONE: Size = { width: 393, height: 659 }
const PHONE_CARD: Size = { width: 361, height: 170 }

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
})

const desktop = (hole: Box, prefer: 'right' | 'bottom' = 'bottom') =>
  placeCard({ hole, card: DESKTOP_CARD, viewport: DESKTOP, topInset: 80, narrow: false, prefer })
const phone = (hole: Box) =>
  placeCard({
    hole,
    card: PHONE_CARD,
    viewport: PHONE,
    topInset: 60,
    narrow: true,
    prefer: 'bottom',
  })

describe('holeBox', () => {
  it('grows the target by 8 px on every side', () => {
    expect(holeBox(box(100, 200, 50, 30), DESKTOP)).toEqual(box(92, 192, 66, 46))
  })

  it('clips 4 px inside the left and top edges', () => {
    // left -8 -> 4, right 0 + 40 + 8 = 48; top -6 -> 4, bottom 2 + 20 + 8 = 30
    expect(holeBox(box(0, 2, 40, 20), PHONE)).toEqual(box(4, 4, 44, 26))
  })

  it('clips 4 px inside the right and bottom edges', () => {
    // right 360 + 33 + 8 = 401 -> 389; bottom 640 + 19 + 8 = 667 -> 655
    expect(holeBox(box(360, 640, 33, 19), PHONE)).toEqual(box(352, 632, 37, 23))
  })

  it('never has a negative size for a target outside the viewport', () => {
    expect(holeBox(box(-200, 100, 50, 20), DESKTOP)).toEqual(box(4, 92, 0, 36))
    expect(holeBox(box(100, 900, 50, 20), DESKTOP)).toEqual(box(92, 796, 66, 0))
    expect(holeBox(box(1400, -300, 50, 20), DESKTOP)).toEqual(box(1276, 4, 0, 0))
  })
})

describe('paddedBox', () => {
  it('grows the target by 8 px on every side, like the hole inside the viewport', () => {
    expect(paddedBox(box(100, 200, 50, 30))).toEqual(box(92, 192, 66, 46))
    expect(paddedBox(box(100, 200, 50, 30))).toEqual(holeBox(box(100, 200, 50, 30), DESKTOP))
  })

  it('keeps the real top and height of a target below the fold', () => {
    // top 900 - 8 = 892, height 20 + 16 = 36; the hole of the same target is clipped to 796 / 0
    expect(paddedBox(box(100, 900, 50, 20))).toEqual(box(92, 892, 66, 36))
  })

  it('keeps a target above or left of the viewport where it is', () => {
    expect(paddedBox(box(-200, -300, 50, 20))).toEqual(box(-208, -308, 66, 36))
  })

  it('grows an empty target to the padding alone', () => {
    expect(paddedBox(box(10, 20, 0, 0))).toEqual(box(2, 12, 16, 16))
  })
})

describe('holePath', () => {
  it('is the viewport rectangle followed by the hole with a 12 px radius', () => {
    expect(holePath(DESKTOP, box(92, 192, 66, 46))).toBe(
      'M0 0H1280V800H0Z' +
        'M104 192H146A12 12 0 0 1 158 204V226A12 12 0 0 1 146 238' +
        'H104A12 12 0 0 1 92 226V204A12 12 0 0 1 104 192Z',
    )
  })

  it('starts with the full viewport rectangle', () => {
    expect(holePath(PHONE, box(10, 10, 40, 40)).startsWith('M0 0H393V659H0ZM')).toBe(true)
  })

  it('caps the radius at half the smaller side', () => {
    expect(holePath(DESKTOP, box(10, 20, 30, 10))).toContain('A5 5 0 0 1 40 25')
    expect(holePath(DESKTOP, box(10, 20, 16, 40))).toContain('A8 8 0 0 1 26 28')
    expect(holePath(DESKTOP, box(10, 20, 30, 10))).not.toContain('A12')
  })

  it('draws a zero-size hole without a negative radius', () => {
    expect(holePath(DESKTOP, box(4, 92, 0, 36))).toBe(
      'M0 0H1280V800H0ZM4 92H4A0 0 0 0 1 4 92V128A0 0 0 0 1 4 128H4A0 0 0 0 1 4 128V92A0 0 0 0 1 4 92Z',
    )
  })
})

describe('placeCard', () => {
  it('goes below when it fits', () => {
    // bottom 260 + 14 + 170 = 444 <= 784; left 400 - 160 = 240; arrow 400 - 240
    expect(desktop(box(300, 200, 200, 60))).toEqual({
      side: 'bottom',
      left: 240,
      top: 274,
      arrow: 160,
    })
  })

  it('fits below exactly at the 16 px bottom margin, not one pixel later', () => {
    // 600 + 14 + 170 = 784 = 800 - 16
    expect(desktop(box(300, 540, 200, 60)).side).toBe('bottom')
    // 601 + 184 = 785: top fits instead (541 - 184 = 357 >= 80)
    expect(desktop(box(300, 541, 200, 60))).toEqual({
      side: 'top',
      left: 240,
      top: 357,
      arrow: 160,
    })
  })

  it('goes above when only the top fits', () => {
    // bottom 750 + 184 > 784; top 600 - 184 = 416 >= 80
    expect(desktop(box(500, 600, 100, 150))).toEqual({
      side: 'top',
      left: 390,
      top: 416,
      arrow: 160,
    })
  })

  it('prefers the right side for a target in the left column of a wide viewport', () => {
    // right 228 + 14 + 320 = 562 <= 1264; centre y 270 - 85 = 185; arrow 270 - 185
    expect(desktop(box(12, 120, 216, 300), 'right')).toEqual({
      side: 'right',
      left: 242,
      top: 185,
      arrow: 85,
    })
  })

  it('takes bottom before right when right is not preferred', () => {
    expect(desktop(box(12, 120, 216, 300), 'bottom')).toEqual({
      side: 'bottom',
      left: 16,
      top: 434,
      arrow: 104,
    })
  })

  it('falls back from a preferred right that does not fit', () => {
    // right 1260 + 334 > 1264; bottom 140 + 184 = 324 fits; left 1230 - 160 = 1070 -> 944
    expect(desktop(box(1200, 100, 60, 40), 'right')).toEqual({
      side: 'bottom',
      left: 944,
      top: 154,
      arrow: 286,
    })
  })

  it('uses right, then left, when neither bottom nor top fits on a wide viewport', () => {
    // centre y 400 - 85 = 315; arrow 400 - 315
    expect(desktop(box(20, 100, 100, 600))).toEqual({
      side: 'right',
      left: 134,
      top: 315,
      arrow: 85,
    })
    // right 1260 + 334 > 1264; left 1000 - 14 - 320 = 666 >= 16
    expect(desktop(box(1000, 100, 260, 600))).toEqual({
      side: 'left',
      left: 666,
      top: 315,
      arrow: 85,
    })
  })

  it('never goes right or left when narrow, even where right would fit', () => {
    const placement = placeCard({
      hole: box(20, 100, 100, 600),
      card: DESKTOP_CARD,
      viewport: DESKTOP,
      topInset: 80,
      narrow: true,
      prefer: 'right',
    })
    // left 70 - 160 = -90 -> 16; top 800 - 16 - 170
    expect(placement).toEqual({ side: 'overlap', left: 16, top: 614, arrow: null })
  })

  it('clamps horizontally at both edges and keeps the arrow 20 px from the card ends', () => {
    // centre x 1263 - 160 = 1103 -> 944; arrow 1263 - 944 = 319 -> 300
    expect(desktop(box(1250, 100, 26, 40))).toEqual({
      side: 'bottom',
      left: 944,
      top: 154,
      arrow: 300,
    })
    // centre x 24 - 180.5 -> 16; arrow 24 - 16 = 8 -> 20
    expect(phone(box(4, 100, 40, 30))).toEqual({ side: 'bottom', left: 16, top: 144, arrow: 20 })
    // centre x 364.5 - 180.5 = 184 -> 16; arrow 364.5 - 16 = 348.5 -> 341
    expect(phone(box(340, 100, 49, 30))).toEqual({
      side: 'bottom',
      left: 16,
      top: 144,
      arrow: 341,
    })
  })

  it('clamps vertically for a side card and tracks the hole centre with the arrow', () => {
    // centre y 105 - 85 = 20 -> 80; arrow 105 - 80 = 25
    expect(desktop(box(12, 90, 216, 30), 'right')).toEqual({
      side: 'right',
      left: 242,
      top: 80,
      arrow: 25,
    })
  })

  it('fits top, right and left exactly at their margins, not one pixel later', () => {
    // top: 244 - 184 = 60 = top inset; 243 - 184 = 59
    expect(phone(box(20, 244, 353, 300))).toEqual({
      side: 'top',
      left: 16,
      top: 60,
      arrow: 180.5,
    })
    expect(phone(box(20, 243, 353, 300)).side).toBe('overlap')
    // right: 930 + 334 = 1264 = 1280 - 16; 931 falls through to left (831 - 334 = 497)
    expect(desktop(box(830, 100, 100, 600))).toEqual({
      side: 'right',
      left: 944,
      top: 315,
      arrow: 85,
    })
    expect(desktop(box(831, 100, 100, 600))).toEqual({
      side: 'left',
      left: 497,
      top: 315,
      arrow: 85,
    })
    // left: 350 - 334 = 16; 349 - 334 = 15, nothing fits (centre x 799.5 - 160)
    expect(desktop(box(350, 100, 900, 600))).toEqual({
      side: 'left',
      left: 16,
      top: 315,
      arrow: 85,
    })
    expect(desktop(box(349, 100, 901, 600))).toEqual({
      side: 'overlap',
      left: 639.5,
      top: 614,
      arrow: null,
    })
  })

  it('overlaps at the bottom with no arrow when nothing fits', () => {
    // bottom 550 + 184 > 643; top 100 - 184 < 60; top 659 - 16 - 170
    expect(phone(box(20, 100, 353, 450))).toEqual({
      side: 'overlap',
      left: 16,
      top: 473,
      arrow: null,
    })
  })

  describe('phone numbers (viewport 393 x 659, card 361 x 170, top inset 60)', () => {
    it('a weekday row: below, the only horizontal position is 16', () => {
      // 360 + 184 = 544 <= 643; centre x 196.5 - 180.5 = 16; arrow 196.5 - 16
      expect(phone(box(20, 300, 353, 60))).toEqual({
        side: 'bottom',
        left: 16,
        top: 374,
        arrow: 180.5,
      })
    })

    it('the open menu: below it', () => {
      // 382 + 184 = 566 <= 643
      expect(phone(box(4, 52, 385, 330))).toEqual({
        side: 'bottom',
        left: 16,
        top: 396,
        arrow: 180.5,
      })
    })

    it('a low target: above it', () => {
      // 540 + 184 = 724 > 643; 420 - 184 = 236 >= 60
      expect(phone(box(20, 420, 353, 120))).toEqual({
        side: 'top',
        left: 16,
        top: 236,
        arrow: 180.5,
      })
    })
  })
})

describe('scrollDelta', () => {
  const desktopDelta = (hole: Box): number =>
    scrollDelta({ hole, cardHeight: 170, viewportHeight: 800, topInset: 80 })

  it('centres hole and card in the free band when they fit', () => {
    // band 92..784 (692); need 60 + 14 + 170 = 244; wanted top 92 + (692 - 244) / 2 = 316
    expect(desktopDelta(box(0, 900, 100, 60))).toBe(584)
    expect(desktopDelta(box(0, 100, 100, 60))).toBe(-216)
  })

  it('aligns the hole with the band top when they do not fit', () => {
    // need 600 + 184 = 784 > 692; wanted top 92
    expect(desktopDelta(box(0, 500, 100, 600))).toBe(408)
  })

  it('is zero when already in place', () => {
    expect(desktopDelta(box(0, 316, 100, 60))).toBe(0)
    expect(desktopDelta(box(0, 92, 100, 600))).toBe(0)
  })

  it('uses the phone band below the header', () => {
    // band 72..643 (571); wanted top 72 + (571 - 244) / 2 = 235.5
    expect(
      scrollDelta({
        hole: box(0, 500, 100, 60),
        cardHeight: 170,
        viewportHeight: 659,
        topInset: 60,
      }),
    ).toBe(264.5)
  })
})
