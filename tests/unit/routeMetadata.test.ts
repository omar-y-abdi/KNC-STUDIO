import { describe, expect, it } from 'vitest'
import {
  NATIVE_PUBLIC_PATHS,
  bookingDescription,
  isNativePublicPath,
  nativePublicPath,
  nativeRouteTitle,
  privatePageTitle,
} from '../../modules/public-web/src/site/routeMetadata'

describe('nativePublicPath', () => {
  it('names exactly the native routes', () => {
    for (const path of NATIVE_PUBLIC_PATHS) expect(nativePublicPath(path)).toBe(path)
    expect([...NATIVE_PUBLIC_PATHS]).toEqual(['/', '/about', '/booking', '/my-bookings'])
  })

  it.each(['', '/about/', '/About', '/booking/extra', '/contact', '/terms', `/${'a'.repeat(64)}`])(
    'does not read %s as a native route',
    (pathname) => {
      expect(nativePublicPath(pathname)).toBeNull()
    },
  )
})

describe('native route defaults', () => {
  it.each([
    ['/about', 'sv', 'Om oss – Salongen'],
    ['/about', 'en', 'About – Salongen'],
    ['/booking', 'sv', 'Boka tid – Salongen'],
    ['/booking', 'en', 'Book – Salongen'],
    ['/my-bookings', 'sv', 'Mina bokningar – Salongen'],
    ['/my-bookings', 'en', 'My bookings – Salongen'],
  ] as const)('titles %s in %s as its name and the business name', (path, lang, title) => {
    expect(nativeRouteTitle(path, lang, 'Salongen')).toBe(title)
  })

  it('describes the booking page from the business name and city in each language', () => {
    const business = { name: 'Salongen', city: 'Malmö' }
    expect(bookingDescription('sv', business)).toBe(
      'Boka tid hos Salongen i Malmö: välj barberare, behandling och en ledig tid online.',
    )
    expect(bookingDescription('en', business)).toBe(
      'Book an appointment at Salongen in Malmö: choose a barber, a service and an available time online.',
    )
  })
})

describe('isNativePublicPath', () => {
  it.each(['/', '/about', '/booking', '/my-bookings', '/about/'])(
    'classifies the native public route %s',
    (pathname) => {
      expect(isNativePublicPath(pathname)).toBe(true)
    },
  )

  it('recognizes direct customer-token routes used by the development router', () => {
    expect(isNativePublicPath(`/${'a'.repeat(64)}`)).toBe(true)
    expect(isNativePublicPath(`/${'A'.repeat(64)}`)).toBe(true)
  })

  it.each(['/login', '/reset', '/admin', '/admin/cms', '/terms', '/about/extra', '/abc123'])(
    'does not gate the non-native route %s',
    (pathname) => {
      expect(isNativePublicPath(pathname)).toBe(false)
    },
  )
})

describe('trailing slash normalization', () => {
  it.each([
    ['/', true, null],
    ['//', false, null],
    ['/about///', true, null],
    ['/login///', false, 'Logga in — Blade & Blend Studio'],
    ['/admin/settings///', false, 'Adminpanel — Blade & Blend Studio'],
    ['/login///x', false, null],
  ])('preserves route classification for %s', (path, native, title) => {
    expect(isNativePublicPath(path)).toBe(native)
    expect(privatePageTitle(path)).toBe(title)
  })

  it('rejects long slash runs with a non-slash suffix', () => {
    const path = '/login' + '/'.repeat(200_000) + 'x'
    const started = performance.now()
    expect(privatePageTitle(path)).toBeNull()
    expect(isNativePublicPath(path)).toBe(false)
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
