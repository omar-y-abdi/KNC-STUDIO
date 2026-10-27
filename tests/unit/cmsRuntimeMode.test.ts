import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A stand-in booking island that holds typed input in component state. It renders no DOM, so real
// Preact can mount it into a plain container in the node test environment.
const booking = vi.hoisted(() => ({
  renders: [] as { readonly mode: string; readonly typed: string }[],
  type: (() => undefined) as (value: string) => void,
}))
vi.mock('../../src/booking/BookingFlow', () => ({
  BookingFlow: ({ mode }: { readonly mode: string }) => {
    const [typed, setTyped] = useState('')
    booking.type = setTyped
    booking.renders.push({ mode, typed })
    return null
  },
}))
vi.mock('../../src/about/AboutSection', () => ({ AboutSection: () => null }))
vi.mock('../../src/mybookings/MyBookingsDialog', () => ({ MyBookingsDialog: () => null }))

const { mountCmsRuntime } = await import('../../src/cmsRuntime')

function mountBookingIsland(cmsMode: string, osDark: boolean) {
  booking.renders.length = 0
  const scheme = { osDark, listeners: [] as (() => void)[] }
  vi.stubGlobal('document', { documentElement: { lang: 'sv' } })
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      get matches() {
        return scheme.osDark && query === '(prefers-color-scheme: dark)'
      },
      addEventListener: (_type: string, listener: () => void) => scheme.listeners.push(listener),
    }),
  })
  const island = {}
  const root = {
    dataset: { cmsMode },
    querySelector: (selector: string) => (selector === '#knc-booking-runtime' ? island : null),
  }
  act(() => mountCmsRuntime(root as unknown as HTMLElement))
  const flipOs = (dark: boolean): void => {
    scheme.osDark = dark
    act(() => {
      for (const listener of scheme.listeners) listener()
    })
  }
  const last = () => booking.renders.at(-1)
  return { scheme, flipOs, last }
}

describe('CMS runtime islands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    [true, 'dark'],
    [false, 'light'],
  ] as const)('resolves the auto marker from the OS scheme (OS dark: %s)', (osDark, expected) => {
    expect(mountBookingIsland('auto', osDark).last()?.mode).toBe(expected)
  })

  it('follows both OS transitions after mount without losing typed booking data', () => {
    const page = mountBookingIsland('auto', false)
    act(() => booking.type('Ada Lovelace'))
    page.flipOs(true)
    expect(page.last()).toEqual({ mode: 'dark', typed: 'Ada Lovelace' })
    page.flipOs(false)
    expect(page.last()).toEqual({ mode: 'light', typed: 'Ada Lovelace' })
  })

  it('keeps an explicit mode pinned over the OS scheme', () => {
    const light = mountBookingIsland('light', true)
    expect(light.last()?.mode).toBe('light')
    expect(light.scheme.listeners).toHaveLength(0)
    expect(mountBookingIsland('dark', false).last()?.mode).toBe('dark')
  })
})
