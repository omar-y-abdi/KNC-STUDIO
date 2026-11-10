import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingFlow,
  type BookingFlowProps,
} from '../../modules/public-web/src/booking/BookingFlow'
import { ConfirmationDialog } from '../../modules/public-web/src/booking/ConfirmationDialog'
import { DetailsDialog } from '../../modules/public-web/src/booking/DetailsDialog'
import type { BookingResult } from '../../modules/public-web/src/booking/domain'
import type { AvailabilityResult, BookingPort } from '../../modules/public-web/src/booking/port'
import { appStrings, bookingStrings, type Lang } from '../../modules/public-web/src/i18n/index'
import { fakeElement, installFakePage, type FakeElement, type FakePage } from './helpers/fakeFocus'
import { mount, nodes, render, reset, useEffect, type RenderedNode } from './helpers/fakeHooks'
import { unhandledRejectionsDuring } from './helpers/unhandledRejections'

// The real booking flow driven through each outcome of its three reads (loading, empty, ready,
// failed) and through the answers a submit can have besides "booked".

const reads = vi.hoisted(() => ({ roster: vi.fn(), services: vi.fn() }))
vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
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

const t = bookingStrings('sv')
const EMPTY_STATE_MESSAGES = [t.noBarbers, t.noServices, t.noSlots]
const barber = { barber: { id: 'b1', name: 'Barber One', ig: 'one' }, copy: null, photoUrl: null }
const service = { id: 's1', name: 'Cut', price: 300, dur: 30 }
const retryRoster = vi.fn()
const retryServices = vi.fn()
let page: FakePage
/** Props a test adds to every render of the flow (the shell's callbacks). */
let flowProps: Partial<BookingFlowProps> = {}

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

const pressed = (node: RenderedNode): unknown => node.props['aria-pressed']

function screen(port: BookingPort, defaultLang: Lang = 'sv') {
  const tree = render(() =>
    BookingFlow({ port, defaultLang, clock: () => new Date(2040, 2, 12, 9), ...flowProps }),
  )
  const all = nodes(tree)
  const withProp = (name: string, value: unknown): RenderedNode[] =>
    all.filter((node) => node.props[name] === value)
  return {
    all,
    text: text(tree),
    alerts: withProp('role', 'alert'),
    statuses: withProp('role', 'status'),
    headings: withProp('role', 'heading'),
    barbers: withProp('data-testid', 'booking-barber-option'),
    services: withProp('data-testid', 'booking-service-option'),
    chips: all.filter((node) => node.type === 'button' && /^\d\d:\d\d$/.test(text(node))),
    details: all.find((node) => node.type === DetailsDialog),
    confirmation: all.find((node) => node.type === ConfirmationDialog),
  }
}

/** Give a step's status region a DOM stand-in, and return the stand-in for that step's title. The
 * title is a text without a `tabindex` of its own, as the rendered one is. */
function stepTitle(region: RenderedNode | undefined): FakeElement {
  const target = (region as (RenderedNode & { readonly ref?: { current: unknown } }) | undefined)
    ?.ref
  if (target === undefined) throw new Error('Missing status region ref')
  const title = fakeElement(page)
  target.current = {
    parentElement: {
      querySelector: (selector: string) => (selector === '[role="heading"]' ? title : null),
    },
  }
  return title
}

/** The time step with the parts of the page the flow asks it for: its title, the line that says
 * why a time was refused, and the flow's root, which holds exactly the elements in `inFlow`. */
function timeStep(region: RenderedNode | undefined): {
  readonly title: FakeElement
  readonly refusalLine: { readonly scrollIntoView: ReturnType<typeof vi.fn> }
  readonly inFlow: Set<unknown>
} {
  const target = (region as (RenderedNode & { readonly ref?: { current: unknown } }) | undefined)
    ?.ref
  if (target === undefined) throw new Error('Missing status region ref')
  const title = fakeElement(page)
  const refusalLine = { scrollIntoView: vi.fn() }
  const inFlow = new Set<unknown>()
  const flowRoot = { contains: (element: unknown): boolean => inFlow.has(element) }
  target.current = {
    parentElement: {
      querySelector: (selector: string) =>
        selector === '[role="heading"]'
          ? title
          : selector === '[role="alert"]'
            ? refusalLine
            : null,
    },
    closest: (selector: string) =>
      selector === '[data-knc-fold="booking-flow"]' ? flowRoot : null,
  }
  return { title, refusalLine, inFlow }
}

/** The days the visitor can still choose (the chosen one is not among them). */
function selectableDays(port: BookingPort): RenderedNode[] {
  return screen(port).all.filter(
    (node) =>
      node.type === 'button' &&
      typeof node.props['aria-label'] === 'string' &&
      node.props['aria-pressed'] === false &&
      node.props['disabled'] === false,
  )
}

/** Let resolved port promises run their handlers. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

/** Run the last render's effects (the availability read among them), then render the outcome. */
async function settle(port: BookingPort): Promise<ReturnType<typeof screen>> {
  screen(port)
  mount()
  await flush()
  return screen(port)
}

/** Barber, then the first bookable day, then the service: the selection the time step reads for. */
function chooseBarberDayService(port: BookingPort): void {
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
}

/** The dependency list the availability effect was last given: Preact reads again when it changes. */
function availabilityDeps(port: BookingPort): readonly unknown[] {
  const lists = useEffect.mock.calls
    .map((call) => (call as readonly unknown[])[1])
    .filter((deps): deps is readonly unknown[] => Array.isArray(deps) && deps[0] === port)
  const last = lists.at(-1)
  if (last === undefined) throw new Error('Missing availability effect')
  return last
}

function portWith(
  availability: BookingPort['availability'],
  submit: BookingPort['submit'] = vi.fn<BookingPort['submit']>(),
): BookingPort {
  return { availability, submit }
}

const times = (...list: string[]): AvailabilityResult => ({ ok: true, times: list })

/** A promise the test settles when it chooses to: an answer that is still on its way. */
function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
} {
  let fulfil: (value: T) => void = () => undefined
  let fail: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    fulfil = resolve
    fail = reject
  })
  return { promise, resolve: (value) => fulfil(value), reject: (reason) => fail(reason) }
}

const contact = { name: 'Ada Lovelace', phone: '070 123 45 67', email: 'ada@example.test' }
// The flow writes its lines from the kind of an error, in the language on screen. The messages
// here are the adapter's; the flow does not read them.
const taken: BookingResult = { ok: false, error: { kind: 'unavailable', message: t.errSlotTaken } }
const unanswered: BookingResult = {
  ok: false,
  error: { kind: 'unconfirmed', message: t.errUnconfirmed },
}
const rateLimited: BookingResult = {
  ok: false,
  error: { kind: 'rate_limited', message: t.errRateLimited },
}
const bookedAnswer: BookingPort['submit'] = async (booking) => ({
  ok: true,
  booking,
  links: { icsHref: 'ics', gcalHref: 'gcal', mapsHref: 'maps' },
})
const twoTimes = (): BookingPort['availability'] =>
  vi.fn<BookingPort['availability']>(async () => times('10:00', '10:30'))

/** The details popup as last rendered. */
function popup(port: BookingPort): RenderedNode {
  const details = screen(port).details
  if (details === undefined) throw new Error('Missing details popup')
  return details
}

/** Choose 10:00 and fill the details popup; returns the popup as last rendered. */
async function fillDetails(port: BookingPort): Promise<RenderedNode> {
  chooseBarberDayService(port)
  click((await settle(port)).chips[0])
  const type = (handler: string, value: string): void => {
    const input = popup(port).props[handler] as (event: unknown) => void
    input({ currentTarget: { value } })
  }
  type('onName', contact.name)
  type('onPhone', contact.phone)
  type('onEmail', contact.email)
  return popup(port)
}

/** Press the popup's book button and let the port's answer, if it has one, be handled. */
async function book(details: RenderedNode): Promise<void> {
  ;(details.props['onBook'] as () => void)()
  await flush()
}

const close = (details: RenderedNode): void => (details.props['onClose'] as () => void)()

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  flowProps = {}
  page = installFakePage()
  reads.roster.mockReturnValue({ roster: [barber], status: 'ready', retry: retryRoster })
  reads.services.mockReturnValue({ services: [service], status: 'ready', retry: retryServices })
})
afterEach(() => vi.unstubAllGlobals())

describe('booking flow: barbers', () => {
  const port = portWith(vi.fn<BookingPort['availability']>())

  it('says the roster is loading inside the step status region', () => {
    reads.roster.mockReturnValue({ roster: [], status: 'loading', retry: retryRoster })
    const view = screen(port)
    expect(view.statuses.map(text)).toEqual([t.loadingBarbers])
    expect(view.alerts).toEqual([])
    expect(view.barbers).toEqual([])
  })

  it('says there are no barbers only for a real, empty answer', () => {
    reads.roster.mockReturnValue({ roster: [], status: 'ready', retry: retryRoster })
    const view = screen(port)
    expect(view.statuses.map(text)).toEqual([t.noBarbers])
    expect(view.alerts).toEqual([])
  })

  it('keeps the status region in place, empty, once barbers are listed', () => {
    const view = screen(port)
    expect(view.barbers).toHaveLength(1)
    expect(view.statuses.map(text)).toEqual([''])
  })

  it('shows a failed read as an alert with a retry, never as "no barbers"', () => {
    reads.roster.mockReturnValue({ roster: [], status: 'error', retry: retryRoster })
    const view = screen(port)
    expect(view.alerts.map(text)).toEqual([`${t.errLoadBarbers} ${t.retry}`])
    expect(view.statuses.map(text)).toEqual([''])
    for (const message of EMPTY_STATE_MESSAGES) expect(view.text).not.toContain(message)
    expect(view.all.some((node) => node.props['data-testid'] === 'booking-barber-empty')).toBe(
      false,
    )

    click(nodes(view.alerts).find((node) => node.type === 'button'))
    expect(retryRoster).toHaveBeenCalledOnce()
  })

  it('moves focus to its own step title when the retry button gives way to the read', () => {
    // A barber is chosen, so all three steps are on the page when the roster read fails.
    click(screen(port).barbers[0])
    reads.roster.mockReturnValue({ roster: [], status: 'error', retry: retryRoster })
    const view = screen(port)
    const [barbersTitle, servicesTitle, timesTitle] = view.statuses.map(stepTitle)
    expect(view.statuses).toHaveLength(3)

    click(
      nodes(view.alerts.filter((alert) => text(alert).startsWith(t.errLoadBarbers))).find(
        (node) => node.type === 'button',
      ),
    )
    expect(retryRoster).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(barbersTitle)
    expect(servicesTitle?.focus).not.toHaveBeenCalled()
    expect(timesTitle?.focus).not.toHaveBeenCalled()
  })
})

describe('booking flow: services', () => {
  const port = portWith(vi.fn<BookingPort['availability']>())
  const chooseBarberAndDay = (): void => {
    reads.services.mockReturnValueOnce({ services: [], status: 'loading', retry: retryServices })
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
  }

  it('says the menu is loading, then empty only for a real, empty answer', () => {
    chooseBarberAndDay()
    reads.services.mockReturnValue({ services: [], status: 'loading', retry: retryServices })
    expect(screen(port).statuses.map(text)).toEqual(['', t.loadingServices, ''])
    reads.services.mockReturnValue({ services: [], status: 'ready', retry: retryServices })
    const view = screen(port)
    expect(view.statuses.map(text)).toEqual(['', t.noServices, ''])
    expect(view.alerts).toEqual([])
  })

  it('shows a failed read as an alert with a retry, never as "no services"', () => {
    chooseBarberAndDay()
    reads.services.mockReturnValue({ services: [], status: 'error', retry: retryServices })
    const view = screen(port)
    expect(view.alerts.map(text)).toEqual([`${t.errLoadServices} ${t.retry}`])
    expect(view.statuses.map(text)).toEqual(['', '', ''])
    for (const message of EMPTY_STATE_MESSAGES) expect(view.text).not.toContain(message)

    // The retry button leaves the page with the failure line: its own step's title takes focus.
    const [barbersTitle, servicesTitle, timesTitle] = view.statuses.map(stepTitle)
    click(nodes(view.alerts).find((node) => node.type === 'button'))
    expect(retryServices).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(servicesTitle)
    expect(barbersTitle?.focus).not.toHaveBeenCalled()
    expect(timesTitle?.focus).not.toHaveBeenCalled()
  })

  it('marks the chosen service as pressed', () => {
    chooseBarberAndDay()
    expect(screen(port).services.map(pressed)).toEqual([false])
    click(screen(port).services[0])
    expect(screen(port).services.map(pressed)).toEqual([true])
  })

  // Before a day is chosen the step only asks for one. It says nothing about a menu, whatever the
  // menu read reports for a selection that is not complete.
  it('says nothing about the menu before a day is chosen', () => {
    click(screen(port).barbers[0])
    reads.services.mockReturnValue({ services: [], status: 'loading', retry: retryServices })
    expect(screen(port).statuses.map(text)).toEqual(['', '', ''])

    reads.services.mockReturnValue({ services: [], status: 'ready', retry: retryServices })
    const view = screen(port)
    expect(view.statuses.map(text)).toEqual(['', '', ''])
    expect(view.text).toContain(t.pickDayForService)
    expect(view.text).not.toContain(t.noServices)
  })
})

describe('booking flow: times', () => {
  it('says the times are loading while the read is in flight', () => {
    const port = portWith(vi.fn<BookingPort['availability']>(() => new Promise(() => undefined)))
    chooseBarberDayService(port)
    screen(port)
    mount()
    const view = screen(port)
    expect(view.statuses.map(text)).toEqual(['', '', t.loadingTimes])
    expect(view.alerts).toEqual([])
  })

  it('offers each returned time as a chip and marks the chosen one as pressed', async () => {
    const port = portWith(twoTimes())
    chooseBarberDayService(port)
    const view = await settle(port)
    expect(view.chips.map(text)).toEqual(['10:00', '10:30'])
    expect(view.chips.map(pressed)).toEqual([false, false])
    expect(view.statuses.map(text)).toEqual(['', '', ''])

    click(view.chips[1])
    expect(screen(port).chips.map(pressed)).toEqual([false, true])
  })

  it('says there are no times only for a real, empty answer', async () => {
    const port = portWith(vi.fn<BookingPort['availability']>(async () => times()))
    chooseBarberDayService(port)
    const view = await settle(port)
    expect(view.statuses.map(text)).toEqual(['', '', t.noSlots])
    expect(view.alerts).toEqual([])
  })

  it.each([
    ['a failed read', async (): Promise<AvailabilityResult> => ({ ok: false })],
    [
      'a rejected read',
      async (): Promise<AvailabilityResult> => {
        throw new Error('chunk failed to load')
      },
    ],
  ] as const)('shows %s as an alert with a retry, never as "no times"', async (_label, read) => {
    const availability = vi
      .fn<BookingPort['availability']>()
      .mockImplementationOnce(read)
      .mockResolvedValueOnce(times('10:00'))
    const port = portWith(availability)
    chooseBarberDayService(port)
    const failed = await settle(port)
    expect(failed.alerts.map(text)).toEqual([`${t.errLoadTimes} ${t.retry}`])
    expect(failed.statuses.map(text)).toEqual(['', '', ''])
    expect(failed.chips).toEqual([])
    for (const message of EMPTY_STATE_MESSAGES) expect(failed.text).not.toContain(message)

    // Retry changes a dependency of the read, so the same selection is read again. The button
    // leaves the page with the failure line, so its own step's title takes focus first.
    const depsWhenFailed = availabilityDeps(port)
    const [barbersTitle, servicesTitle, timesTitle] = failed.statuses.map(stepTitle)
    click(nodes(failed.alerts).find((node) => node.type === 'button'))
    expect(page.activeElement).toBe(timesTitle)
    expect(barbersTitle?.focus).not.toHaveBeenCalled()
    expect(servicesTitle?.focus).not.toHaveBeenCalled()
    const retried = await settle(port)
    expect(availabilityDeps(port)).not.toEqual(depsWhenFailed)
    expect(availability).toHaveBeenCalledTimes(2)
    expect(availability.mock.calls[1]).toEqual(availability.mock.calls[0])
    expect(retried.chips.map(text)).toEqual(['10:00'])
    expect(retried.alerts).toEqual([])
  })
})

// Changing only the service goes from one complete selection to another: the first render after
// it, before any effect has run, must already show the new selection as loading.
describe('booking flow: the times of another selection', () => {
  const shave = { id: 's2', name: 'Shave', price: 200, dur: 20 }

  it.each([
    ['its "no times"', async (): Promise<AvailabilityResult> => times()],
    ['its times', async (): Promise<AvailabilityResult> => times('10:00')],
    ['its failed read', async (): Promise<AvailabilityResult> => ({ ok: false })],
  ] as const)(
    'shows the new selection as loading, never the previous one with %s',
    async (_label, firstAnswer) => {
      reads.services.mockReturnValue({
        services: [service, shave],
        status: 'ready',
        retry: retryServices,
      })
      const availability = vi
        .fn<BookingPort['availability']>()
        .mockImplementationOnce(firstAnswer)
        .mockReturnValue(new Promise(() => undefined))
      const port = portWith(availability)
      chooseBarberDayService(port)
      const before = await settle(port)
      // The answer for the first service is on the page, whichever it was.
      expect(before.statuses.map(text)).not.toEqual(['', '', t.loadingTimes])

      click(before.services[1])
      const view = screen(port)
      expect(view.services.map(pressed)).toEqual([false, true])
      expect(view.statuses.map(text)).toEqual(['', '', t.loadingTimes])
      expect(view.chips).toEqual([])
      expect(view.alerts).toEqual([])
      expect(view.text).not.toContain(t.noSlots)

      // The same holds once the effect has started the new read.
      mount()
      expect(screen(port).statuses.map(text)).toEqual(['', '', t.loadingTimes])
      expect(availability).toHaveBeenCalledTimes(2)
      expect(availability.mock.calls[1]?.[0]).toMatchObject({ serviceId: shave.id })
    },
  )

  // An earlier read of the same selection that answers or fails after a newer one is dropped. Each
  // `mount()` starts a read and hands back what stops the reads before it.
  type TimesRead = ReturnType<typeof deferred<AvailabilityResult>>
  it.each<[string, (read: TimesRead) => void]>([
    ['answers', (read) => read.resolve(times('09:00'))],
    ['fails', (read) => read.reject(new Error('answered too late'))],
  ])(
    'drops an earlier read of the selection that %s after a newer one has started',
    async (_label, settleEarlier) => {
      reads.services.mockReturnValue({
        services: [service, shave],
        status: 'ready',
        retry: retryServices,
      })
      const earlier = deferred<AvailabilityResult>()
      const newest = deferred<AvailabilityResult>()
      const availability = vi
        .fn<BookingPort['availability']>()
        .mockReturnValueOnce(earlier.promise)
        .mockReturnValueOnce(new Promise(() => undefined))
        .mockReturnValueOnce(newest.promise)
      const port = portWith(availability)
      chooseBarberDayService(port)
      screen(port)
      const leaveFirst = mount()
      click(screen(port).services[1])
      leaveFirst()
      screen(port)
      const leaveSecond = mount()
      click(screen(port).services[0])
      leaveSecond()
      screen(port)
      mount()
      expect(availability).toHaveBeenCalledTimes(3)
      expect(availability.mock.calls[2]).toEqual(availability.mock.calls[0])

      settleEarlier(earlier)
      await flush()
      const waiting = screen(port)
      expect(waiting.statuses.map(text)).toEqual(['', '', t.loadingTimes])
      expect(waiting.chips).toEqual([])
      expect(waiting.alerts).toEqual([])

      newest.resolve(times('10:00'))
      await flush()
      expect(screen(port).chips.map(text)).toEqual(['10:00'])
    },
  )

  // A refusal is about the selection it was given for. Once the visitor has been to another
  // selection it is gone, also when they come back to the first.
  it('does not bring a refusal back when the visitor returns to its selection', async () => {
    reads.services.mockReturnValue({
      services: [service, shave],
      status: 'ready',
      retry: retryServices,
    })
    const port = portWith(
      twoTimes(),
      vi.fn<BookingPort['submit']>(async () => taken),
    )
    await book(await fillDetails(port))
    expect((await settle(port)).alerts.map(text)).toEqual([t.errSlotTaken])

    click(screen(port).services[1])
    expect((await settle(port)).alerts).toEqual([])
    click(screen(port).services[0])
    const back = await settle(port)
    expect(back.services.map(pressed)).toEqual([true, false])
    expect(back.alerts).toEqual([])
  })
})

describe('booking flow: a refused time', () => {
  it('closes the popup, deselects the time, reads the day again and keeps the details', async () => {
    const availability = vi
      .fn<BookingPort['availability']>()
      .mockResolvedValueOnce(times('10:00', '10:30'))
      .mockResolvedValue(times('10:30'))
    const submit = vi.fn<BookingPort['submit']>(async () => taken)
    const port = portWith(availability, submit)
    const details = await fillDetails(port)
    expect(screen(port).chips.map(pressed)).toEqual([true, false])
    const depsWhenSubmitted = availabilityDeps(port)

    await book(details)

    expect(submit).toHaveBeenCalledOnce()
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      barber: barber.barber,
      service,
      customerName: contact.name,
      phone: '0701234567',
      email: contact.email,
    })
    const refused = screen(port)
    expect(refused.details).toBeUndefined()
    expect(refused.chips.map(pressed)).toEqual([false, false])
    expect(refused.alerts.map(text)).toEqual([t.errSlotTaken])
    // The refusal changed a dependency of the availability read: the day is read again.
    expect(availabilityDeps(port)).not.toEqual(depsWhenSubmitted)

    // The closed popup hands focus back to a chip the reload removes: the step's title takes it,
    // quietly (focusable, and marked as holding a quiet focus, only while it does).
    const title = stepTitle(refused.statuses[2])
    const reloaded = await settle(port)
    expect(title.focus).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(title)
    expect([...title.attributes]).toEqual([
      ['tabindex', '-1'],
      ['data-quiet-focus', ''],
    ])
    expect(availability).toHaveBeenCalledTimes(2)
    expect(availability.mock.calls[1]).toEqual(availability.mock.calls[0])
    expect(reloaded.chips.map(text)).toEqual(['10:30'])
    expect(reloaded.alerts.map(text)).toEqual([t.errSlotTaken])

    // The move happens once. Later renders leave the focus where the visitor has put it since.
    const elsewhere = fakeElement(page, 'control')
    elsewhere.focus()
    expect([...title.attributes]).toEqual([])
    await settle(port)
    expect(title.focus).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(elsewhere)

    click(reloaded.chips[0])
    const reopened = screen(port)
    expect(reopened.details?.props).toMatchObject({
      nameValue: contact.name,
      phoneValue: contact.phone,
      emailValue: contact.email,
      submitError: null,
    })
    expect(reopened.alerts).toEqual([])
  })

  it('keeps the popup open with the message for every other refusal', async () => {
    const port = portWith(
      twoTimes(),
      vi.fn<BookingPort['submit']>(async () => rateLimited),
    )
    await book(await fillDetails(port))

    const view = screen(port)
    expect(view.details?.props).toMatchObject({
      nameValue: contact.name,
      submitError: t.errRateLimited,
    })
    expect(view.chips.map(pressed)).toEqual([true, false])
    expect(view.alerts).toEqual([])
  })

  it("leaves the visitor's new time and its popup alone when the refusal is of an earlier time", async () => {
    const answer = deferred<BookingResult>()
    const availability = twoTimes()
    const port = portWith(
      availability,
      vi.fn<BookingPort['submit']>(() => answer.promise),
    )
    const details = await fillDetails(port)
    await book(details)

    // While the answer is on its way the visitor closes the popup and chooses 10:30.
    close(details)
    click(screen(port).chips[1])
    const moved = screen(port)
    expect(moved.details?.props['sumWhen']).toContain('10:30')
    const depsWhenMoved = availabilityDeps(port)
    const timesTitle = stepTitle(moved.statuses[2])

    answer.resolve(taken)
    await flush()

    const view = screen(port)
    expect(view.details?.props['sumWhen']).toContain('10:30')
    expect(view.details?.props).toMatchObject({ nameValue: contact.name, submitError: null })
    expect(view.chips.map(pressed)).toEqual([false, true])
    expect(view.alerts).toEqual([])
    // Only the times are read again; the focus stays where it is.
    expect(availabilityDeps(port)).not.toEqual(depsWhenMoved)
    await settle(port)
    expect(timesTitle.focus).not.toHaveBeenCalled()
    expect(screen(port).details?.props['sumWhen']).toContain('10:30')
  })

  // The refusal is of one start time, with one barber, on one day. The same clock time anywhere
  // else is another time: the visitor's choice there, and its popup, stay.
  const barberTwo = {
    barber: { id: 'b2', name: 'Barber Two', ig: 'two' },
    copy: null,
    photoUrl: null,
  }
  it.each<[string, (port: BookingPort) => void]>([
    ['on another day', (port) => click(selectableDays(port)[0])],
    [
      'with another barber',
      (port) => {
        click(screen(port).barbers[1])
        click(selectableDays(port)[0])
      },
    ],
  ])(
    'leaves the same clock time %s alone when the earlier time is refused',
    async (_label, goElsewhere) => {
      reads.roster.mockReturnValue({
        roster: [barber, barberTwo],
        status: 'ready',
        retry: retryRoster,
      })
      const answer = deferred<BookingResult>()
      const port = portWith(
        twoTimes(),
        vi.fn<BookingPort['submit']>(() => answer.promise),
      )
      const details = await fillDetails(port)
      const refused = [details.props['sumBarber'], details.props['sumWhen']]
      await book(details)

      close(details)
      goElsewhere(port)
      click(screen(port).services[0])
      click((await settle(port)).chips[0])
      const moved = popup(port)
      const chosen = [moved.props['sumBarber'], moved.props['sumWhen']]
      expect(moved.props['sumWhen']).toContain('10:00')
      expect(chosen).not.toEqual(refused)

      answer.resolve(taken)
      await flush()

      const view = screen(port)
      expect([view.details?.props['sumBarber'], view.details?.props['sumWhen']]).toEqual(chosen)
      expect(view.details?.props).toMatchObject({ nameValue: contact.name, submitError: null })
      expect(view.chips.map(pressed)).toEqual([true, false])
      expect(view.alerts).toEqual([])
    },
  )

  // A refusal that says what it was belongs to the popup of the time it refused. When that popup
  // is not the one open, its line stands in the time step: never in the popup of another time.
  it("shows another refusal in the time step, not in the popup of the visitor's new time", async () => {
    const answer = deferred<BookingResult>()
    const port = portWith(
      twoTimes(),
      vi.fn<BookingPort['submit']>(() => answer.promise),
    )
    const details = await fillDetails(port)
    await book(details)

    close(details)
    click(screen(port).chips[1])
    const depsWhenMoved = availabilityDeps(port)
    const step = timeStep(screen(port).statuses[2])

    answer.resolve(rateLimited)
    await flush()

    const view = screen(port)
    expect(view.details?.props['sumWhen']).toContain('10:30')
    expect(view.details?.props).toMatchObject({ nameValue: contact.name, submitError: null })
    expect(view.alerts.map(text)).toEqual([t.errRateLimited])
    // Nothing is deselected, nothing is read again, and the focus stays in the popup.
    expect(view.chips.map(pressed)).toEqual([false, true])
    expect(availabilityDeps(port)).toEqual(depsWhenMoved)
    await settle(port)
    expect(step.title.focus).not.toHaveBeenCalled()
    expect(step.refusalLine.scrollIntoView).not.toHaveBeenCalled()
  })

  it('shows it in the time step when no popup is open, and not in the popup opened next', async () => {
    const answer = deferred<BookingResult>()
    const port = portWith(
      twoTimes(),
      vi.fn<BookingPort['submit']>(() => answer.promise),
    )
    const details = await fillDetails(port)
    await book(details)
    close(details)
    expect(screen(port).details).toBeUndefined()
    const depsWhenClosed = availabilityDeps(port)

    answer.resolve(rateLimited)
    await flush()

    const view = screen(port)
    expect(view.details).toBeUndefined()
    expect(view.alerts.map(text)).toEqual([t.errRateLimited])
    expect(view.chips.map(pressed)).toEqual([true, false])
    expect(availabilityDeps(port)).toEqual(depsWhenClosed)

    // Choosing a time answers the line, and its popup opens without it.
    click(view.chips[1])
    const next = screen(port)
    expect(next.details?.props).toMatchObject({ nameValue: contact.name, submitError: null })
    expect(next.alerts).toEqual([])
  })

  // A port that does not book (the Studio's preview of the site) says so with a kind of its own.
  // The flow says that, in the language of the page, and not that a submit failed.
  it('says that the preview is read-only when the port does not book', async () => {
    const en = bookingStrings('en')
    const readOnly: BookingResult = {
      ok: false,
      error: { kind: 'read_only', message: 'Preview is read-only.' },
    }
    const port = portWith(
      twoTimes(),
      vi.fn<BookingPort['submit']>(async () => readOnly),
    )
    await book(await fillDetails(port))

    const view = screen(port)
    expect(view.details?.props).toMatchObject({
      nameValue: contact.name,
      submitError: t.errReadOnly,
    })
    expect(view.chips.map(pressed)).toEqual([true, false])
    expect(view.alerts).toEqual([])
    expect(screen(port, 'en').details?.props['submitError']).toBe(en.errReadOnly)
    expect(t.errReadOnly).toBe('Förhandsvisningen är skrivskyddad.')
    expect(en.errReadOnly).toBe('Preview is read-only.')
    expect(t.errReadOnly).not.toBe(t.errSubmit)
  })

  // Every line about a submit is kept as its reason and written when it is shown: a visitor who
  // changes language reads it in the language the page has then.
  it('writes a refusal in the language the page has when it is shown', async () => {
    const en = bookingStrings('en')
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    expect(screen(port).details?.props['submitError']).toBe(t.errRateLimited)
    expect(screen(port, 'en').details?.props['submitError']).toBe(en.errRateLimited)

    await book(popup(port))
    expect(screen(port).alerts.map(text)).toEqual([t.errSlotTaken])
    expect(screen(port, 'en').alerts.map(text)).toEqual([en.errSlotTaken])
    expect(en.errSlotTaken).not.toBe(t.errSlotTaken)
    expect(en.errRateLimited).not.toBe(t.errRateLimited)
  })

  // A visitor typing somewhere else (in "Mina bokningar", say) keeps their place; the line is
  // announced all the same.
  it.each([
    ['inside the flow', 'inside', true],
    ['on the page itself', 'body', true],
    ['in another part of the page', 'outside', false],
  ] as const)(
    'moves the focus to the time step only when it is its to move (focus %s)',
    async (_label, where, moved) => {
      const port = portWith(
        twoTimes(),
        vi.fn<BookingPort['submit']>(async () => taken),
      )
      const details = await fillDetails(port)
      const step = timeStep(screen(port).statuses[2])
      const focused = fakeElement(page, 'control')
      focused.focus()
      if (where === 'inside') step.inFlow.add(focused)
      if (where === 'body') Object.assign(page, { body: focused })

      await book(details)
      expect(screen(port).alerts.map(text)).toEqual([t.errSlotTaken])
      await settle(port)

      expect(page.activeElement).toBe(moved ? step.title : focused)
      expect(step.title.focus).toHaveBeenCalledTimes(moved ? 1 : 0)
      // With the focus goes the view: the line that says why is brought into view, without
      // animation, and only as far as needed.
      expect(step.refusalLine.scrollIntoView.mock.calls).toEqual(
        moved ? [[{ block: 'nearest', behavior: 'instant' }]] : [],
      )
    },
  )

  it('brings the line into view after the title has taken the focus', async () => {
    const port = portWith(
      twoTimes(),
      vi.fn<BookingPort['submit']>(async () => taken),
    )
    const details = await fillDetails(port)
    const step = timeStep(screen(port).statuses[2])
    await book(details)
    await settle(port)

    const [focusedAt = Infinity] = step.title.focus.mock.invocationCallOrder
    const [shownAt = -Infinity] = step.refusalLine.scrollIntoView.mock.invocationCallOrder
    expect(page.activeElement).toBe(step.title)
    expect(shownAt).toBeGreaterThan(focusedAt)
  })
})

describe('booking flow: one submit at a time', () => {
  it('does nothing on a second activation while a submit is on its way', async () => {
    const answer = deferred<BookingResult>()
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockReturnValueOnce(answer.promise)
      .mockResolvedValue(rateLimited)
    const port = portWith(twoTimes(), submit)
    const details = await fillDetails(port)

    await book(details)
    await book(details)
    await book(popup(port))
    expect(submit).toHaveBeenCalledOnce()

    // Once the answer is in, the visitor can try again.
    answer.resolve(rateLimited)
    await flush()
    expect(popup(port).props).toMatchObject({ submitError: t.errRateLimited })
    await book(popup(port))
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('submits nothing more once the booking exists, until the visitor starts over', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockImplementationOnce(bookedAnswer)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    const details = await fillDetails(port)
    await book(details)
    expect(screen(port).details).toBeUndefined()
    expect(screen(port).confirmation?.props['sumWhen']).toContain('10:00')

    // A second press of the popup's button that lands after the answer must not reach the server:
    // its refusal of the time just booked would close the booking's own summary.
    await book(details)
    expect(submit).toHaveBeenCalledOnce()
    const confirmed = screen(port)
    expect(confirmed.confirmation?.props['sumWhen']).toContain('10:00')
    expect(confirmed.chips.map(pressed)).toEqual([true, false])
    expect(confirmed.alerts).toEqual([])

    // "Book another time" starts over: the next booking is submitted (and here refused).
    ;(confirmed.confirmation?.props['onReset'] as () => void)()
    expect(screen(port).confirmation).toBeUndefined()
    await book(await fillDetails(port))
    expect(submit).toHaveBeenCalledTimes(2)
    expect(screen(port).details).toBeUndefined()
    expect(screen(port).alerts.map(text)).toEqual([t.errSlotTaken])
  })

  // Book pressed in another time's popup while a submit is on its way sends nothing and says why
  // there; only the popup whose submit is on its way is marked busy.
  it.each([
    ['a refusal', rateLimited, null, [t.errRateLimited]],
    ['no answer', unanswered, t.errUnconfirmed, []],
  ] as const)(
    'says in the popup of another time that a booking is being sent, until it gets %s',
    async (_label, firstAnswer, lineAfter, stepAfter) => {
      const answer = deferred<BookingResult>()
      const submit = vi
        .fn<BookingPort['submit']>()
        .mockReturnValueOnce(answer.promise)
        .mockImplementation(bookedAnswer)
      const port = portWith(twoTimes(), submit)
      const details = await fillDetails(port)
      expect(details.props['bookBusy']).toBe(false)
      await book(details)
      expect(popup(port).props).toMatchObject({ bookBusy: true, submitError: null })

      close(details)
      click(screen(port).chips[1])
      expect(popup(port).props).toMatchObject({ bookBusy: false, submitError: null })
      await book(popup(port))

      expect(submit).toHaveBeenCalledOnce()
      const waiting = popup(port)
      expect(waiting.props['sumWhen']).toContain('10:30')
      expect(waiting.props).toMatchObject({
        bookBusy: false,
        nameValue: contact.name,
        submitError: t.errSubmitPending,
      })

      answer.resolve(firstAnswer)
      await flush()
      const view = screen(port)
      expect(view.details?.props).toMatchObject({ bookBusy: false, submitError: lineAfter })
      expect(view.alerts.map(text)).toEqual(stepAfter)

      // The first submit is over: this time can be booked now.
      await book(popup(port))
      expect(submit).toHaveBeenCalledTimes(2)
      expect(screen(port).confirmation?.props['sumWhen']).toContain('10:30')
    },
  )

  // The shell is told about the booking last. Whatever its callback does, the booking exists and
  // the confirmation shows it: a failure in there is not a failed submit.
  it('shows the booking when the completion callback throws', async () => {
    const failure = new Error('callback failed')
    flowProps = {
      onBookingComplete: () => {
        throw failure
      },
    }
    const submit = vi.fn<BookingPort['submit']>(bookedAnswer)
    const port = portWith(twoTimes(), submit)
    const details = await fillDetails(port)

    const unhandled = await unhandledRejectionsDuring(() => book(details))

    // The callback's own failure is not swallowed, and not taken for a failed submit.
    expect(unhandled).toEqual([failure])
    const view = screen(port)
    expect(submit).toHaveBeenCalledOnce()
    expect(view.confirmation?.props['sumWhen']).toContain('10:00')
    expect(view.details).toBeUndefined()
    expect(view.alerts).toEqual([])
  })

  // Choosing a barber takes the confirmation away without "book another time". From there the
  // visitor is making a new booking, and it must reach the server.
  it('submits the next booking once a barber is chosen again after a booking', async () => {
    const submit = vi.fn<BookingPort['submit']>(bookedAnswer)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    expect(screen(port).confirmation).toBeDefined()

    const again = await fillDetails(port)
    expect(screen(port).confirmation).toBeUndefined()
    await book(again)

    expect(submit).toHaveBeenCalledTimes(2)
    expect(screen(port).confirmation?.props['sumWhen']).toContain('10:00')
  })
})

// Such a submit may have booked the time, so every details popup warns, without blocking, until a
// booking goes through or the visitor starts over.
describe('booking flow: a submit that ended without an answer', () => {
  it.each([
    ['came back without a readable answer', async (): Promise<BookingResult> => unanswered],
    [
      'threw',
      async (): Promise<BookingResult> => {
        throw new Error('network')
      },
    ],
  ] as const)(
    'says that the booking may have gone through when the submit %s',
    async (_label, firstAnswer) => {
      const port = portWith(twoTimes(), vi.fn<BookingPort['submit']>(firstAnswer))
      await book(await fillDetails(port))

      const view = screen(port)
      expect(view.details?.props).toMatchObject({
        nameValue: contact.name,
        phoneValue: contact.phone,
        emailValue: contact.email,
        submitError: t.errUnconfirmed,
      })
      expect(view.details?.props['sumWhen']).toContain('10:00')
      expect(view.chips.map(pressed)).toEqual([true, false])
      expect(view.alerts).toEqual([])
    },
  )

  it.each(['sv', 'en'] as const)('names where the customer can look (%s)', (lang) => {
    const message = bookingStrings(lang).errUnconfirmed
    expect(message).toContain(appStrings(lang).myBookings)
    expect(message).not.toBe(bookingStrings(lang).errSubmit)
    expect(message).not.toBe(bookingStrings(lang).errPossiblyBooked)
  })

  it('warns in the popup of every other time, from the moment it opens', async () => {
    const submit = vi.fn<BookingPort['submit']>().mockResolvedValueOnce(unanswered)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))

    close(popup(port))
    click(screen(port).chips[1])
    const other = popup(port)
    expect(other.props['sumWhen']).toContain('10:30')
    expect(other.props).toMatchObject({ submitError: t.errUnconfirmed })

    // It is not a line that an edit clears: it stays for as long as the doubt does.
    ;(other.props['onName'] as (event: unknown) => void)({ currentTarget: { value: 'Ada' } })
    expect(popup(port).props).toMatchObject({ nameValue: 'Ada', submitError: t.errUnconfirmed })

    // The popup of the time in doubt shows it again as well.
    close(popup(port))
    click(screen(port).chips[0])
    expect(popup(port).props['sumWhen']).toContain('10:00')
    expect(popup(port).props).toMatchObject({ submitError: t.errUnconfirmed })
    expect(submit).toHaveBeenCalledOnce()
  })

  // With the popup closed meanwhile, the time step carries the warning, nothing deselected or read
  // again, until a time is chosen: its popup carries it then.
  type SubmitAnswer = ReturnType<typeof deferred<BookingResult>>
  it.each<[string, (answer: SubmitAnswer) => void]>([
    ['came back without a readable answer', (answer) => answer.resolve(unanswered)],
    ['threw', (answer) => answer.reject(new Error('network'))],
  ])(
    'says it in the time step when no popup is open and the submit %s',
    async (_label, endWithoutAnswer) => {
      const answer = deferred<BookingResult>()
      const submit = vi.fn<BookingPort['submit']>(() => answer.promise)
      const port = portWith(twoTimes(), submit)
      const details = await fillDetails(port)
      await book(details)
      close(details)
      const depsWhenClosed = availabilityDeps(port)
      const step = timeStep(screen(port).statuses[2])

      endWithoutAnswer(answer)
      await flush()

      const view = screen(port)
      expect(view.details).toBeUndefined()
      expect(view.alerts.map(text)).toEqual([t.errUnconfirmed])
      expect(view.chips.map(pressed)).toEqual([true, false])
      expect(availabilityDeps(port)).toEqual(depsWhenClosed)
      await settle(port)
      expect(step.title.focus).not.toHaveBeenCalled()
      expect(screen(port).alerts.map(text)).toEqual([t.errUnconfirmed])

      click(screen(port).chips[1])
      const next = screen(port)
      expect(next.details?.props['sumWhen']).toContain('10:30')
      expect(next.details?.props).toMatchObject({
        nameValue: contact.name,
        submitError: t.errUnconfirmed,
      })
      expect(next.alerts).toEqual([])
      expect(submit).toHaveBeenCalledOnce()
    },
  )

  // With a popup open, whichever time it is for, the warning is in the popup and only there.
  it('says it only in the popup when a popup for another time is open', async () => {
    const answer = deferred<BookingResult>()
    const port = portWith(
      twoTimes(),
      vi.fn<BookingPort['submit']>(() => answer.promise),
    )
    const details = await fillDetails(port)
    await book(details)
    close(details)
    click(screen(port).chips[1])
    expect(screen(port).details?.props['sumWhen']).toContain('10:30')

    answer.resolve(unanswered)
    await flush()

    const view = screen(port)
    expect(view.details?.props['sumWhen']).toContain('10:30')
    expect(view.details?.props).toMatchObject({ submitError: t.errUnconfirmed })
    expect(view.alerts).toEqual([])
  })

  it('still warns when the time in doubt is refused after the visitor chose another', async () => {
    const answer = deferred<BookingResult>()
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockReturnValueOnce(answer.promise)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    const retried = popup(port)
    await book(retried)
    close(retried)
    click(screen(port).chips[1])
    expect(popup(port).props).toMatchObject({ submitError: t.errUnconfirmed })

    answer.resolve(taken)
    await flush()

    const view = screen(port)
    expect(view.details?.props['sumWhen']).toContain('10:30')
    expect(view.details?.props).toMatchObject({ submitError: t.errUnconfirmed })
    expect(view.chips.map(pressed)).toEqual([false, true])
    expect(view.alerts).toEqual([])

    // The doubt about 10:00 is still there: its next refusal may be about the visitor's own booking.
    close(popup(port))
    click(screen(port).chips[0])
    await book(popup(port))
    expect(submit).toHaveBeenCalledTimes(3)
    expect(popup(port).props).toMatchObject({ submitError: t.errPossiblyBooked })
  })

  it('does not block: another time can be booked, and that booking ends the doubt', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockImplementation(bookedAnswer)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    close(popup(port))
    click(screen(port).chips[1])
    await book(popup(port))
    expect(submit).toHaveBeenCalledTimes(2)
    expect(screen(port).confirmation?.props['sumWhen']).toContain('10:30')

    // Without starting over (choosing a barber takes the confirmation away), no popup warns.
    await fillDetails(port)
    expect(popup(port).props).toMatchObject({ submitError: null })
  })

  // A booking ends the doubt itself, so the confirmation's "Book another time" handler is kept to
  // start over after a doubt that arose later.
  it('ends when the visitor starts over', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockImplementationOnce(bookedAnswer)
      .mockResolvedValue(unanswered)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    const startOver = screen(port).confirmation?.props['onReset'] as () => void
    await book(await fillDetails(port))
    expect(popup(port).props).toMatchObject({ submitError: t.errUnconfirmed })

    startOver()
    await fillDetails(port)
    expect(popup(port).props).toMatchObject({ submitError: null })
  })
})

// After an unanswered submit, an "unavailable" for that same time may be about the visitor's own
// booking: sending them on to choose another time would have them book twice.
describe('booking flow: a refusal after an unanswered submit', () => {
  it.each([
    ['came back without a readable answer', async (): Promise<BookingResult> => unanswered],
    [
      'threw',
      async (): Promise<BookingResult> => {
        throw new Error('network')
      },
    ],
  ] as const)(
    'keeps the popup and says the time may already be booked when the previous submit %s',
    async (_label, firstAnswer) => {
      const availability = twoTimes()
      const submit = vi
        .fn<BookingPort['submit']>()
        .mockImplementationOnce(firstAnswer)
        .mockResolvedValue(taken)
      const port = portWith(availability, submit)
      await book(await fillDetails(port))
      expect(popup(port).props).toMatchObject({ submitError: t.errUnconfirmed })
      const depsWhenUnanswered = availabilityDeps(port)

      await book(popup(port))

      expect(submit).toHaveBeenCalledTimes(2)
      const view = screen(port)
      expect(view.details?.props).toMatchObject({
        nameValue: contact.name,
        phoneValue: contact.phone,
        emailValue: contact.email,
        submitError: t.errPossiblyBooked,
      })
      expect(view.details?.props['sumWhen']).toContain('10:00')
      expect(view.chips.map(pressed)).toEqual([true, false])
      expect(view.alerts).toEqual([])
      expect(view.text).not.toContain(t.errSlotTaken)
      expect(availabilityDeps(port)).toEqual(depsWhenUnanswered)

      // Every further refusal of that time says the same.
      await book(popup(port))
      expect(popup(port).props).toMatchObject({ submitError: t.errPossiblyBooked })
    },
  )

  it.each(['sv', 'en'] as const)('names where the customer can look (%s)', (lang) => {
    const message = bookingStrings(lang).errPossiblyBooked
    expect(message).toContain(appStrings(lang).myBookings)
    expect(message).not.toBe(bookingStrings(lang).errSlotTaken)
  })

  it('says it in the time step when the visitor has closed the popup meanwhile', async () => {
    const answer = deferred<BookingResult>()
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockReturnValueOnce(answer.promise)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    const retried = popup(port)
    await book(retried)
    close(retried)
    const closed = screen(port)
    expect(closed.details).toBeUndefined()
    expect(closed.chips.map(pressed)).toEqual([true, false])
    const depsWhenClosed = availabilityDeps(port)

    answer.resolve(taken)
    await flush()

    const view = screen(port)
    expect(view.details).toBeUndefined()
    expect(view.chips.map(pressed)).toEqual([false, false])
    expect(view.alerts.map(text)).toEqual([t.errPossiblyBooked])
    expect(availabilityDeps(port)).not.toEqual(depsWhenClosed)
    const title = stepTitle(view.statuses[2])
    await settle(port)
    expect(page.activeElement).toBe(title)
  })

  it('treats a refusal that said what happened as an answer, not as an unanswered submit', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    expect(popup(port).props).toMatchObject({ submitError: t.errRateLimited })

    await book(popup(port))

    const view = screen(port)
    expect(view.details).toBeUndefined()
    expect(view.chips.map(pressed)).toEqual([false, false])
    expect(view.alerts.map(text)).toEqual([t.errSlotTaken])
  })

  it('keeps the doubt to its own time: another time is refused as any time is', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))

    close(popup(port))
    click(screen(port).chips[1])
    await book(popup(port))

    expect(submit).toHaveBeenCalledTimes(2)
    const view = screen(port)
    expect(view.details).toBeUndefined()
    expect(view.chips.map(pressed)).toEqual([false, false])
    expect(view.alerts.map(text)).toEqual([t.errSlotTaken])
  })

  it('keeps the doubt while the visitor looks at another time and comes back', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))

    close(popup(port))
    click(screen(port).chips[1])
    close(popup(port))
    click(screen(port).chips[0])
    expect(popup(port).props['sumWhen']).toContain('10:00')
    await book(popup(port))

    const view = screen(port)
    expect(view.details?.props).toMatchObject({
      nameValue: contact.name,
      submitError: t.errPossiblyBooked,
    })
    expect(view.chips.map(pressed)).toEqual([true, false])
    expect(view.alerts).toEqual([])
  })

  it('remembers one unanswered submit: a later one for another time replaces it', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockResolvedValueOnce(unanswered)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    close(popup(port))
    click(screen(port).chips[1])
    await book(popup(port))
    expect(popup(port).props).toMatchObject({ submitError: t.errUnconfirmed })

    // 10:00 is no longer the time in doubt: its refusal is a plain refusal.
    close(popup(port))
    click(screen(port).chips[0])
    await book(popup(port))
    const first = screen(port)
    expect(first.details).toBeUndefined()
    expect(first.alerts.map(text)).toEqual([t.errSlotTaken])

    // 10:30 is.
    click((await settle(port)).chips[1])
    await book(popup(port))
    expect(submit).toHaveBeenCalledTimes(4)
    expect(popup(port).props).toMatchObject({ submitError: t.errPossiblyBooked })
    expect(popup(port).props['sumWhen']).toContain('10:30')
  })

  it('drops the doubt when a submit succeeds', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockImplementationOnce(bookedAnswer)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    await book(popup(port))
    const confirmed = screen(port).confirmation
    expect(confirmed?.props['sumWhen']).toContain('10:00')

    // Starting over and asking for the same time again: its refusal is a plain refusal.
    ;(confirmed?.props['onReset'] as () => void)()
    await book(await fillDetails(port))

    expect(submit).toHaveBeenCalledTimes(3)
    const view = screen(port)
    expect(view.details).toBeUndefined()
    expect(view.alerts.map(text)).toEqual([t.errSlotTaken])
  })

  it('drops the doubt when the visitor starts over after booking another time', async () => {
    const submit = vi
      .fn<BookingPort['submit']>()
      .mockResolvedValueOnce(unanswered)
      .mockImplementationOnce(bookedAnswer)
      .mockResolvedValue(taken)
    const port = portWith(twoTimes(), submit)
    await book(await fillDetails(port))
    close(popup(port))
    click(screen(port).chips[1])
    await book(popup(port))
    const confirmed = screen(port).confirmation
    expect(confirmed?.props['sumWhen']).toContain('10:30')

    // The flow starts over with nothing remembered: 10:00 is refused as any time is.
    ;(confirmed?.props['onReset'] as () => void)()
    await book(await fillDetails(port))

    expect(submit).toHaveBeenCalledTimes(3)
    const view = screen(port)
    expect(view.details).toBeUndefined()
    expect(view.alerts.map(text)).toEqual([t.errSlotTaken])
  })
})

// The confirmation must name the booking that was made, never the selection on the page when the
// answer arrives.
describe('booking flow: a booking answered after the visitor chose something else', () => {
  const barberTwo = {
    barber: { id: 'b2', name: 'Barber Two', ig: 'two' },
    copy: null,
    photoUrl: null,
  }
  const shave = { id: 's2', name: 'Shave', price: 200, dur: 20 }
  const SUMMARY = ['sumBarber', 'sumWhen', 'sumService', 'sumPrice'] as const
  /** What a popup or a confirmation says was chosen. */
  const summary = (node: RenderedNode): Record<(typeof SUMMARY)[number], unknown> => ({
    sumBarber: node.props['sumBarber'],
    sumWhen: node.props['sumWhen'],
    sumService: node.props['sumService'],
    sumPrice: node.props['sumPrice'],
  })

  it.each([
    ['open', true],
    ['closed again', false],
  ] as const)(
    'confirms the barber, day, time and service that were booked (popup for the other time %s)',
    async (_label, otherPopupOpen) => {
      reads.roster.mockReturnValue({
        roster: [barber, barberTwo],
        status: 'ready',
        retry: retryRoster,
      })
      reads.services.mockReturnValue({
        services: [service, shave],
        status: 'ready',
        retry: retryServices,
      })
      const answer = deferred<BookingResult>()
      const submit = vi.fn<BookingPort['submit']>(() => answer.promise)
      const port = portWith(twoTimes(), submit)
      const details = await fillDetails(port)
      const made = summary(details)
      expect(made).toMatchObject({ sumBarber: 'Barber One', sumService: 'Cut', sumPrice: '300 kr' })
      expect(made.sumWhen).toContain('10:00')
      await book(details)

      // While the answer is on its way: another barber, another day, another service, another time.
      close(details)
      click(screen(port).barbers[1])
      click(selectableDays(port)[1])
      click(screen(port).services[1])
      click((await settle(port)).chips[1])
      const other = popup(port)
      for (const key of SUMMARY) expect(summary(other)[key]).not.toBe(made[key])
      expect(summary(other).sumWhen).toContain('10:30')
      if (!otherPopupOpen) close(other)

      const booking = submit.mock.calls[0]?.[0]
      if (booking === undefined) throw new Error('Missing submitted booking')
      expect(booking).toMatchObject({ barber: barber.barber, service })
      answer.resolve({
        ok: true,
        booking,
        links: { icsHref: 'ics', gcalHref: 'gcal', mapsHref: 'maps' },
      })
      await flush()

      const view = screen(port)
      expect(view.details).toBeUndefined()
      expect(view.confirmation?.props).toMatchObject({
        ...made,
        icsHref: 'ics',
        gcalHref: 'gcal',
        mapsHref: 'maps',
      })
      // The steps behind the confirmation show the booked selection too.
      expect(view.barbers.map(pressed)).toEqual([true, false])
      expect(view.services.map(pressed)).toEqual([true, false])
    },
  )
})

describe('booking flow: step titles, language and motion', () => {
  const port = portWith(vi.fn<BookingPort['availability']>())

  it('exposes each step title as a level-2 heading on its original span', () => {
    click(screen(port).barbers[0])
    const headings = screen(port).headings
    expect(headings.map(text)).toEqual([
      t.chooseBarber,
      t.chooseDate,
      t.chooseService,
      t.chooseTime,
    ])
    for (const heading of headings) {
      expect(heading.type).toBe('span')
      expect(heading.props['aria-level']).toBe(2)
      // A title is not a tab stop: it is focusable only while the flow has handed it the focus.
      expect(heading.props).not.toHaveProperty('tabIndex')
    }
  })

  it('hands the details popup the language of the flow', async () => {
    const withTimes = portWith(twoTimes())
    await fillDetails(withTimes)
    expect(screen(withTimes).details?.props['lang']).toBe('sv')
    expect(screen(withTimes, 'en').details?.props['lang']).toBe('en')
  })

  it.each([
    [true, 'none'],
    [false, 'kncFade .32s cubic-bezier(.32,.72,0,1) both'],
  ] as const)(
    'plays the step entry animation unless reduced motion is asked for (%s)',
    (reduce, animation) => {
      vi.stubGlobal('window', { matchMedia: () => ({ matches: reduce }) })
      click(screen(port).barbers[0])
      const animated = screen(port).all.filter((node) => {
        const style = node.props['style']
        return typeof style === 'object' && style !== null && 'animation' in style
      })
      expect(
        animated.map((node) => (node.props['style'] as { animation: string }).animation),
      ).toEqual([animation])
    },
  )
})
