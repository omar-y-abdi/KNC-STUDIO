import { describe, it, expect } from 'vitest'
import { aboutStrings, appStrings, bookingStrings, myBookingsStrings } from '../../src/i18n/index'

describe('i18n sv/en parity', () => {
  it('booking strings have identical key sets', () => {
    expect(Object.keys(bookingStrings('sv')).sort()).toEqual(
      Object.keys(bookingStrings('en')).sort(),
    )
  })
  it('app strings have identical key sets', () => {
    expect(Object.keys(appStrings('sv')).sort()).toEqual(Object.keys(appStrings('en')).sort())
  })
  it('about strings have identical key sets (incl. nested stylists)', () => {
    expect(Object.keys(aboutStrings('sv')).sort()).toEqual(Object.keys(aboutStrings('en')).sort())
    expect(Object.keys(aboutStrings('sv').stylists).sort()).toEqual(
      Object.keys(aboutStrings('en').stylists).sort(),
    )
  })
  it('my-bookings strings have identical key sets', () => {
    expect(Object.keys(myBookingsStrings('sv')).sort()).toEqual(
      Object.keys(myBookingsStrings('en')).sort(),
    )
  })
  it('no empty string values', () => {
    for (const table of [
      bookingStrings('sv'),
      bookingStrings('en'),
      appStrings('sv'),
      appStrings('en'),
    ]) {
      for (const [k, v] of Object.entries(table)) {
        expect(v.length, k).toBeGreaterThan(0)
      }
    }
  })
  it('no empty string values in about/my-bookings tables (flat + nested stylist copy)', () => {
    for (const lang of ['sv', 'en'] as const) {
      const about = aboutStrings(lang)
      for (const [k, v] of Object.entries(about)) {
        if (typeof v === 'string') expect(v.length, `about.${k}`).toBeGreaterThan(0)
      }
      for (const [id, copy] of Object.entries(about.stylists)) {
        expect(copy.role.length, `stylist ${id} role`).toBeGreaterThan(0)
        expect(copy.bio.length, `stylist ${id} bio`).toBeGreaterThan(0)
      }
      for (const [k, v] of Object.entries(myBookingsStrings(lang))) {
        if (k === 'atSep') continue
        expect(v.length, `myBookings.${k}`).toBeGreaterThan(0)
      }
    }
  })
})
