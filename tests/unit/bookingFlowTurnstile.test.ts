import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingFlow } from '../../modules/public-web/src/booking/BookingFlow'
import { DetailsDialog } from '../../modules/public-web/src/booking/DetailsDialog'
import type { BookingResult } from '../../modules/public-web/src/booking/domain'
import type { AvailabilityResult, BookingPort } from '../../modules/public-web/src/booking/port'
import { bookingStrings } from '../../modules/public-web/src/i18n/index'
import { installFakePage } from './helpers/fakeFocus'
import { mount, nodes, render, reset, type RenderedNode } from './helpers/fakeHooks'

const reads = vi.hoisted(() => ({ roster: vi.fn(), services: vi.fn() }))
// Outside the Studio `useContext` answers `undefined`; only then does the flow ask for a token.
vi.mock('preact/hooks', async () => ({
  ...(await import('./helpers/fakeHooks')),
  useContext: (): undefined => undefined,
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
  turnstileConfigured: true,
}))

const t = bookingStrings('sv')
const barber = { barber: { id: 'b1', name: 'Barber One', ig: 'one' }, copy: null, photoUrl: null }
const service = { id: 's1', name: 'Cut', price: 300, dur: 30 }
const contact = { name: 'Ada Lovelace', phone: '070 123 45 67', email: 'ada@example.test' }
const taken: BookingResult = { ok: false, error: { kind: 'unavailable', message: t.errSlotTaken } }
const rateLimited: BookingResult = {
  ok: false,
  error: { kind: 'rate_limited', message: t.errRateLimited },
}
const unanswered: BookingResult = {
  ok: false,
  error: { kind: 'unconfirmed', message: t.errUnconfirmed },
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

// The pending state's minimum is not what these tests are about (bookingPendingHold.test.ts).
const noDelay = (): Promise<void> => Promise.resolve()

function screen(port: BookingPort) {
  const all = nodes(
    render(() =>
      BookingFlow({
        port,
        defaultLang: 'sv',
        clock: () => new Date(2040, 2, 12, 9),
        delay: noDelay,
      }),
    ),
  )
  return {
    all,
    barbers: all.filter((node) => node.props['data-testid'] === 'booking-barber-option'),
    services: all.filter((node) => node.props['data-testid'] === 'booking-service-option'),
    chips: all.filter((node) => node.type === 'button' && /^\d\d:\d\d$/.test(text(node))),
    details: all.find((node) => node.type === DetailsDialog),
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

function widget(port: BookingPort): RenderedNode {
  const node = popup(port).props['turnstile']
  if (typeof node !== 'object' || node === null) throw new Error('Missing Turnstile widget')
  return node as RenderedNode
}

function giveToken(port: BookingPort, token: string): void {
  ;(widget(port).props['onToken'] as (token: string) => void)(token)
}

/** Barber, first bookable day, service and 10:00, with the details filled in. */
async function fillDetails(port: BookingPort): Promise<void> {
  click(screen(port).barbers[0])
  click(
    screen(port).all.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-pressed'] === false &&
        node.props['disabled'] === false,
    ),
  )
  click(screen(port).services[0])
  screen(port)
  mount()
  await flush()
  click(screen(port).chips[0])
  const type = (handler: string, value: string): void => {
    const input = popup(port).props[handler] as (event: unknown) => void
    input({ currentTarget: { value } })
  }
  type('onName', contact.name)
  type('onPhone', contact.phone)
  type('onEmail', contact.email)
}

async function book(port: BookingPort): Promise<void> {
  ;(popup(port).props['onBook'] as () => void)()
  await flush()
}

const close = (port: BookingPort): void => (popup(port).props['onClose'] as () => void)()

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

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  installFakePage()
  reads.roster.mockReturnValue({ roster: [barber], status: 'ready', retry: vi.fn() })
  reads.services.mockReturnValue({ services: [service], status: 'ready', retry: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('booking flow: the Turnstile token after a submit', () => {
  it('sends nothing until the widget has given a token', async () => {
    const submit = vi.fn<BookingPort['submit']>(bookedAnswer)
    const port = portWith(submit)
    await fillDetails(port)
    expect(popup(port).props['bookDisabled']).toBe(true)
    await book(port)
    expect(submit).not.toHaveBeenCalled()

    giveToken(port, 'token-1')
    expect(popup(port).props['bookDisabled']).toBe(false)
    await book(port)
    expect(submit.mock.calls.map(([booking]) => booking.turnstileToken)).toEqual(['token-1'])
  })

  // A token is single-use, and this popup's widget gave the one that was sent.
  it.each<[string, BookingPort['submit']]>([
    ['is refused for a reason that keeps the popup open', async () => rateLimited],
    [
      'ends without an answer',
      async () => {
        throw new Error('network')
      },
    ],
  ])(
    'asks the widget of the open popup for a fresh token when the submit %s',
    async (_label, answer) => {
      const submit = vi.fn<BookingPort['submit']>(answer)
      const port = portWith(submit)
      await fillDetails(port)
      giveToken(port, 'token-1')
      expect(widget(port).props['resetNonce']).toBe(0)

      await book(port)

      expect(submit.mock.calls.map(([booking]) => booking.turnstileToken)).toEqual(['token-1'])
      expect(popup(port).props['sumWhen']).toContain('10:00')
      expect(widget(port).props['resetNonce']).toBe(1)
    },
  )

  // The new popup's widget holds an unspent token; a reset would discard it and lock booking.
  it.each([
    ['is refused as unavailable', taken],
    ['is refused for another reason', rateLimited],
    ['ends without an answer', unanswered],
  ] as const)(
    'leaves the widget of a popup opened since alone when the earlier submit %s',
    async (_label, earlierAnswer) => {
      const answer = deferred<BookingResult>()
      const submit = vi
        .fn<BookingPort['submit']>()
        .mockReturnValueOnce(answer.promise)
        .mockImplementation(bookedAnswer)
      const port = portWith(submit)
      await fillDetails(port)
      giveToken(port, 'token-1')
      await book(port)

      close(port)
      click(screen(port).chips[1])
      giveToken(port, 'token-2')
      expect(popup(port).props['sumWhen']).toContain('10:30')

      answer.resolve(earlierAnswer)
      await flush()

      expect(popup(port).props['sumWhen']).toContain('10:30')
      expect(widget(port).props['resetNonce']).toBe(0)
      expect(popup(port).props['bookDisabled']).toBe(false)
      await book(port)
      expect(submit.mock.calls.map(([booking]) => booking.turnstileToken)).toEqual([
        'token-1',
        'token-2',
      ])
    },
  )

  it('leaves it alone as well while the new widget has not given its token yet', async () => {
    const answer = deferred<BookingResult>()
    const submit = vi.fn<BookingPort['submit']>(() => answer.promise)
    const port = portWith(submit)
    await fillDetails(port)
    giveToken(port, 'token-1')
    await book(port)

    close(port)
    click(screen(port).chips[1])
    expect(popup(port).props['bookDisabled']).toBe(true)

    answer.resolve(taken)
    await flush()

    expect(popup(port).props['sumWhen']).toContain('10:30')
    expect(widget(port).props['resetNonce']).toBe(0)
  })
})
