import { describe, it, expect } from 'vitest'
import { bookingStrings, appStrings } from '../../src/i18n/index'

describe('i18n sv/en parity', () => {
  it('booking strings have identical key sets', () => {
    expect(Object.keys(bookingStrings('sv')).sort()).toEqual(Object.keys(bookingStrings('en')).sort())
  })
  it('app strings have identical key sets', () => {
    expect(Object.keys(appStrings('sv')).sort()).toEqual(Object.keys(appStrings('en')).sort())
  })
  it('no empty string values', () => {
    for (const table of [bookingStrings('sv'), bookingStrings('en'), appStrings('sv'), appStrings('en')]) {
      for (const [k, v] of Object.entries(table)) {
        expect(v.length, k).toBeGreaterThan(0)
      }
    }
  })
})
