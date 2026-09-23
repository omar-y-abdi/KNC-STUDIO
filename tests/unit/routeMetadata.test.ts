import { describe, expect, it } from 'vitest'
import { isNativePublicPath } from '../../src/site/routeMetadata'

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
