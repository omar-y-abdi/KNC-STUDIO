import { describe, expect, it } from 'vitest'
import {
  homeScreenGuideRecorded,
  recordHomeScreenGuide,
} from '../../modules/public-web/src/onboarding/record'
import {
  forgetHomeScreenGuide,
  HOME_SCREEN_GUIDE_KEY,
} from '../../modules/public-web/src/onboarding/trigger'

// The device's note that the home-screen guide has been shown: kept only with optional storage on,
// and a storage that throws or is missing is never an error.

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
  return { storage: () => storage, entries: () => [...values] }
}

const unreachable = (): Storage => {
  throw new Error('SecurityError: the operation is insecure')
}
// A `window` without the property, typed as the DOM types it.
const missing = (): Storage => Reflect.get({}, 'localStorage')
const full = (): Storage => ({
  ...memoryStorage().storage(),
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
})

const FUNCTIONAL = { functional: true }
const ESSENTIAL = { functional: false }

describe('home-screen guide note', () => {
  it('is kept under bladeblend_home_screen_guide as "shown"', () => {
    const device = memoryStorage()
    expect(HOME_SCREEN_GUIDE_KEY).toBe('bladeblend_home_screen_guide')
    expect(recordHomeScreenGuide(device.storage, FUNCTIONAL)).toBe(true)
    expect(device.entries()).toEqual([['bladeblend_home_screen_guide', 'shown']])
    expect(homeScreenGuideRecorded(device.storage)).toBe(true)
  })

  it.each([
    ['essential storage only', ESSENTIAL],
    ['no choice yet', null],
  ])('is never written with %s', (_label, preferences) => {
    const device = memoryStorage()
    expect(recordHomeScreenGuide(device.storage, preferences)).toBe(false)
    expect(device.entries()).toEqual([])
  })

  it.each([
    ['nothing', {}, false],
    ['another value', { [HOME_SCREEN_GUIDE_KEY]: 'yes' }, false],
    ['another key', { bladeblend_other: 'shown' }, false],
    ['the note', { [HOME_SCREEN_GUIDE_KEY]: 'shown' }, true],
  ])('reads %s as recorded: %s', (_label, entries, recorded) => {
    expect(homeScreenGuideRecorded(memoryStorage(entries).storage)).toBe(recorded)
  })

  it.each([
    ['throws', unreachable],
    ['is missing', missing],
  ])('counts a storage that %s as no note, and never fails', (_label, storage) => {
    expect(homeScreenGuideRecorded(storage)).toBe(false)
    expect(recordHomeScreenGuide(storage, FUNCTIONAL)).toBe(false)
    expect(forgetHomeScreenGuide(storage, ESSENTIAL)).toBe('unreachable')
  })

  it('reports a write the storage refuses as nothing written', () => {
    expect(recordHomeScreenGuide(full, FUNCTIONAL)).toBe(false)
  })
})

describe('home-screen guide note on a storage choice', () => {
  it.each([
    ['withdrawn', ESSENTIAL],
    ['not made, or no longer readable', null],
  ])('is removed when optional storage is %s, and nothing else', (_label, preferences) => {
    const device = memoryStorage({ [HOME_SCREEN_GUIDE_KEY]: 'shown', bladeblend_other: 'kept' })
    expect(forgetHomeScreenGuide(device.storage, preferences)).toBe('removed')
    expect(device.entries()).toEqual([['bladeblend_other', 'kept']])
  })

  it('stays while optional storage is on', () => {
    const device = memoryStorage({ [HOME_SCREEN_GUIDE_KEY]: 'shown' })
    expect(forgetHomeScreenGuide(device.storage, FUNCTIONAL)).toBe('kept')
    expect(device.entries()).toEqual([[HOME_SCREEN_GUIDE_KEY, 'shown']])
  })
})
