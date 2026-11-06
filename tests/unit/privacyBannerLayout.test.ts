import { afterEach, expect, it, vi } from 'vitest'
import { useLayoutEffect } from 'preact/hooks'
import { PrivacyBanner } from '../../modules/public-web/src/site/PrivacyBanner'
import { ref, render, reset } from './helpers/fakeHooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
afterEach(() => vi.unstubAllGlobals())

it('measures before first paint, re-measures on each panel resize and cleans up on close', () => {
  reset()
  const setProperty = vi.fn()
  const removeProperty = vi.fn()
  vi.stubGlobal('document', { documentElement: { style: { setProperty, removeProperty } } })
  vi.stubGlobal('getComputedStyle', () => ({ bottom: '12px' }))
  const observer: { resize?: () => void } = {}
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observer.resize = callback
      }
      observe = observe
      disconnect = disconnect
    },
  )
  render(() =>
    PrivacyBanner({
      lang: 'sv',
      dark: false,
      controls: {
        preferences: null,
        expanded: false,
        functional: false,
        setFunctional: vi.fn(),
        openPreferences: vi.fn(),
        choose: vi.fn(),
      },
    }),
  )
  const panel = { offsetHeight: 210 }
  ref(0, panel)
  const dispose = vi.mocked(useLayoutEffect).mock.calls[0]?.[0]()
  expect(setProperty).toHaveBeenCalledExactlyOnceWith('--privacy-overlay-space', '234px')
  expect(observe).toHaveBeenCalledWith(panel)
  // Every resize delivery writes the measurement synchronously, with no frame deferral.
  panel.offsetHeight = 222
  observer.resize?.()
  expect(setProperty).toHaveBeenLastCalledWith('--privacy-overlay-space', '246px')
  observer.resize?.()
  expect(setProperty).toHaveBeenCalledTimes(3)
  if (typeof dispose !== 'function') throw new Error('Missing privacy measurement cleanup')
  dispose()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(removeProperty).toHaveBeenCalledExactlyOnceWith('--privacy-overlay-space')
})
