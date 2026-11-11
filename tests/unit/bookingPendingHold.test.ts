import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingFlow,
  type BookingFlowProps,
} from '../../modules/public-web/src/booking/BookingFlow'
import { ConfirmationDialog } from '../../modules/public-web/src/booking/ConfirmationDialog'
import { DetailsDialog } from '../../modules/public-web/src/booking/DetailsDialog'
import type { BookingResult } from '../../modules/public-web/src/booking/domain'
import {
  PENDING_MINIMUM_MS,
  pendingHold,
  pendingMinimumMs,
  timerDelay,
  type Delay,
} from '../../modules/public-web/src/booking/pendingHold'
import type { AvailabilityResult, BookingPort } from '../../modules/public-web/src/booking/port'
import { bookingStrings } from '../../modules/public-web/src/i18n/index'
import { installFakePage } from './helpers/fakeFocus'
import { mount, nodes, render, reset, type RenderedNode } from './helpers/fakeHooks'

// The details popup says a booking is on its way for at least PENDING_MINIMUM_MS on the public
// site: an answer is handled once it is in and that time has passed since the submit started.

const reads = vi.hoisted(() => ({
  roster: vi.fn(),
  services: vi.fn(),
  // What `useContext` answers for every context: undefined on the public site; null stands in for
  // the Studio, where `previewPorts` is not undefined.
  context: { value: undefined as undefined | null },
}))
vi.mock('preact/hooks', async () => ({
  ...(await import('./helpers/fakeHooks')),
  useContext: () => reads.context.value,
}))
vi.mock('../../modules/public-web/src/ui/Dialog', () => ({ Dialog: () => null }))
vi.mock('../../modules/public-web/src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))
vi.mock('../../modules/public-web/src/cms/NativeSurface', () => ({
  NativeRegion: () => null,
  useNativeChild: () => (node: unknown) => node,
}))
vi.mock('../../modules/public-web/src/booking/useRoster', () => ({ useRoster: reads.roster }))
vi.mock('../../modules/public-web/src/booking/useServices', () => ({
  useServices: reads.services,
}))
vi.mock('../../modules/public-web/src/booking/Turnstile', () => ({
  Turnstile: () => null,
  turnstileConfigured: false,
}))

const t = bookingStrings('sv')
const barber = { barber: { id: 'b1', name: 'Barber One', ig: 'one' }, copy: null, photoUrl: null }
const service = { id: 's1', name: 'Cut', price: 300, dur: 30 }
const contact = { name: 'Ada Lovelace', phone: '070 123 45 67', email: 'ada@example.test' }
const rateLimited: BookingResult = {
  ok: false,
  error: { kind: 'rate_limited', message: t.errRateLimited },
}
const bookedAnswer: BookingPort['submit'] = async (booking) => ({
  ok: true,
  booking,
  links: { icsHref: 'ics', gcalHref: 'gcal', mapsHref: 'maps' },
})

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''
  return text((node as RenderedNode).props?.children)
}

function click(node: RenderedNode | undefined): void {
  if (node === undefined) throw new Error('Missing control')
  ;(node.props['onClick'] as () => void)()
}

let flowProps: Partial<BookingFlowProps> = {}

function screen(port: BookingPort) {
  const all = nodes(
    render(() =>
      BookingFlow({ port, defaultLang: 'sv', clock: () => new Date(2040, 2, 12, 9), ...flowProps }),
    ),
  )
  return {
    all,
    chips: all.filter((node) => node.type === 'button' && /^\d\d:\d\d$/.test(text(node))),
    details: all.find((node) => node.type === DetailsDialog),
    confirmation: all.find((node) => node.type === ConfirmationDialog),
  }
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

function popup(port: BookingPort): RenderedNode {
  const details = screen(port).details
  if (details === undefined) throw new Error('Missing details popup')
  return details
}

const byTestId = (port: BookingPort, id: string): RenderedNode | undefined =>
  screen(port).all.find((node) => node.props['data-testid'] === id)

/** Barber, first bookable day, service and 10:00, with the details filled in. */
async function fillDetails(port: BookingPort): Promise<void> {
  click(byTestId(port, 'booking-barber-option'))
  click(
    screen(port).all.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-pressed'] === false &&
        node.props['disabled'] === false,
    ),
  )
  click(byTestId(port, 'booking-service-option'))
  screen(port)
  mount()
  await flush()
  click(screen(port).chips[0])
  const type = (handler: string, value: string): void => {
    ;(popup(port).props[handler] as (event: unknown) => void)({ currentTarget: { value } })
  }
  type('onName', contact.name)
  type('onPhone', contact.phone)
  type('onEmail', contact.email)
}

const press = (port: BookingPort): void => (popup(port).props['onBook'] as () => void)()

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let fulfil: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    fulfil = resolve
  })
  return { promise, resolve: (value) => fulfil(value) }
}

const portWith = (submit: BookingPort['submit']): BookingPort => ({
  availability: async (): Promise<AvailabilityResult> => ({ ok: true, times: ['10:00', '10:30'] }),
  submit,
})

/** A submit whose answer arrives `ms` after it started. */
const answerAfter = (ms: number): BookingPort['submit'] =>
  vi.fn<BookingPort['submit']>(
    (booking) =>
      new Promise((resolve) => {
        setTimeout(() => void bookedAnswer(booking).then(resolve), ms)
      }),
  )

/** The popup is still the one in front, saying its booking is on its way. */
function expectPending(port: BookingPort): void {
  const view = screen(port)
  expect(view.confirmation).toBeUndefined()
  expect(view.details?.props).toMatchObject({ bookBusy: true, submitError: null })
}

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  installFakePage()
  flowProps = {}
  reads.context.value = undefined
  reads.roster.mockReturnValue({ roster: [barber], status: 'ready', retry: vi.fn() })
  reads.services.mockReturnValue({ services: [service], status: 'ready', retry: vi.fn() })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pending minimum', () => {
  it.each([
    ['live', 'full', 900],
    ['live', 'reduced', 0],
    ['preview', 'full', 0],
    ['preview', 'reduced', 0],
  ] as const)('is, %s with %s motion, %i ms', (stage, motion, ms) => {
    expect(pendingMinimumMs(stage, motion)).toBe(ms)
    expect(PENDING_MINIMUM_MS).toBe(900)
  })

  it('waits through the injected delay, and asks it for nothing when there is no minimum', async () => {
    const delay = vi.fn<Delay>(() => Promise.resolve())
    await pendingHold(900, delay)
    expect(delay.mock.calls).toEqual([[900]])

    delay.mockClear()
    await pendingHold(0, delay)
    expect(delay).not.toHaveBeenCalled()
  })

  it('resolves the timer delay when its time has passed, not before', async () => {
    vi.useFakeTimers()
    let done = false
    void timerDelay(900).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(899)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
})

describe('booking flow: the pending state lasts its minimum', () => {
  it('holds a fast answer until 900 ms after the submit started', async () => {
    vi.useFakeTimers()
    const submit = answerAfter(100)
    const port = portWith(submit)
    await fillDetails(port)
    press(port)

    await vi.advanceTimersByTimeAsync(899)
    expect(submit).toHaveBeenCalledOnce()
    expectPending(port)

    await vi.advanceTimersByTimeAsync(1)
    const view = screen(port)
    expect(view.details).toBeUndefined()
    expect(view.confirmation?.props['sumWhen']).toContain('10:00')
    expect(view.confirmation?.props['checkEntrance']).toBe('animate')
  })

  it('handles a slower answer as soon as it is in', async () => {
    vi.useFakeTimers()
    const port = portWith(answerAfter(1500))
    await fillDetails(port)
    press(port)

    await vi.advanceTimersByTimeAsync(1499)
    expectPending(port)
    await vi.advanceTimersByTimeAsync(1)
    expect(screen(port).confirmation).not.toBeUndefined()
  })

  it('holds a refusal as well, then shows it in the popup that stays open', async () => {
    const shown = deferred<undefined>()
    const delay = vi.fn<Delay>(() => shown.promise)
    flowProps = { delay }
    const port = portWith(vi.fn<BookingPort['submit']>(async () => rateLimited))
    await fillDetails(port)
    press(port)
    await flush()

    expect(delay.mock.calls).toEqual([[900]])
    expectPending(port)

    shown.resolve(undefined)
    await flush()
    expect(popup(port).props).toMatchObject({ bookBusy: false, submitError: t.errRateLimited })
  })

  it('confirms the booking after the minimum when the visitor closed the popup meanwhile', async () => {
    const shown = deferred<undefined>()
    flowProps = { delay: () => shown.promise }
    const port = portWith(vi.fn<BookingPort['submit']>(bookedAnswer))
    await fillDetails(port)
    press(port)
    ;(popup(port).props['onClose'] as () => void)()
    await flush()
    expect(screen(port).confirmation).toBeUndefined()

    shown.resolve(undefined)
    await flush()
    expect(screen(port).confirmation?.props['sumWhen']).toContain('10:00')
  })

  it.each([
    [
      'for a visitor who prefers reduced motion',
      () => vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) }),
    ],
    [
      'in the Studio',
      () => {
        reads.context.value = null
      },
    ],
  ])('has no minimum %s', async (_label, arrange) => {
    arrange()
    const delay = vi.fn<Delay>(() => new Promise(() => undefined))
    flowProps = { delay }
    const port = portWith(vi.fn<BookingPort['submit']>(bookedAnswer))
    await fillDetails(port)
    press(port)
    await flush()

    expect(delay).not.toHaveBeenCalled()
    expect(screen(port).confirmation).not.toBeUndefined()
  })
})
