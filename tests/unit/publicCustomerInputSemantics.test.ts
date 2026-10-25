import type { VNode } from 'preact'
import { describe, expect, it, vi } from 'vitest'
import { DetailsDialog } from '../../src/booking/DetailsDialog'
import { AboutSection } from '../../src/about/AboutSection'
import { MyBookingsDialog } from '../../src/mybookings/MyBookingsDialog'
import { buildBookingStyles, palette } from '../../src/booking/bookingStyles'
import { bookingStrings } from '../../src/i18n/index'

vi.mock('preact/hooks', () => ({
  useContext: () => null,
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
}))
vi.mock('../../src/ui/Dialog', () => ({ Dialog: () => null }))
vi.mock('../../src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))
vi.mock('../../src/cms/NativeSurface', () => ({
  NativeRegion: () => null,
  useNativeSource: () => false,
  useNativeSurface: (node: unknown) => node,
  useNativeChild: () => (node: unknown) => node,
}))
vi.mock('../../src/about/useBarberMarquee', () => ({
  useBarberMarquee: () => ({
    selected: null,
    toggle: vi.fn(),
    reducedMotion: true,
    animate: false,
  }),
}))

function inputs(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(inputs)
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as VNode<Record<string, unknown>>
  return [...(vnode.type === 'input' ? [vnode.props] : []), ...inputs(vnode.props.children)]
}

describe('public customer input semantics', () => {
  it('renders native name, telephone and email autofill fields in booking details', () => {
    const noop = vi.fn()
    const fields = inputs(
      DetailsDialog({
        t: bookingStrings('sv'),
        s: buildBookingStyles(palette(false), false, false),
        closeLabel: 'Close',
        sumBarber: '',
        sumWhen: '',
        sumService: '',
        sumPrice: '',
        nameValue: '',
        phoneValue: '',
        emailValue: '',
        bookDisabled: false,
        fieldErrors: { name: false, phone: false, email: false },
        submitError: null,
        onName: noop,
        onPhone: noop,
        onEmail: noop,
        onBook: noop,
        onClose: noop,
        onBackdropClick: noop,
        turnstile: null,
      }),
    )
    expect(
      fields.map(({ type, autoComplete, inputMode }) => ({ type, autoComplete, inputMode })),
    ).toEqual([
      { type: 'text', autoComplete: 'name', inputMode: undefined },
      { type: 'tel', autoComplete: 'tel', inputMode: 'tel' },
      { type: 'email', autoComplete: 'email', inputMode: 'email' },
    ])
  })

  it('renders telephone autofill in reviews and email autofill in My Bookings', () => {
    const review = inputs(AboutSection({ mode: 'light', lang: 'sv' }))
    expect(review).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'tel', autoComplete: 'tel' })]),
    )
    const dialog = MyBookingsDialog({
      mode: 'light',
      lang: 'sv',
      accessError: 'invalid',
      onClose: vi.fn(),
    })
    if (typeof dialog.type !== 'function') throw new Error('Missing My Bookings session')
    const bookings = inputs((dialog.type as (props: unknown) => unknown)(dialog.props))
    expect(bookings).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'email', autoComplete: 'email' })]),
    )
  })
})
