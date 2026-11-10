import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asBarberId } from '../../modules/public-web/src/booking/domain'
import { CmsSceneContext } from '../../modules/public-web/src/cms/Scene'
import { DEFAULT_BUSINESS } from '../../modules/public-web/src/config'
import { customerEmailLinkStrings } from '../../modules/public-web/src/i18n/customerEmailLinkStrings'
import { myBookingsStrings } from '../../modules/public-web/src/i18n/index'
import {
  CustomerEmailLink,
  type CustomerEmailLinkProps,
} from '../../modules/public-web/src/mybookings/CustomerEmailLink'
import type { MyBooking } from '../../modules/public-web/src/mybookings/domain'
import {
  MyBookingsDialog,
  type MyBookingsDialogProps,
} from '../../modules/public-web/src/mybookings/MyBookingsDialog'
import type { MyBookingsPort } from '../../modules/public-web/src/mybookings/port'
import type { BusinessSettings } from '../../modules/public-web/src/site/siteChrome'
import { fakeElement, installFakePage, type FakeElement, type FakePage } from './helpers/fakeFocus'
import {
  hooks,
  mount,
  nodes,
  render,
  reset,
  useEffect,
  type RenderedNode,
} from './helpers/fakeHooks'
import { unhandledRejectionsDuring } from './helpers/unhandledRejections'

// The shared fake hooks answer every context with `null`; here a test can provide the Studio's.
const contexts = vi.hoisted(() => new Map<unknown, unknown>())
vi.mock('preact/hooks', async () => ({
  ...(await import('./helpers/fakeHooks')),
  useContext: (context: unknown): unknown => contexts.get(context) ?? null,
}))
vi.mock('../../modules/public-web/src/ui/Dialog', () => ({ Dialog: () => null }))
vi.mock('../../modules/public-web/src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))
vi.mock('../../modules/public-web/src/cms/NativeSurface', () => ({ NativeRegion: () => null }))

const t = myBookingsStrings('sv')
const NOW = new Date('2026-06-19T10:00:00.000Z')
const POLICY_HOURS = DEFAULT_BUSINESS.cancellationPolicyHours
const startingIn = (hours: number): Date => new Date(NOW.getTime() + hours * 3_600_000)
const deadlineSentence = (hours: number): string =>
  t.cancelClosed.split('{hours}').join(String(hours))
// The deadline sentence before its hours: finds the note with or without links.
const DEADLINE_START = t.cancelClosed.slice(0, t.cancelClosed.indexOf('{hours}'))
let page: FakePage

function booking(id: string, start: Date): MyBooking {
  return {
    id,
    barber: { id: asBarberId('b1'), name: 'Barber One', ig: '' },
    serviceName: 'Hår',
    price: 350,
    durationMin: 45,
    start,
    whenLabel: `Visit ${id}`,
  }
}

type Listed = Awaited<ReturnType<MyBookingsPort['list']>>
type CancelAnswer = Awaited<ReturnType<MyBookingsPort['cancel']>>
interface Rows {
  readonly upcoming?: readonly MyBooking[]
  readonly past?: readonly MyBooking[]
}

const listed = (rows: Rows): Listed => ({
  ok: true,
  authority: 'device',
  bookings: { upcoming: rows.upcoming ?? [], past: rows.past ?? [] },
})

function portWith(rows: Rows, parts: Partial<MyBookingsPort> = {}): MyBookingsPort {
  const unexpected = (): never => {
    throw new Error('Unexpected port call')
  }
  return {
    requestEmailLink: unexpected,
    confirmEmailLink: unexpected,
    requestAccess: unexpected,
    exchangeAccess: unexpected,
    list: async () => listed(rows),
    cancel: unexpected,
    ...parts,
  }
}

function dialogProps(
  port: MyBookingsPort,
  parts: Partial<MyBookingsDialogProps> = {},
): MyBookingsDialogProps {
  return {
    mode: 'light',
    lang: 'sv',
    onClose: () => undefined,
    port,
    business: DEFAULT_BUSINESS,
    clock: () => NOW,
    ...parts,
  }
}

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

/** Renders once and reads what the dialog shows; pass the same props on every call. */
function screen(props: MyBookingsDialogProps) {
  const tree = render(() => {
    const dialog = MyBookingsDialog(props)
    if (typeof dialog.type !== 'function') throw new Error('Missing My Bookings session')
    return (dialog.type as (props: unknown) => unknown)(dialog.props)
  })
  const all = nodes(tree)
  const withRole = (role: string): RenderedNode[] =>
    all.filter((node) => node.props['role'] === role)
  const labelled = (label: string): RenderedNode | undefined =>
    all.find((node) => node.props['aria-label'] === label)
  return {
    all,
    text: text(tree),
    alerts: withRole('alert'),
    statuses: withRole('status'),
    headings: withRole('heading'),
    button: (label: string): RenderedNode | undefined =>
      all.find((node) => node.type === 'button' && text(node) === label),
    row: (b: MyBooking): RenderedNode | undefined =>
      labelled(`${b.whenLabel} — ${t.ariaExpandRow}`),
    pastToggle: labelled(t.ariaExpandPast),
    deadlineNotes: all.filter((node) => node.type === 'p' && text(node).startsWith(DEADLINE_START)),
  }
}

const links = (note: RenderedNode | undefined): unknown[] =>
  nodes(note)
    .filter((node) => node.type === 'a')
    .map((node) => node.props['href'])

/** The first child of the list's note: the icon, whose place in the tree must not move. */
function noteIcon(note: RenderedNode | undefined): RenderedNode | undefined {
  const [first] = [note?.props.children].flat()
  return typeof first === 'object' && first !== null ? (first as RenderedNode) : undefined
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let fulfil: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    fulfil = resolve
  })
  return { promise, resolve: (value) => fulfil(value) }
}

async function openList(props: MyBookingsDialogProps): Promise<void> {
  screen(props)
  mount()
  await flush()
}

function expand(props: MyBookingsDialogProps, b: MyBooking): ReturnType<typeof screen> {
  click(screen(props).row(b))
  return screen(props)
}

async function confirmCancel(
  props: MyBookingsDialogProps,
  b: MyBooking,
): Promise<ReturnType<typeof screen>> {
  click(expand(props, b).button(t.cancelBtn))
  click(screen(props).button(t.cancelConfirmYes))
  await flush()
  return screen(props)
}

/** The element a node's ref receives: a `text` has no own `tabindex`, a `control` is a button. */
function attach(node: RenderedNode | undefined, kind: 'control' | 'text' = 'text'): FakeElement {
  const target = (node as (RenderedNode & { readonly ref?: { current: unknown } }) | undefined)?.ref
  if (target === undefined) throw new Error('Missing ref')
  const element = fakeElement(page, kind)
  target.current = element
  return element
}

/** Run what Preact runs after every render: the last render's effects without a dependency list. */
function runEveryRenderEffects(): void {
  const calls: readonly (readonly unknown[])[] = useEffect.mock.calls
  for (const call of calls.slice(calls.length - hooks.effects.length)) {
    if (call[1] === undefined) (call[0] as () => unknown)()
  }
}

function focusElsewhere(): FakeElement {
  const elsewhere = fakeElement(page, 'control')
  elsewhere.focus()
  return elsewhere
}

beforeEach(() => {
  reset()
  contexts.clear()
  page = installFakePage()
})
afterEach(() => vi.unstubAllGlobals())

describe('my bookings: the online cancellation deadline', () => {
  it('offers the cancel button while the start is later than the deadline', async () => {
    const far = booking('far', new Date(startingIn(POLICY_HOURS).getTime() + 60_000))
    const props = dialogProps(portWith({ upcoming: [far] }))
    await openList(props)
    const view = expand(props, far)
    expect(view.button(t.cancelBtn)).toBeDefined()
    expect(view.deadlineNotes).toEqual([])
  })

  it.each([
    ['exactly at the deadline', POLICY_HOURS],
    ['one hour before the visit', 1],
  ] as const)(
    'shows the deadline and how to reach the salon instead of the cancel button (%s)',
    async (_label, hours) => {
      const soon = booking('soon', startingIn(hours))
      const props = dialogProps(portWith({ upcoming: [soon] }))
      await openList(props)
      const view = expand(props, soon)

      expect(view.button(t.cancelBtn)).toBeUndefined()
      expect(t.cancelClosed).toContain('{hours}')
      expect(view.deadlineNotes.map(text)).toEqual([
        `${deadlineSentence(POLICY_HOURS)} ${DEFAULT_BUSINESS.phoneDisplay} · ${DEFAULT_BUSINESS.email}`,
      ])
      expect(text(view.deadlineNotes[0])).toContain(`(${POLICY_HOURS} h `)
      expect(links(view.deadlineNotes[0])).toEqual([
        `tel:${DEFAULT_BUSINESS.phoneTel}`,
        `mailto:${DEFAULT_BUSINESS.email}`,
      ])
      // The note is not a tab stop; it is focusable only while it holds the focus.
      expect(view.deadlineNotes[0]?.props).not.toHaveProperty('tabIndex')
    },
  )

  it('follows the owner-set policy, not a fixed number of hours', async () => {
    const business = { ...DEFAULT_BUSINESS, cancellationPolicyHours: 48 }
    const inside = booking('inside', startingIn(30))
    const outside = booking('outside', startingIn(49))
    const props = dialogProps(portWith({ upcoming: [inside, outside] }), { business })
    await openList(props)

    const closed = expand(props, inside)
    expect(closed.button(t.cancelBtn)).toBeUndefined()
    expect(text(closed.deadlineNotes[0])).toContain('(48 h ')

    const open = expand(props, outside)
    expect(open.button(t.cancelBtn)).toBeDefined()
    expect(open.deadlineNotes).toEqual([])
  })

  // A phone link needs both the number to call and its written form; an e-mail link needs the
  // address. The separator stands only between two links.
  it.each<[string, Partial<BusinessSettings>, (business: BusinessSettings) => readonly string[]]>([
    [
      'a phone and an e-mail address',
      {},
      (business) => [`tel:${business.phoneTel}`, `mailto:${business.email}`],
    ],
    ['only a phone', { email: '' }, (business) => [`tel:${business.phoneTel}`]],
    [
      'only an e-mail address',
      { phoneDisplay: '', phoneTel: '' },
      (business) => [`mailto:${business.email}`],
    ],
    [
      'a phone number without its written form',
      { phoneDisplay: '' },
      (business) => [`mailto:${business.email}`],
    ],
    [
      'a written phone number without the number to call',
      { phoneTel: '' },
      (business) => [`mailto:${business.email}`],
    ],
    ['neither', { phoneDisplay: '', phoneTel: '', email: '' }, () => []],
  ])('links the contact details the salon has: %s', async (_label, parts, expectedLinks) => {
    const business = { ...DEFAULT_BUSINESS, ...parts }
    const soon = booking('soon', startingIn(1))
    const props = dialogProps(portWith({ upcoming: [soon] }), { business })
    await openList(props)
    const view = expand(props, soon)

    const hrefs = expectedLinks(business)
    const shown = hrefs.map((href) =>
      href.startsWith('tel:') ? business.phoneDisplay : business.email,
    )
    expect(view.deadlineNotes).toHaveLength(1)
    expect(links(view.deadlineNotes[0])).toEqual(hrefs)
    expect(text(view.deadlineNotes[0])).toBe(
      `${deadlineSentence(POLICY_HOURS)} ${shown.join(' · ')}`,
    )
    expect(
      nodes(view.deadlineNotes[0])
        .filter((node) => node.type === 'a')
        .map(text),
    ).toEqual(shown)
  })

  it('shows neither the cancel button nor the note on a past booking', async () => {
    const past = booking('past', startingIn(-48))
    const props = dialogProps(portWith({ past: [past] }))
    await openList(props)
    click(screen(props).pastToggle)
    const view = expand(props, past)
    expect(view.text).toContain(`${past.serviceName} · ${past.price} kr`)
    expect(view.button(t.cancelBtn)).toBeUndefined()
    expect(view.deadlineNotes).toEqual([])
  })

  // The Studio's example scene stores the cancel button, so it must render whatever the deadline.
  it('keeps the cancel button on the Studio example booking, whatever the deadline', async () => {
    const business = { ...DEFAULT_BUSINESS, cancellationPolicyHours: 168 }
    const example = booking('example', startingIn(59))
    const port = portWith({ upcoming: [example] })
    const props = dialogProps(port, { business })
    contexts.set(CmsSceneContext, { customer: { port, expandedId: example.id } })
    await openList(props)

    // The example row is open from the start.
    const scene = screen(props)
    expect(scene.button(t.cancelBtn)).toBeDefined()
    expect(scene.deadlineNotes).toEqual([])

    // The same booking outside the Studio is past that deadline.
    contexts.clear()
    const live = screen(props)
    expect(live.button(t.cancelBtn)).toBeUndefined()
    expect(live.deadlineNotes).toHaveLength(1)
  })
})

// The CMS island has not loaded the owner's settings; the shipped default would hide a cancel
// button that works and print hours nobody set.
describe('my bookings: a mount that does not know the cancellation deadline', () => {
  const soon = booking('soon', startingIn(1))

  it('offers the cancel button inside what would be the default deadline, and states no hours', async () => {
    expect(POLICY_HOURS).toBeGreaterThan(1)
    const props = dialogProps(portWith({ upcoming: [soon] }), { business: 'unknown' })
    await openList(props)
    const view = expand(props, soon)

    expect(view.button(t.cancelBtn)).toBeDefined()
    expect(view.deadlineNotes).toEqual([])
    expect(view.text).not.toContain(DEADLINE_START)
    expect(view.text).not.toContain(`${POLICY_HOURS} h`)
  })

  it('says the cancel failed and reads the rows again when the server refuses it', async () => {
    const cancel = vi.fn<MyBookingsPort['cancel']>(async () => ({ ok: false, error: 'not_found' }))
    const list = vi.fn<MyBookingsPort['list']>(async () => listed({ upcoming: [soon] }))
    const props = dialogProps(portWith({}, { cancel, list }), { business: 'unknown' })
    await openList(props)
    const view = await confirmCancel(props, soon)

    expect(cancel.mock.calls).toEqual([[soon, '']])
    expect(list).toHaveBeenCalledTimes(2)
    expect(view.alerts.map(text)).toEqual([t.errCancel])
    expect(view.button(t.cancelConfirmYes)).toBeDefined()
    expect(view.deadlineNotes).toEqual([])
    expect(view.text).not.toContain(DEADLINE_START)
  })
})

// The server answers `not_found` for any cancel that changed nothing; the dialog shows the
// deadline note only when its own clock agrees, else it reports the failure and rereads the rows.
describe('my bookings: a cancellation the server did not carry out', () => {
  const far = booking('far', startingIn(POLICY_HOURS + 48))
  const other = booking('other', startingIn(POLICY_HOURS + 72))
  const notFound = (): ReturnType<typeof vi.fn<MyBookingsPort['cancel']>> =>
    vi.fn<MyBookingsPort['cancel']>(async () => ({ ok: false, error: 'not_found' }))

  it('says the cancel failed and reads the rows once more while the deadline is still open', async () => {
    const cancel = notFound()
    const list = vi.fn<MyBookingsPort['list']>(async () => listed({ upcoming: [far, other] }))
    const props = dialogProps(portWith({}, { cancel, list }))
    await openList(props)
    expect(list).toHaveBeenCalledOnce()
    const view = await confirmCancel(props, far)

    expect(cancel.mock.calls).toEqual([[far, '']])
    expect(list).toHaveBeenCalledTimes(2)
    expect(view.alerts.map(text)).toEqual([t.errCancel])
    expect(view.button(t.cancelConfirmYes)).toBeDefined()
    expect(view.text).toContain(t.cancelConfirmQ)
    expect(view.deadlineNotes).toEqual([])
    expect(view.statuses).toEqual([])
    expect(view.row(far)).toBeDefined()
  })

  it('says the booking is no longer listed when that read no longer holds it', async () => {
    const cancel = notFound()
    const list = vi
      .fn<MyBookingsPort['list']>()
      .mockResolvedValueOnce(listed({ upcoming: [far, other] }))
      .mockResolvedValue(listed({ upcoming: [other] }))
    const props = dialogProps(portWith({}, { cancel, list }))
    await openList(props)
    const view = await confirmCancel(props, far)

    expect(list).toHaveBeenCalledTimes(2)
    expect(view.row(far)).toBeUndefined()
    expect(view.row(other)).toBeDefined()
    // The note says the booking is gone, not that this click cancelled it.
    expect(view.statuses.map(text)).toEqual([t.bookingGoneNote])
    expect(t.bookingGoneNote).not.toBe(t.cancelledNote)
    expect(view.alerts).toEqual([])
    expect(view.deadlineNotes).toEqual([])
    expect(view.button(t.cancelConfirmYes)).toBeUndefined()

    // No checkmark, but the icon stays the first child: the presentation identifies it by position.
    const icon = noteIcon(view.statuses[0])
    expect(icon?.type).toBe('img')
    expect(icon?.props['style']).toMatchObject({ display: 'none' })
    expect(icon?.props['aria-hidden']).toBe('true')

    // Written when shown, in the dialog's language at that time.
    expect(screen({ ...props, lang: 'en' }).statuses.map(text)).toEqual([
      myBookingsStrings('en').bookingGoneNote,
    ])
    screen(props)

    // The confirm button that had the focus went with the row: the note takes it.
    const note = attach(view.statuses[0])
    runEveryRenderEffects()
    expect(page.activeElement).toBe(note)

    const next = expand(props, other)
    expect(next.button(t.cancelBtn)).toBeDefined()
    expect(next.alerts).toEqual([])
  })

  // The cancel is over once answered: no "Avbokar…" beside "could not cancel" during the reread.
  it('releases the question while the rows are read again', async () => {
    const reread = deferred<Listed>()
    const cancel = notFound()
    const list = vi
      .fn<MyBookingsPort['list']>()
      .mockResolvedValueOnce(listed({ upcoming: [far, other] }))
      .mockReturnValueOnce(reread.promise)
    const props = dialogProps(portWith({}, { cancel, list }))
    await openList(props)
    const reading = await confirmCancel(props, far)

    expect(list).toHaveBeenCalledTimes(2)
    expect(reading.alerts.map(text)).toEqual([t.errCancel])
    expect(reading.button(t.cancelling)).toBeUndefined()
    expect(reading.button(t.cancelConfirmYes)?.props['disabled']).toBe(false)
    expect(reading.button(t.cancelConfirmNo)?.props['disabled']).toBe(false)

    reread.resolve(listed({ upcoming: [far, other] }))
    await flush()
    const settled = screen(props)
    expect(settled.alerts.map(text)).toEqual([t.errCancel])
    expect(settled.button(t.cancelConfirmYes)).toBeDefined()
    expect(settled.statuses).toEqual([])
  })

  it('leaves a question opened on another booking while the rows were read', async () => {
    const reread = deferred<Listed>()
    const cancel = notFound()
    const list = vi
      .fn<MyBookingsPort['list']>()
      .mockResolvedValueOnce(listed({ upcoming: [far, other] }))
      .mockReturnValueOnce(reread.promise)
    const props = dialogProps(portWith({}, { cancel, list }))
    await openList(props)
    await confirmCancel(props, far)

    click(expand(props, other).button(t.cancelBtn))
    expect(screen(props).button(t.cancelConfirmYes)).toBeDefined()

    reread.resolve(listed({ upcoming: [other] }))
    await flush()
    const view = screen(props)
    expect(view.row(far)).toBeUndefined()
    expect(view.statuses.map(text)).toEqual([t.bookingGoneNote])
    expect(view.text).toContain(t.cancelConfirmQ)
    expect(view.button(t.cancelConfirmYes)).toBeDefined()
    expect(view.alerts).toEqual([])
  })

  it('keeps the history section open through that read', async () => {
    const earlier = booking('earlier', startingIn(-48))
    const cancel = notFound()
    const list = vi.fn<MyBookingsPort['list']>(async () =>
      listed({ upcoming: [far, other], past: [earlier] }),
    )
    const props = dialogProps(portWith({}, { cancel, list }))
    await openList(props)
    click(screen(props).pastToggle)
    expect(screen(props).pastToggle?.props['aria-expanded']).toBe(true)

    const view = await confirmCancel(props, far)

    expect(list).toHaveBeenCalledTimes(2)
    expect(view.pastToggle?.props['aria-expanded']).toBe(true)
    expect(view.row(earlier)).toBeDefined()
  })

  // Rereading would put the list back over the lookup form the customer moved to.
  it('says nothing and reads nothing once the customer has left the list for the lookup form', async () => {
    const answer = deferred<CancelAnswer>()
    const cancel = vi.fn<MyBookingsPort['cancel']>(() => answer.promise)
    const list = vi.fn<MyBookingsPort['list']>(async () => listed({ upcoming: [far, other] }))
    const props = dialogProps(portWith({}, { cancel, list }))
    await openList(props)
    const asking = await confirmCancel(props, far)
    expect(asking.button(t.cancelling)).toBeDefined()

    click(asking.button(t.changeEmail))
    expect(screen(props).button(t.lookupBtn)).toBeDefined()
    answer.resolve({ ok: false, error: 'not_found' })
    await flush()

    const view = screen(props)
    expect(cancel).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    expect(view.button(t.lookupBtn)).toBeDefined()
    expect(view.row(far)).toBeUndefined()
    expect(view.alerts).toEqual([])
    expect(view.statuses).toEqual([])
  })

  // Here another e-mail address was linked after the cancel was sent.
  it('leaves a cancel that a newer list read has overtaken to that read', async () => {
    const answer = deferred<CancelAnswer>()
    const newer = deferred<Listed>()
    const cancel = vi.fn<MyBookingsPort['cancel']>(() => answer.promise)
    const list = vi
      .fn<MyBookingsPort['list']>()
      .mockResolvedValueOnce(listed({ upcoming: [far, other] }))
      .mockReturnValueOnce(newer.promise)
    const props = dialogProps(portWith({}, { cancel, list }), { emailLinkCode: 'link-code' })
    await openList(props)
    await confirmCancel(props, far)

    const link = screen(props).all.find((node) => node.type === CustomerEmailLink)
    ;(link?.props['onLinked'] as () => void)()
    expect(list).toHaveBeenCalledTimes(2)
    answer.resolve({ ok: false, error: 'not_found' })
    await flush()

    expect(list).toHaveBeenCalledTimes(2)
    expect(screen(props).alerts).toEqual([])

    newer.resolve(listed({ upcoming: [far, other] }))
    await flush()
    const view = screen(props)
    expect(list).toHaveBeenCalledTimes(2)
    expect(view.row(far)).toBeDefined()
    expect(view.button(t.cancelConfirmYes)).toBeUndefined()
    expect(view.alerts).toEqual([])
    expect(view.statuses).toEqual([])
  })

  // A refused follow-up read leads to the lookup form with its reason, as any refused read does.
  it.each([
    ['access_denied', t.errAccess],
    ['cookies_disabled', t.errCookies],
  ] as const)(
    'goes to the lookup form with the reason when the follow-up read is refused (%s)',
    async (error, reason) => {
      const cancel = notFound()
      const list = vi
        .fn<MyBookingsPort['list']>()
        .mockResolvedValueOnce(listed({ upcoming: [far, other] }))
        .mockResolvedValue({ ok: false, error })
      const props = dialogProps(portWith({}, { cancel, list }))
      await openList(props)

      const unhandled = await unhandledRejectionsDuring(async () => {
        await confirmCancel(props, far)
      })

      const view = screen(props)
      expect(unhandled).toEqual([])
      expect(list).toHaveBeenCalledTimes(2)
      expect(view.button(t.lookupBtn)).toBeDefined()
      expect(view.row(far)).toBeUndefined()
      expect(view.alerts.map(text)).toEqual([reason])
      expect(view.statuses).toEqual([])
    },
  )

  it('shows the deadline note when the deadline passed while the question was open', async () => {
    let now = NOW
    const closing = booking('closing', startingIn(POLICY_HOURS + 1))
    const cancel = notFound()
    const list = vi.fn<MyBookingsPort['list']>(async () => listed({ upcoming: [closing, other] }))
    const props = dialogProps(portWith({}, { cancel, list }), { clock: () => now })
    await openList(props)

    // The button and the question are rendered while the deadline is open ...
    click(expand(props, closing).button(t.cancelBtn))
    const confirm = screen(props).button(t.cancelConfirmYes)
    expect(confirm).toBeDefined()
    // ... and the customer answers two hours later.
    now = startingIn(2)
    click(confirm)
    await flush()
    const view = screen(props)

    expect(cancel.mock.calls).toEqual([[closing, '']])
    expect(list).toHaveBeenCalledOnce()
    expect(view.button(t.cancelBtn)).toBeUndefined()
    expect(view.button(t.cancelConfirmYes)).toBeUndefined()
    expect(view.alerts).toEqual([])
    expect(view.text).not.toContain(t.errCancel)
    expect(view.deadlineNotes.map(text)).toEqual([
      `${deadlineSentence(POLICY_HOURS)} ${DEFAULT_BUSINESS.phoneDisplay} · ${DEFAULT_BUSINESS.email}`,
    ])

    // The confirm button that had focus is gone: the note takes it.
    const note = attach(view.deadlineNotes[0])
    runEveryRenderEffects()
    expect(page.activeElement).toBe(note)

    // The deadline is each booking's own.
    const next = expand(props, other)
    expect(next.button(t.cancelBtn)).toBeDefined()
    expect(next.deadlineNotes).toEqual([])
  })
})

describe('my bookings: the answer to a cancellation', () => {
  const far = booking('far', startingIn(POLICY_HOURS + 48))
  const other = booking('other', startingIn(POLICY_HOURS + 72))

  it('keeps the question and says the cancellation failed on a system error', async () => {
    const cancel = vi.fn<MyBookingsPort['cancel']>(async () => ({ ok: false, error: 'system' }))
    const list = vi.fn<MyBookingsPort['list']>(async () => listed({ upcoming: [far] }))
    const props = dialogProps(portWith({}, { cancel, list }))
    await openList(props)
    const view = await confirmCancel(props, far)

    expect(view.alerts.map(text)).toEqual([t.errCancel])
    expect(view.button(t.cancelConfirmYes)).toBeDefined()
    expect(view.deadlineNotes).toEqual([])
    // A failure that said what it was does not read the rows again.
    expect(list).toHaveBeenCalledOnce()
  })

  it('removes the booking and moves focus to the "cancelled" status message', async () => {
    const cancel = vi.fn<MyBookingsPort['cancel']>(async () => ({ ok: true, id: far.id }))
    const props = dialogProps(portWith({ upcoming: [far] }, { cancel }))
    await openList(props)
    const view = await confirmCancel(props, far)

    expect(cancel.mock.calls).toEqual([[far, '']])
    expect(view.row(far)).toBeUndefined()
    expect(view.text).toContain(t.upcomingEmpty)
    expect(view.statuses.map(text)).toEqual([t.cancelledNote])
    expect(view.statuses[0]?.props).not.toHaveProperty('tabIndex')
    const icon = noteIcon(view.statuses[0])
    expect(icon?.type).toBe('img')
    expect(icon?.props['style']).not.toHaveProperty('display')
    expect(icon?.props['aria-hidden']).toBeUndefined()
    // Written when shown, in the dialog's language at that time.
    expect(screen({ ...props, lang: 'en' }).statuses.map(text)).toEqual([
      myBookingsStrings('en').cancelledNote,
    ])
    screen(props)

    // The message takes the focus quietly: focusable, and marked, only while it holds it.
    const notice = attach(view.statuses[0])
    runEveryRenderEffects()
    expect(page.activeElement).toBe(notice)
    expect([...notice.attributes]).toEqual([
      ['tabindex', '-1'],
      ['data-quiet-focus', ''],
    ])
    focusElsewhere()
    expect([...notice.attributes]).toEqual([])
  })

  // The overtaken read may still hold the cancelled booking, so the rows are read again.
  it('keeps the "cancelled" message and its focus through the list read that follows', async () => {
    const overtaken = deferred<Listed>()
    const reread = deferred<Listed>()
    const list = vi
      .fn<MyBookingsPort['list']>()
      .mockResolvedValueOnce(listed({ upcoming: [far, other] }))
      .mockReturnValueOnce(overtaken.promise)
      .mockReturnValueOnce(reread.promise)
    const cancel = vi.fn<MyBookingsPort['cancel']>(async () => ({ ok: true, id: far.id }))
    const props = dialogProps(portWith({}, { list, cancel }), { emailLinkCode: 'link-code' })
    await openList(props)

    const link = screen(props).all.find((node) => node.type === CustomerEmailLink)
    ;(link?.props['onLinked'] as () => void)()
    expect(list).toHaveBeenCalledTimes(2)
    const view = await confirmCancel(props, far)
    expect(list).toHaveBeenCalledTimes(3)
    expect(view.statuses.map(text)).toEqual([t.cancelledNote])
    const notice = attach(view.statuses[0])
    runEveryRenderEffects()
    expect(page.activeElement).toBe(notice)

    reread.resolve(listed({ upcoming: [other] }))
    overtaken.resolve(listed({ upcoming: [far, other] }))
    await flush()

    const settled = screen(props)
    expect(settled.row(far)).toBeUndefined()
    expect(settled.row(other)).toBeDefined()
    expect(settled.statuses.map(text)).toEqual([t.cancelledNote])
    runEveryRenderEffects()
    expect(notice.focus).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(notice)
  })

  it('moves focus to the question, and back to the cancel button when the customer backs out', async () => {
    const props = dialogProps(portWith({ upcoming: [far] }))
    await openList(props)

    click(expand(props, far).button(t.cancelBtn))
    const asking = screen(props)
    const questionNode = asking.all.find((node) => text(node) === t.cancelConfirmQ)
    expect(questionNode?.props).not.toHaveProperty('tabIndex')
    const question = attach(questionNode)
    runEveryRenderEffects()
    expect(question.focus).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(question)

    // The focus moves once; a later render leaves it where the customer put it.
    const elsewhere = focusElsewhere()
    screen(props)
    runEveryRenderEffects()
    expect(question.focus).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(elsewhere)

    // A control takes the focus with its focus outline.
    click(asking.button(t.cancelConfirmNo))
    const cancelButton = attach(screen(props).button(t.cancelBtn), 'control')
    runEveryRenderEffects()
    expect(page.activeElement).toBe(cancelButton)
    expect([...cancelButton.attributes]).toEqual([])
  })
})

describe('my bookings: linking another e-mail address', () => {
  it('moves focus to the result message when the confirm button gives way to it', async () => {
    const link = customerEmailLinkStrings('sv')
    const confirmEmailLink = vi.fn<MyBookingsPort['confirmEmailLink']>(async () => ({
      ok: true,
      status: 'waiting',
    }))
    const props: CustomerEmailLinkProps = {
      lang: 'sv',
      dark: false,
      port: portWith({}, { confirmEmailLink }),
      profile: { name: 'Ada Lovelace', phone: '0701234567', email: 'ada@example.test' },
      code: 'link-code',
      onLinked: () => undefined,
    }
    const view = (): RenderedNode[] => nodes(render(() => CustomerEmailLink(props)))
    const confirmButton = (all: RenderedNode[]): RenderedNode | undefined =>
      all.find((node) => node.type === 'button' && text(node) === link.confirm)

    click(confirmButton(view()))
    await flush()

    const after = view()
    expect(confirmEmailLink.mock.calls).toEqual([['link-code']])
    expect(confirmButton(after)).toBeUndefined()
    const status = after.find((node) => node.props['role'] === 'status')
    expect(text(status)).toBe(link.waiting)
    expect(status?.props).not.toHaveProperty('tabIndex')

    const message = attach(status)
    mount()
    expect(message.focus).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(message)
    expect(message.attributes.has('data-quiet-focus')).toBe(true)
  })
})

describe('my bookings: the link request and the title', () => {
  it('announces that the link was sent and moves focus to that message', async () => {
    const requestAccess = vi.fn<MyBookingsPort['requestAccess']>(async () => ({ ok: true }))
    const props = dialogProps(portWith({}, { requestAccess }), { accessError: 'invalid' })

    const input = screen(props).all.find((node) => node.type === 'input')
    ;(input?.props['onInput'] as (event: unknown) => void)({
      currentTarget: { value: 'ada@example.test' },
    })
    click(screen(props).button(t.lookupBtn))
    await flush()

    const view = screen(props)
    expect(requestAccess.mock.calls).toEqual([
      [{ email: 'ada@example.test', lang: 'sv', turnstileToken: '' }],
    ])
    expect(view.statuses.map(text)).toEqual([t.accessSent])
    expect(view.statuses[0]?.props).not.toHaveProperty('tabIndex')

    const sent = attach(view.statuses[0])
    runEveryRenderEffects()
    expect(sent.focus).toHaveBeenCalledOnce()
    expect(page.activeElement).toBe(sent)
  })

  it('exposes the title as a level-2 heading on its original span in both steps', async () => {
    const lookup = screen(dialogProps(portWith({}), { accessError: 'invalid' })).headings
    expect(lookup.map((node) => [node.type, node.props['id'], text(node)])).toEqual([
      ['span', 'knc-mybookings-title', t.title],
    ])
    expect(lookup[0]?.props['aria-level']).toBe(2)

    reset()
    const props = dialogProps(portWith({ upcoming: [booking('far', startingIn(72))] }))
    await openList(props)
    const list = screen(props).headings
    expect(list.map((node) => [node.type, node.props['id'], text(node)])).toEqual([
      ['span', 'knc-mybookings-list-title', t.title],
    ])
    expect(list[0]?.props['aria-level']).toBe(2)
  })
})
