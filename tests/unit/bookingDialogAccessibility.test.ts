import { afterAll, describe, expect, it } from 'vitest'
import {
  bookingStrings,
  myBookingsStrings,
  type Lang,
} from '../../modules/public-web/src/i18n/index'
import { buildBookingStyles, palette } from '../../modules/public-web/src/booking/bookingStyles'

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

  // The published presentation stores these two titles as a `span` and a `div`: they are headings
  // by role, and their element (and so their stored identity and look) stays what it was.
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

  // A submit on its way is said on the book button, to assistive technology only: the button keeps
  // its look and stays enabled (a pending submit is a normal state of the popup).
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

  // Swedish is the site's default and carries no query; an English visitor gets the English terms.
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
