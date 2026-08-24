// Reload/back-forward state for the authenticated admin shell. URL owns selected tab; sessionStorage
// owns a per-user/tab scroll fallback. A user id is part of every key so a later admin session cannot
// inherit another account's view state.

export interface AdminNavigationHistoryState {
  readonly userId: string
  readonly tab: string
  readonly scrollY: number
}

interface HistoryStateShape {
  readonly kncAdminNavigation?: AdminNavigationHistoryState
}

const STORAGE_PREFIX = 'knc-admin-navigation:'
const TAB_PARAM = 'tab'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function adminNavigationStorageKey(userId: string, tab: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(tab)}`
}

export function parseAdminNavigationHistoryState(
  value: unknown,
): AdminNavigationHistoryState | null {
  const navigation = isRecord(value) ? value['kncAdminNavigation'] : null
  if (!isRecord(navigation)) return null
  const state = navigation
  return typeof state['userId'] === 'string' &&
    state['userId'].length > 0 &&
    typeof state['tab'] === 'string' &&
    state['tab'].length > 0 &&
    nonNegativeInteger(state['scrollY'])
    ? { userId: state['userId'], tab: state['tab'], scrollY: state['scrollY'] }
    : null
}

export function normalizeAdminTab<T extends string>(
  requested: string | null,
  visibleTabs: readonly T[],
  fallback: T,
): T {
  return requested !== null && visibleTabs.includes(requested as T) ? (requested as T) : fallback
}

export function readAdminScroll(
  historyState: unknown,
  storage: Pick<Storage, 'getItem'> | null,
  userId: string,
  tab: string,
): number {
  const inHistory = parseAdminNavigationHistoryState(historyState)
  if (inHistory?.userId === userId && inHistory.tab === tab) return inHistory.scrollY
  try {
    const raw = storage?.getItem(adminNavigationStorageKey(userId, tab))
    if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return 0
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export function withAdminNavigationHistoryState(
  existing: unknown,
  next: AdminNavigationHistoryState,
): HistoryStateShape & Record<string, unknown> {
  const prior = isRecord(existing) ? existing : {}
  return { ...prior, kncAdminNavigation: next }
}

export function persistAdminScroll(
  storage: Pick<Storage, 'setItem'> | null,
  userId: string,
  tab: string,
  scrollY: number,
): void {
  try {
    storage?.setItem(
      adminNavigationStorageKey(userId, tab),
      String(Math.max(0, Math.round(scrollY))),
    )
  } catch {
    // Private-mode and quota failures only disable convenience restoration.
  }
}

export function clearAdminNavigationState(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null,
  userId: string,
): void {
  if (storage === null) return
  const prefix = `${STORAGE_PREFIX}${encodeURIComponent(userId)}:`
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key?.startsWith(prefix)) storage.removeItem(key)
    }
  } catch {
    // Sign-out still succeeds when browser storage cannot be read.
  }
}

export function tabFromAdminUrl<T extends string>(
  url: string,
  visibleTabs: readonly T[],
  fallback: T,
): T {
  try {
    return normalizeAdminTab(new URL(url).searchParams.get(TAB_PARAM), visibleTabs, fallback)
  } catch {
    return fallback
  }
}

export function adminUrlForTab(url: string, tab: string): string {
  const next = new URL(url)
  next.searchParams.set(TAB_PARAM, tab)
  return `${next.pathname}${next.search}${next.hash}`
}
