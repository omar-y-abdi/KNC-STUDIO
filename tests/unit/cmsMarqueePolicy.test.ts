import { describe, expect, it } from 'vitest'
import { deniedProperty, runtimeOwnedRole } from '../../src/admin/cms/editorPolicy'
import { marqueeCardStyle, minLoopScale } from '../../src/admin/cms/hierarchicalResize'

const motion = [
  'all',
  'transform',
  'translate',
  'rotate',
  'scale',
  'zoom',
  'overflow',
  'overflow-x',
]
const sizing = ['width', 'height', 'min-width', 'max-height', 'flex-basis', 'inline-size']

const stripNode = { 'data-knc-fold': 'barber-marquee', 'data-knc-source': 'knc-about-0-i0-i6' }
const stripRole = runtimeOwnedRole(stripNode)
const cardRole = runtimeOwnedRole({ 'data-knc-source': 'knc-about-0-i0-i6-k6b' }, stripNode)

describe('runtimeOwnedRole', () => {
  it('locks the motion properties of the barber strip and of its cards only', () => {
    for (const role of [stripRole, cardRole]) {
      expect(role?.resizable).toBe(true)
      for (const property of [...motion, 'overflow-y', 'display'])
        expect(role?.denied).toContain(property)
    }
    expect(runtimeOwnedRole({ id: 'portrait' }, stripNode)).toBeNull()
    expect(runtimeOwnedRole({ 'data-knc-source': 'knc-about-0-i0-i6-k6b-i0' })).toBeNull()
  })

  it('leaves the card sizes and the strip height to the owner and the resize handles', () => {
    for (const property of sizing) expect(cardRole?.denied).not.toContain(property)
    for (const property of ['height', 'max-height', 'flex-basis', 'margin', 'gap'])
      expect(stripRole?.denied).not.toContain(property)
    for (const property of ['width', 'flex-wrap']) expect(cardRole?.denied).not.toContain(property)
  })

  // The gapless loop floor needs the cards in one row and a strip width that does not follow them.
  it.each([
    'width',
    'inline-size',
    'min-width',
    'min-inline-size',
    'max-width',
    'max-inline-size',
    'float',
    'position',
    'flex-direction',
    'flex-wrap',
    'flex-flow',
    'writing-mode',
  ])('denies %s on the strip', (property) => {
    expect(stripRole?.denied).toContain(property)
  })

  // Cards must not overlap or end on a negative margin, nor transition the inline floor.
  it.each([
    'margin',
    'margin-left',
    'margin-right',
    'margin-inline',
    'margin-inline-start',
    'margin-inline-end',
    'position',
    'transition',
    'transition-property',
  ])('denies %s on a barber card', (property) => {
    expect(cardRole?.denied).toContain(property)
  })

  it('also locks the size of the gallery row, track and tiles and their resize handles', () => {
    for (const fold of ['gallery-row', 'gallery-track', 'gallery-tile']) {
      const role = runtimeOwnedRole({ 'data-knc-fold': fold, 'data-knc-source': fold })
      expect(role?.resizable).toBe(false)
      for (const property of [...motion, ...sizing, 'max-width', 'min-height', 'block-size'])
        expect(role?.denied).toContain(property)
    }
    expect(runtimeOwnedRole({ 'data-knc-fold': 'panel' })).toBeNull()
  })

  it('keeps the gallery policy exactly as it was', () => {
    for (const fold of ['gallery-row', 'gallery-track', 'gallery-tile'])
      expect(runtimeOwnedRole({ 'data-knc-fold': fold })).toEqual({
        resizable: false,
        denied: [
          ...motion,
          'overflow-y',
          'display',
          'width',
          'height',
          'min-width',
          'min-height',
          'max-width',
          'max-height',
          'flex-basis',
          'inline-size',
          'block-size',
          'min-inline-size',
          'min-block-size',
          'max-inline-size',
          'max-block-size',
        ],
      })
  })
})

describe('deniedProperty', () => {
  const tile = runtimeOwnedRole({ 'data-knc-fold': 'gallery-tile' })
  const card = runtimeOwnedRole({ 'data-knc-fold': 'barber-marquee', 'data-knc-source': 'x' })

  it('rejects a shorthand when any longhand it sets is runtime owned', () => {
    expect(deniedProperty(['flex', 'flex-grow', 'flex-shrink', 'flex-basis'], tile)).toBe(
      'flex-basis',
    )
    expect(deniedProperty(['flex', 'flex-grow', 'flex-shrink', 'flex-basis'], card)).toBe(undefined)
    expect(deniedProperty(['flex', 'flex-grow', 'flex-shrink', 'display'], card)).toBe('display')
    expect(deniedProperty(['transform'], null)).toBe(undefined)
  })

  it('rejects the loop geometry shorthands through the longhands they expand into', () => {
    expect(deniedProperty(['flex-flow', 'flex-direction', 'flex-wrap'], stripRole)).toBe(
      'flex-flow',
    )
    expect(deniedProperty(['flex-direction'], stripRole)).toBe('flex-direction')
    expect(
      deniedProperty(['margin-inline', 'margin-inline-start', 'margin-inline-end'], cardRole),
    ).toBe('margin-inline')
    expect(deniedProperty(['margin-block', 'margin-top', 'margin-bottom'], cardRole)).toBe(
      undefined,
    )
    expect(deniedProperty(['inset', 'top', 'right', 'bottom', 'left'], cardRole)).toBe(undefined)
  })

  it('rejects all itself, which Chromium does not expand into longhands', () => {
    for (const role of [tile, card]) expect(deniedProperty(['all'], role)).toBe('all')
    expect(deniedProperty(['all', 'color', 'display'], card)).toBe('all')
    expect(deniedProperty(['all'], null)).toBe(undefined)
  })
})

describe('marqueeCardStyle', () => {
  it('replaces zoom and any previous width with one mobile card width', () => {
    expect(marqueeCardStyle({ zoom: '0.5', padding: '20px', width: '10px' }, 0.5)).toEqual({
      padding: '20px',
      width: 'calc((100vw - 24px) * 0.5)',
      'flex-basis': 'calc((100vw - 24px) * 0.5)',
    })
  })
})

/** Embla 8.6 SlideLooper.canLoop for the mobile strip: each slide's neighbours must cover the
 * view. Edge slides measure their card plus one 24 px margin, inner slides plus both. */
function canLoop(cards: number, view: number, scale: number): boolean {
  const card = (view - 24) * scale
  const sizes = Array.from(
    { length: cards },
    (_, index) => card + (index === 0 || index === cards - 1 ? 24 : 48),
  )
  const total = sizes.reduce((sum, size) => sum + size, 0)
  return sizes.every((size) => view - (total - size) <= 0.1)
}

describe('minLoopScale', () => {
  it('keeps every roster loopable at every mobile width, and no smaller', () => {
    for (let cards = 2; cards <= 8; cards++) {
      const scale = minLoopScale(cards)
      for (const view of [320, 360, 390, 430, 600, 768])
        expect(canLoop(cards, view, scale), `${cards} cards at ${view}px`).toBe(true)
      expect(canLoop(cards, 768, scale - 0.02), `${cards} cards below ${scale}`).toBe(false)
    }
  })

  it('never lets two barbers shrink and leaves a single, static card free', () => {
    expect(minLoopScale(2)).toBe(1)
    expect(canLoop(2, 390, 0.5)).toBe(false)
    expect(minLoopScale(4)).toBeLessThan(0.5)
    expect(minLoopScale(1)).toBe(0.1)
  })
})
