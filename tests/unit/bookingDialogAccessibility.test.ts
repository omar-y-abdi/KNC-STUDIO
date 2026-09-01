import { afterAll, describe, expect, it } from 'vitest'
import { bookingStrings, myBookingsStrings } from '../../src/i18n/index'
import { buildBookingStyles, palette } from '../../src/booking/bookingStyles'

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
  import('../../src/booking/DetailsDialog'),
  import('../../src/booking/ConfirmationDialog'),
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

function textContent(node: unknown): string {
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object' || node === null) return ''
  return textContent((node as VNodeLike).props?.children)
}

describe('booking dialog close controls', () => {
  it('reuses the localized My Bookings close label in both booking dialogs', () => {
    const styles = buildBookingStyles(palette(false), false, false)
    const t = bookingStrings('sv')
    const closeLabel = myBookingsStrings('sv').ariaClose
    const noop = (): void => undefined

    expect('ariaClose' in t).toBe(false)
    expect(closeLabel).toBe('Stäng')
    expect(myBookingsStrings('en').ariaClose).toBe('Close')

    const detailsClose = findElement(
      DetailsDialog({
        t,
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
      'button',
    )
    const confirmationClose = findElement(
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
      }),
      'button',
    )

    expect(detailsClose?.props?.['aria-label']).toBe(closeLabel)
    expect(textContent(detailsClose)).toBe('×')
    expect(confirmationClose?.props?.['aria-label']).toBe(closeLabel)
    expect(textContent(confirmationClose)).toBe('×')
  })
})
