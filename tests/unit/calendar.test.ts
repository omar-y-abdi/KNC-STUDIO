import type { VNode } from 'preact'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { BookingFlow } from '../../src/booking/BookingFlow'
import { pad2, cap, iso, buildWeeks, isSelectableBookingDate } from '../../src/booking/calendar'
import { stockholmWallClockDate } from '../../src/booking/stockholmTime'

vi.mock('preact/hooks', () => ({
  useContext: () => null,
  useState: (initial: unknown) => {
    const value: unknown = typeof initial === 'function' ? initial() : initial
    return [
      typeof value === 'object' && value !== null && 'barberId' in value
        ? { ...value, barberId: 'owner-barber' }
        : value,
      vi.fn(),
    ]
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
}))
vi.mock('../../src/ui/Dialog', () => ({ Dialog: () => null }))
vi.mock('../../src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))
vi.mock('../../src/cms/NativeSurface', () => ({
  NativeRegion: () => null,
  useNativeChild: () => (node: unknown) => node,
}))
vi.mock('../../src/booking/useRoster', () => ({
  useRoster: () => ({ roster: [], loading: false }),
}))
vi.mock('../../src/booking/useServices', () => ({
  useServices: () => ({ services: [], loading: false }),
}))

function buttons(node: unknown): VNode<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as VNode<Record<string, unknown>>
  return [...(vnode.type === 'button' ? [vnode] : []), ...buttons(vnode.props.children)]
}

afterEach(() => vi.unstubAllEnvs())

describe('helpers', () => {
  it('pad2', () => {
    expect(pad2(5)).toBe('05')
    expect(pad2(12)).toBe('12')
  })
  it('cap', () => {
    expect(cap('june')).toBe('June')
    expect(cap('')).toBe('')
  })
  it('iso (local date, no timezone shift)', () => {
    expect(iso(new Date(2026, 5, 19))).toBe('2026-06-19')
    expect(iso(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
  it('keeps a configured future Sunday selectable', () => {
    const today = new Date(2040, 2, 12)
    const sunday = new Date(2040, 2, 18)

    expect(sunday.getDay()).toBe(0)
    expect(isSelectableBookingDate(sunday, today)).toBe(true)
  })

  it('uses the Stockholm wall-clock day when an injected clock crosses midnight during DST', () => {
    const today = stockholmWallClockDate(new Date('2040-03-31T22:30:00.000Z'))
    const previousDay = new Date(2040, 2, 31)
    const stockholmDay = new Date(2040, 3, 1)

    expect(iso(today)).toBe('2040-04-01')
    expect(isSelectableBookingDate(previousDay, today)).toBe(false)
    expect(isSelectableBookingDate(stockholmDay, today)).toBe(true)
  })

  it('renders the Stockholm month and date availability when the injected UTC clock crosses a DST midnight', () => {
    vi.stubEnv('TZ', 'UTC')
    const rendered = buttons(BookingFlow({ clock: () => new Date('2040-03-31T22:30:00.000Z') }))
    const days = rendered.filter(
      (node) =>
        typeof node.props['aria-label'] === 'string' &&
        String(node.props['aria-label']).includes('april 2040'),
    )
    expect(days).toHaveLength(30)
    const first = days.find((node) => node.props.children === 1)
    expect(first).toBeDefined()
    expect(first?.props.disabled).toBe(false)
    expect(first?.props.onClick).toBeTypeOf('function')
    expect(days.every((node) => node.props.disabled === false)).toBe(true)
  })
})

describe('buildWeeks (Monday-first month grid)', () => {
  const weeks = buildWeeks(2026, 5) // June 2026

  it('every week has exactly 7 cells', () => {
    for (const w of weeks) expect(w).toHaveLength(7)
  })
  it('contains all 30 June days in order, with null padding only', () => {
    const days = weeks
      .flat()
      .filter((c): c is Date => c !== null)
      .map((d) => d.getDate())
    expect(days).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
  })
})
