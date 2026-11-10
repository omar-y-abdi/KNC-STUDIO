import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailsDialog } from '../../modules/public-web/src/booking/DetailsDialog'
import { AboutSection } from '../../modules/public-web/src/about/AboutSection'
import { MyBookingsDialog } from '../../modules/public-web/src/mybookings/MyBookingsDialog'
import { buildBookingStyles, palette } from '../../modules/public-web/src/booking/bookingStyles'
import { DEFAULT_BUSINESS } from '../../modules/public-web/src/config'
import { bookingStrings } from '../../modules/public-web/src/i18n/index'
import { nodes, reset } from './helpers/fakeHooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('../../modules/public-web/src/ui/Dialog', () => ({ Dialog: () => null }))
vi.mock('../../modules/public-web/src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))
vi.mock('../../modules/public-web/src/cms/NativeSurface', () => ({
  NativeRegion: () => null,
  useNativeSource: () => false,
  useNativeSurface: (node: unknown) => node,
  useNativeChild: () => (node: unknown) => node,
}))
vi.mock('../../modules/public-web/src/about/useBarberMarquee', () => ({
  useBarberMarquee: () => ({
    selected: null,
    toggle: vi.fn(),
    reducedMotion: true,
    animate: false,
  }),
}))

const inputs = (node: unknown) =>
  nodes(node)
    .filter((node) => node.type === 'input')
    .map((node) => node.props)

beforeEach(reset)

describe('public customer input semantics', () => {
  it('renders native name, telephone and email autofill fields in booking details', () => {
    const noop = vi.fn()
    const fields = inputs(
      DetailsDialog({
        t: bookingStrings('sv'),
        lang: 'sv',
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
        bookBusy: false,
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
    expect(fields.map((field) => field['aria-required'])).toEqual(['true', 'true', 'true'])
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
      business: DEFAULT_BUSINESS,
      onClose: vi.fn(),
    })
    if (typeof dialog.type !== 'function') throw new Error('Missing My Bookings session')
    const bookings = inputs((dialog.type as (props: unknown) => unknown)(dialog.props))
    expect(bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'email', autoComplete: 'email', 'aria-required': 'true' }),
      ]),
    )
  })
})
