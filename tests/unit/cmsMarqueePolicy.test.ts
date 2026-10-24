import { describe, expect, it } from 'vitest'
import { deniedProperty, runtimeOwnedRole } from '../../src/admin/cms/editorPolicy'
import { marqueeCardStyle } from '../../src/admin/cms/hierarchicalResize'

const motion = ['transform', 'translate', 'rotate', 'scale', 'zoom', 'overflow', 'overflow-x']
const sizing = ['width', 'height', 'min-width', 'max-height', 'flex-basis', 'inline-size']

describe('runtimeOwnedRole', () => {
  it('locks the motion properties of the barber strip and of its cards only', () => {
    const strip = { 'data-knc-fold': 'barber-marquee', 'data-knc-source': 'knc-about-0-i0-i6' }
    for (const role of [
      runtimeOwnedRole(strip),
      runtimeOwnedRole({ 'data-knc-source': 'knc-about-0-i0-i6-k6b' }, strip),
    ]) {
      expect(role?.resizable).toBe(true)
      for (const property of [...motion, 'overflow-y', 'display'])
        expect(role?.denied).toContain(property)
      for (const property of sizing) expect(role?.denied).not.toContain(property)
    }
    expect(runtimeOwnedRole({ id: 'portrait' }, strip)).toBeNull()
    expect(runtimeOwnedRole({ 'data-knc-source': 'knc-about-0-i0-i6-k6b-i0' })).toBeNull()
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
})

describe('deniedProperty', () => {
  const tile = runtimeOwnedRole({ 'data-knc-fold': 'gallery-tile' })
  const card = runtimeOwnedRole({ 'data-knc-fold': 'barber-marquee', 'data-knc-source': 'x' })

  it('rejects a shorthand when any longhand it sets is runtime owned', () => {
    expect(deniedProperty(['flex', 'flex-grow', 'flex-shrink', 'flex-basis'], tile)).toBe(
      'flex-basis',
    )
    expect(deniedProperty(['flex', 'flex-grow', 'flex-shrink', 'flex-basis'], card)).toBe(undefined)
    expect(deniedProperty(['all', 'color', 'display'], card)).toBe('display')
    expect(deniedProperty(['transform'], null)).toBe(undefined)
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
