import { describe, it, expect, afterEach } from 'vitest'
import { recalledPhone, rememberPhone } from '../../src/mybookings/deviceMemory'

// The unit suite runs in the `node` env (no DOM), so we stub a minimal localStorage on globalThis to
// exercise the happy path, and remove it to exercise the graceful "storage unavailable" degradation.

interface FakeLS {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function fakeStorage(): FakeLS {
  const map = new Map<string, string>()
  return {
    getItem: (k) => {
      const v = map.get(k)
      return v === undefined ? null : v
    },
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

const g = globalThis as unknown as { window?: { localStorage: FakeLS } }

describe('deviceMemory', () => {
  afterEach(() => {
    delete g.window
  })

  it('remembers and recalls a phone via localStorage', () => {
    g.window = { localStorage: fakeStorage() }
    expect(recalledPhone()).toBeNull()
    rememberPhone('0701234567')
    expect(recalledPhone()).toBe('0701234567')
  })

  it('degrades gracefully (null, no throw) when storage is unavailable', () => {
    delete g.window
    expect(() => rememberPhone('0701234567')).not.toThrow()
    expect(recalledPhone()).toBeNull()
  })

  it('treats a blank stored value as "not remembered"', () => {
    g.window = { localStorage: fakeStorage() }
    rememberPhone('   ')
    expect(recalledPhone()).toBeNull()
  })
})
