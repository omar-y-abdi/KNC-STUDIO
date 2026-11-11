import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingFlow,
  type BookingFlowProps,
} from '../../modules/public-web/src/booking/BookingFlow'
import { ConfirmationDialog } from '../../modules/public-web/src/booking/ConfirmationDialog'
import { DetailsDialog } from '../../modules/public-web/src/booking/DetailsDialog'
import type { AvailabilityResult, BookingPort } from '../../modules/public-web/src/booking/port'
import { installFakePage } from './helpers/fakeFocus'
import { mount, nodes, render, reset, type RenderedNode } from './helpers/fakeHooks'

// The shell learns that the confirmation of a booking made here was closed (the home-screen guide
// waits for it); "Mina bokningar" and the Studio never tell it.

const reads = vi.hoisted(() => ({
  roster: vi.fn(),
  services: vi.fn(),
  // undefined on the public site; null stands in for the Studio, where `previewPorts` is not undefined.
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

const barber = { barber: { id: 'b1', name: 'Barber One', ig: 'one' }, copy: null, photoUrl: null }
const service = { id: 's1', name: 'Cut', price: 300, dur: 30 }
const contact = { name: 'Ada Lovelace', phone: '070 123 45 67', email: 'ada@example.test' }
const port: BookingPort = {
  availability: async (): Promise<AvailabilityResult> => ({ ok: true, times: ['10:00'] }),
  submit: async (booking) => ({
    ok: true,
    booking,
    links: { icsHref: 'ics', gcalHref: 'gcal', mapsHref: 'maps' },
  }),
}

let flowProps: Partial<BookingFlowProps> = {}

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''
  return text((node as RenderedNode).props?.children)
}

function screen() {
  const all = nodes(
    render(() =>
      BookingFlow({
        port,
        defaultLang: 'sv',
        clock: () => new Date(2040, 2, 12, 9),
        delay: () => Promise.resolve(),
        ...flowProps,
      }),
    ),
  )
  return {
    all,
    details: all.find((node) => node.type === DetailsDialog),
    confirmation: all.find((node) => node.type === ConfirmationDialog),
  }
}

function click(node: RenderedNode | undefined): void {
  if (node === undefined) throw new Error('Missing control')
  ;(node.props['onClick'] as () => void)()
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

/** Books 10:00 on the first bookable day and returns the confirmation on screen. */
async function book(): Promise<RenderedNode> {
  const byTestId = (id: string) => screen().all.find((node) => node.props['data-testid'] === id)
  click(byTestId('booking-barber-option'))
  click(
    screen().all.find(
      (node) =>
        node.type === 'button' &&
        typeof node.props['aria-label'] === 'string' &&
        node.props['aria-pressed'] === false &&
        node.props['disabled'] === false,
    ),
  )
  click(byTestId('booking-service-option'))
  screen()
  mount()
  await flush()
  click(screen().all.find((node) => node.type === 'button' && text(node) === '10:00'))
  for (const [handler, value] of [
    ['onName', contact.name],
    ['onPhone', contact.phone],
    ['onEmail', contact.email],
  ] as const)
    (screen().details?.props[handler] as (event: unknown) => void)({ currentTarget: { value } })
  ;(screen().details?.props['onBook'] as () => void)()
  await flush()
  const confirmation = screen().confirmation
  if (confirmation === undefined) throw new Error('No confirmation')
  return confirmation
}

const call = (confirmation: RenderedNode, handler: string, event?: unknown): void =>
  (confirmation.props[handler] as (event?: unknown) => void)(event)

beforeEach(() => {
  reset()
  vi.clearAllMocks()
  installFakePage()
  reads.context.value = undefined
  reads.roster.mockReturnValue({ roster: [barber], status: 'ready', retry: vi.fn() })
  reads.services.mockReturnValue({ services: [service], status: 'ready', retry: vi.fn() })
})

describe('booking flow: a closed confirmation', () => {
  const backdrop = {}

  it.each([
    // The dialog's Escape and its × close through `onReset` as the button does.
    ['its new-booking button, × or Escape', (c: RenderedNode) => call(c, 'onReset')],
    [
      'a click on its backdrop',
      (c: RenderedNode) =>
        call(c, 'onBackdropClick', { target: backdrop, currentTarget: backdrop }),
    ],
  ])('tells the shell once when closed through %s', async (_label, close) => {
    const onConfirmationClosed = vi.fn()
    flowProps = { onConfirmationClosed, onMyBookings: vi.fn() }
    close(await book())
    expect(onConfirmationClosed).toHaveBeenCalledOnce()
    expect(screen().confirmation).toBeUndefined()
  })

  it('tells nothing for a click inside the card, which keeps it open', async () => {
    const onConfirmationClosed = vi.fn()
    flowProps = { onConfirmationClosed }
    call(await book(), 'onBackdropClick', { target: {}, currentTarget: backdrop })
    expect(onConfirmationClosed).not.toHaveBeenCalled()
    expect(screen().confirmation).not.toBeUndefined()
  })

  it('tells nothing when "Mina bokningar" takes over', async () => {
    const onConfirmationClosed = vi.fn()
    const onMyBookings = vi.fn()
    flowProps = { onConfirmationClosed, onMyBookings }
    call(await book(), 'onMyBookings')
    expect(onMyBookings).toHaveBeenCalledOnce()
    expect(onConfirmationClosed).not.toHaveBeenCalled()
    expect(screen().confirmation).toBeUndefined()
  })

  it('tells nothing in the Studio', async () => {
    reads.context.value = null
    const onConfirmationClosed = vi.fn()
    flowProps = { onConfirmationClosed }
    call(await book(), 'onReset')
    expect(onConfirmationClosed).not.toHaveBeenCalled()
  })
})
