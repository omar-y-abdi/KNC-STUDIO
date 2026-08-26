import { afterEach, describe, expect, it } from 'vitest'
import { forgetPhone, recalledPhone, rememberPhone } from '../../src/mybookings/deviceMemory'

class CookieDocument {
  readonly values = new Map<string, string>()

  get cookie(): string {
    return Array.from(this.values, ([name, value]) => `${name}=${value}`).join('; ')
  }

  set cookie(serialized: string) {
    const [pair, ...attributes] = serialized.split(';').map((value) => value.trim())
    const separator = pair?.indexOf('=') ?? -1
    if (pair === undefined || separator < 1) return
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    const expires = attributes.some((attribute) => attribute.toLowerCase() === 'max-age=0')
    if (expires) this.values.delete(name)
    else this.values.set(name, value)
  }
}

const globals = globalThis as unknown as {
  document?: CookieDocument
  location?: { protocol: string }
}

function browser(preference: 'functional' | 'essential'): CookieDocument {
  const document = new CookieDocument()
  document.values.set('bladeblend_storage_preferences', preference)
  globals.document = document
  globals.location = { protocol: 'https:' }
  return document
}

describe('customer phone device cookie', () => {
  afterEach(() => {
    delete globals.document
    delete globals.location
  })

  it('writes and recalls phone only after functional-storage opt-in', () => {
    const document = browser('functional')
    expect(recalledPhone()).toBeNull()
    rememberPhone('0701234567')
    expect(recalledPhone()).toBe('0701234567')
    expect(document.values.get('bladeblend_mybookings_phone')).toBe('0701234567')
  })

  it('does not read or write phone after optional storage is rejected', () => {
    const document = browser('essential')
    rememberPhone('0701234567')
    expect(recalledPhone()).toBeNull()
    expect(document.values.has('bladeblend_mybookings_phone')).toBe(false)
  })

  it('rejects malformed phone values and degrades when cookies are unavailable', () => {
    browser('functional')
    rememberPhone('   ')
    expect(recalledPhone()).toBeNull()
    delete globals.document
    expect(() => rememberPhone('0701234567')).not.toThrow()
    expect(recalledPhone()).toBeNull()
  })

  it('forgets the registered-device phone explicitly', () => {
    const document = browser('functional')
    rememberPhone('0701234567')
    forgetPhone()
    expect(recalledPhone()).toBeNull()
    expect(document.values.has('bladeblend_mybookings_phone')).toBe(false)
  })
})
