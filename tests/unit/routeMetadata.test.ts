import { describe, expect, it } from 'vitest'
import {
  isNativePublicPath,
  privatePageTitle,
} from '../../modules/public-web/src/site/routeMetadata'

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
