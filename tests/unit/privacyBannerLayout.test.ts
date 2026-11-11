import { afterEach, expect, it, vi } from 'vitest'
import { useLayoutEffect } from 'preact/hooks'
import { PrivacyBanner, PrivacyManageButton } from '../../modules/public-web/src/site/PrivacyBanner'
import { ref, render, reset } from './helpers/fakeHooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
afterEach(() => vi.unstubAllGlobals())

it('measures before first paint, then coalesces privacy resizes outside observer delivery and cancels on close', () => {
  reset()
  const values = new Map<string, string>()
  const setProperty = vi.fn((name: string, value: string) => values.set(name, value))
  const removeProperty = vi.fn((name: string) => values.delete(name))
  vi.stubGlobal('document', {
    documentElement: {
      style: {
        setProperty,
        removeProperty,
        getPropertyValue: (name: string) => values.get(name) ?? '',
      },
    },
  })
  vi.stubGlobal('getComputedStyle', () => ({ bottom: '12px' }))
  const frames: FrameRequestCallback[] = []
  const request = vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  const cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
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
  panel.offsetHeight = 211
  observer.resize?.()
  observer.resize?.()
  // Writing here resizes the shallower MobileSite root during the same delivery cycle.
  expect(setProperty).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledTimes(1)
  panel.offsetHeight = 222
  frames[0]?.(16)
  expect(setProperty).toHaveBeenLastCalledWith('--privacy-overlay-space', '246px')
  observer.resize?.()
  frames[1]?.(32)
  expect(setProperty).toHaveBeenCalledTimes(2)
  observer.resize?.()
  if (typeof dispose !== 'function') throw new Error('Missing privacy measurement cleanup')
  dispose()
  expect(cancel).toHaveBeenCalledWith(3)
  expect(disconnect).toHaveBeenCalledOnce()
  expect(removeProperty).toHaveBeenCalledWith('--privacy-overlay-space')
  expect(values.has('--privacy-overlay-space')).toBe(false)
})

it('focuses the reopening pill without a scroll before the open panel shortens the page', () => {
  reset()
  const order: string[] = []
  const focus = vi.fn<(options?: FocusOptions) => void>(() => void order.push('focus'))
  const openPreferences = vi.fn(() => void order.push('open'))
  const pill = render(() =>
    PrivacyManageButton({
      lang: 'sv',
      dark: false,
      controls: {
        preferences: { functional: false },
        expanded: false,
        functional: false,
        setFunctional: vi.fn(),
        openPreferences,
        choose: vi.fn(),
      },
    }),
  )
  const onClick: unknown = pill?.props.onClick
  if (typeof onClick !== 'function') throw new Error('The privacy pill has no click handler')
  Reflect.apply(onClick, undefined, [{ currentTarget: { focus } }])
  // WebKit reveals the focused pill on a later task, when the root is already shorter.
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
  expect(order).toEqual(['focus', 'open'])
})
