import { describe, expect, it } from 'vitest'
import {
  ADMIN_SCROLL_RESTORE_TIMEOUT_MS,
  adminNavigationStorageKey,
  adminUrlForTab,
  clearAdminNavigationState,
  normalizeAdminTab,
  parseAdminNavigationHistoryState,
  readAdminScroll,
  tabFromAdminUrl,
  withAdminNavigationHistoryState,
} from '../../src/admin/navigationState'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('admin navigation state', () => {
  const tabs = ['schedule', 'mail', 'site'] as const

  it('restores only a visible tab from a stable URL', () => {
    expect(tabFromAdminUrl('https://example.test/admin?tab=mail', tabs, 'schedule')).toBe('mail')
    expect(
      tabFromAdminUrl('https://example.test/admin?tab=mail', ['schedule'] as const, 'schedule'),
    ).toBe('schedule')
    expect(normalizeAdminTab('unknown', tabs, 'schedule')).toBe('schedule')
  })

  it('scopes scroll history to exact signed-in user and tab', () => {
    const storage = memoryStorage({ [adminNavigationStorageKey('owner-a', 'mail')]: '312' })
    const history = withAdminNavigationHistoryState(
      { unrelated: true },
      { userId: 'owner-a', tab: 'mail', scrollY: 288 },
    )
    expect(readAdminScroll(history, storage, 'owner-a', 'mail')).toBe(288)
    expect(readAdminScroll(history, storage, 'owner-b', 'mail')).toBe(0)
    expect(readAdminScroll(history, storage, 'owner-a', 'site')).toBe(0)
  })

  it('rejects malformed browser history and clears only signing-out user keys', () => {
    const storage = memoryStorage({
      [adminNavigationStorageKey('owner-a', 'mail')]: '312',
      [adminNavigationStorageKey('owner-b', 'mail')]: '111',
    })
    expect(
      parseAdminNavigationHistoryState({
        kncAdminNavigation: { userId: 'a', tab: 'mail', scrollY: -1 },
      }),
    ).toBeNull()
    clearAdminNavigationState(storage, 'owner-a')
    expect(storage.getItem(adminNavigationStorageKey('owner-a', 'mail'))).toBeNull()
    expect(storage.getItem(adminNavigationStorageKey('owner-b', 'mail'))).toBe('111')
  })

  it('updates only tab query while retaining route and hash', () => {
    expect(adminUrlForTab('https://example.test/admin?theme=dark#mail', 'mail')).toBe(
      '/admin?theme=dark&tab=mail#mail',
    )
  })

  it('keeps delayed-content restoration alive beyond the known ten-second load case', () => {
    expect(ADMIN_SCROLL_RESTORE_TIMEOUT_MS).toBeGreaterThan(10_000)
  })
})
