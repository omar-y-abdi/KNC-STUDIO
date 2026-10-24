import type * as Preact from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface RenderedIsland {
  readonly props: { readonly mode?: string }
}

const rendered = vi.hoisted((): RenderedIsland[] => [])
vi.mock('preact', async (original) => ({
  ...(await original<typeof Preact>()),
  render: (node: RenderedIsland) => rendered.push(node),
}))
// The islands themselves are irrelevant here: only the mode the runtime hands them is asserted.
vi.mock('../../src/about/AboutSection', () => ({ AboutSection: () => null }))
vi.mock('../../src/booking/BookingFlow', () => ({ BookingFlow: () => null }))
vi.mock('../../src/mybookings/MyBookingsDialog', () => ({ MyBookingsDialog: () => null }))

const { mountCmsRuntime } = await import('../../src/cmsRuntime')

function mountBookingIsland(cmsMode: string, osDark: boolean): string | undefined {
  rendered.length = 0
  vi.stubGlobal('document', { documentElement: { lang: 'sv' } })
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: osDark && query === '(prefers-color-scheme: dark)',
    }),
  })
  const island = {}
  const root = {
    dataset: { cmsMode },
    querySelector: (selector: string) => (selector === '#knc-booking-runtime' ? island : null),
  }
  mountCmsRuntime(root as unknown as HTMLElement)
  return rendered[0]?.props.mode
}

describe('CMS runtime islands', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    [true, 'dark'],
    [false, 'light'],
  ] as const)('resolves the auto marker from the OS scheme (OS dark: %s)', (osDark, expected) => {
    expect(mountBookingIsland('auto', osDark)).toBe(expected)
  })

  it('keeps an explicit mode over the OS scheme', () => {
    expect(mountBookingIsland('light', true)).toBe('light')
    expect(mountBookingIsland('dark', false)).toBe('dark')
  })
})
