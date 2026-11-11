import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  bookingStrings,
  myBookingsStrings,
  type Lang,
} from '../../modules/public-web/src/i18n/index'
import { buildBookingStyles, palette } from '../../modules/public-web/src/booking/bookingStyles'

// The dialogs are called as plain functions here; their hooks need a stand-in renderer.
vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))

const styleSheet = { cssRules: { length: 0 }, insertRule: (): void => undefined }
const styleElement = { sheet: styleSheet }
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    createElement: (): typeof styleElement => styleElement,
    head: { appendChild: (): void => undefined },
  },
})

const [{ DetailsDialog }, { ConfirmationDialog }] = await Promise.all([
  import('../../modules/public-web/src/booking/DetailsDialog'),
  import('../../modules/public-web/src/booking/ConfirmationDialog'),
])

afterAll(() => {
  delete (globalThis as { document?: unknown }).document
})

interface VNodeLike {
  readonly type?: unknown
  readonly props?: {
    readonly children?: unknown
    readonly [key: string]: unknown
  }
}

function findElement(node: unknown, type: string): VNodeLike | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type)
      if (found !== null) return found
    }
    return null
  }
  if (typeof node !== 'object' || node === null) return null
  const vnode = node as VNodeLike
  if (vnode.type === type) return vnode
  return findElement(vnode.props?.children, type)
}

function findWhere(node: unknown, matches: (vnode: VNodeLike) => boolean): VNodeLike | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findWhere(child, matches)
      if (found !== null) return found
    }
    return null
  }
  if (typeof node !== 'object' || node === null) return null
  const vnode = node as VNodeLike
  if (matches(vnode)) return vnode
  return findWhere(vnode.props?.children, matches)
}

function textContent(node: unknown): string {
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''
  return textContent((node as VNodeLike).props?.children)
}

function findById(node: unknown, id: string): VNodeLike | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findById(child, id)
      if (found !== null) return found
    }
    return null
  }
  if (typeof node !== 'object' || node === null) return null
  const vnode = node as VNodeLike
  if (vnode.props?.['id'] === id) return vnode
  return findById(vnode.props?.children, id)
}

describe('booking dialog close controls', () => {
  const styles = buildBookingStyles(palette(false), false, false)
  const t = bookingStrings('sv')
  const closeLabel = myBookingsStrings('sv').ariaClose
  const noop = (): void => undefined
  const details = (lang: Lang = 'sv', bookBusy = false): unknown =>
    DetailsDialog({
      t: bookingStrings(lang),
      lang,
      s: styles,
      closeLabel,
      sumBarber: 'Barberare',
      sumWhen: 'måndag 1 januari kl 09:00',
      sumService: 'Behandling',
      sumPrice: '300 kr',
      nameValue: '',
      phoneValue: '',
      emailValue: '',
      bookDisabled: false,
      bookBusy,
      fieldErrors: { name: false, phone: false, email: false },
      submitError: null,
      onName: noop,
      onPhone: noop,
      onEmail: noop,
      onBook: noop,
      onClose: noop,
      onBackdropClick: noop,
      turnstile: null,
    })
  const confirmation = (): unknown =>
    ConfirmationDialog({
      t,
      s: styles,
      closeLabel,
      confirmSentLine: 'Bekräftelse skickad.',
      sumBarber: 'Barberare',
      sumWhen: 'måndag 1 januari kl 09:00',
      sumService: 'Behandling',
      sumPrice: '300 kr',
      icsHref: 'data:text/calendar,',
      gcalHref: 'https://calendar.google.com/',
      mapsHref: 'https://maps.example/',
      showDirections: false,
      calRowHover: '',
      onReset: noop,
      onBackdropClick: noop,
      checkEntrance: 'animate',
    })

  it('reuses the localized My Bookings close label in both booking dialogs', () => {
    expect('ariaClose' in t).toBe(false)
    expect(closeLabel).toBe('Stäng')
    expect(myBookingsStrings('en').ariaClose).toBe('Close')

    const detailsClose = findElement(details(), 'button')
    const confirmationClose = findElement(confirmation(), 'button')

    expect(detailsClose?.props?.['aria-label']).toBe(closeLabel)
    expect(textContent(detailsClose)).toBe('×')
    expect(confirmationClose?.props?.['aria-label']).toBe(closeLabel)
    expect(textContent(confirmationClose)).toBe('×')
  })

  // The presentation stores these titles as a `span` and a `div`; the element is their identity.
  it('exposes each dialog title as a level-2 heading on its original element', () => {
    const detailsTitle = findById(details(), 'knc-details-title')
    expect(detailsTitle?.type).toBe('span')
    expect(detailsTitle?.props).toMatchObject({ role: 'heading', 'aria-level': 2 })
    expect(textContent(detailsTitle)).toBe(t.yourDetails)

    const bookedTitle = findById(confirmation(), 'knc-booked-title')
    expect(bookedTitle?.type).toBe('div')
    expect(bookedTitle?.props).toMatchObject({ role: 'heading', 'aria-level': 2 })
    expect(textContent(bookedTitle)).toBe(t.bookedTitle)
  })

  it('marks the book button as busy while its submit is on its way, and changes nothing else', () => {
    const bookButton = (dialog: unknown): VNodeLike | null =>
      findWhere(dialog, (node) => node.type === 'button' && textContent(node) === t.book)
    const idle = bookButton(details('sv', false))
    const busy = bookButton(details('sv', true))

    expect(idle?.props).not.toBeUndefined()
    expect(idle?.props?.['aria-busy']).toBeUndefined()
    expect(busy?.props?.['aria-busy']).toBe('true')
    expect(busy?.props?.['style']).toBe(idle?.props?.['style'])
    expect(busy?.props?.['disabled']).toBe(false)
    expect(textContent(busy)).toBe(textContent(idle))
  })

  // The card's children are CMS paths: the layer follows the two it covers, under its own key.
  it('lays a keyed status over the card while its submit is on its way, the form inert under it', () => {
    const cardChildren = (dialog: unknown): readonly VNodeLike[] =>
      (dialog as VNodeLike).props?.children as readonly VNodeLike[]
    const idle = details('sv', false)
    const busy = details('sv', true)
    const [header, body, layer] = cardChildren(busy)

    expect(cardChildren(idle)).toHaveLength(3)
    expect(cardChildren(idle)[2]).toBeNull()
    const [idleHeader, idleBody] = cardChildren(idle)
    expect([header?.type, body?.type]).toEqual(['div', 'div'])
    expect([idleHeader?.props?.['inert'], idleBody?.props?.['inert']]).toEqual([false, false])
    expect([header?.props?.['inert'], body?.props?.['inert']]).toEqual([true, true])
    expect((layer as { readonly key?: unknown }).key).toBe('booking-pending')
    expect(layer?.props).toMatchObject({
      class: 'knc-pending',
      role: 'status',
      'aria-live': 'polite',
      style: styles.pendingStyle,
    })
    expect(textContent(layer)).toBe(`${t.bookingInProgress}måndag 1 januari kl 09:00 · Behandling`)
    expect(t.bookingInProgress).toBe('Bokar din tid …')
    expect(textContent(cardChildren(details('en', true))[2])).toMatch(/^Booking your appointment …/)

    const indicator = findWhere(layer, (node) => node.props?.['aria-hidden'] === 'true')
    const classes: string[] = []
    findWhere(indicator, (node) => {
      if (typeof node.props?.['class'] === 'string') classes.push(node.props['class'])
      return false
    })
    expect(classes).toEqual([
      'knc-pending-orbit',
      'knc-pending-comet',
      'knc-pending-head',
      'knc-pending-disc',
    ])
    expect(findElement(indicator, 'img')?.props).toMatchObject({
      src: '/icons/calendar.svg',
      alt: '',
      style: styles.pendingIconStyle,
    })

    // Held still while the layer covers it: the card does not scroll under it.
    expect((busy as VNodeLike).props?.['cardStyle']).toEqual({
      ...styles.overlayCardStyle,
      overflow: 'hidden',
    })
    expect((idle as VNodeLike).props?.['cardStyle']).toBe(styles.overlayCardStyle)
  })

  it.each([
    ['sv', '/terms'],
    ['en', '/terms?lang=en'],
  ] as const)('opens the terms in the language of the popup (%s)', (lang, href) => {
    const link = findElement(details(lang), 'a')
    expect(textContent(link)).toBe(bookingStrings(lang).termsLink)
    expect(link?.props).toMatchObject({
      href,
      target: '_blank',
      'aria-label': bookingStrings(lang).termsLinkLabel,
    })
  })
})
