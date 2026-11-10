// Keyboard focus around the shared dialog (ui/Dialog.tsx): which of a dialog's controls Tab can
// stop at, keeping focus in the topmost open dialog, and where focus settles when a dialog closes.
// Nothing here runs at import time.

import { focusQuietly, hasSkipLink, mainLandmark } from './pageFocus'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

/** An embedded widget: a frame, or the container of one that sits in a closed shadow root and is
 * marked for that reason (booking/Turnstile.tsx). What is inside it is out of this document's
 * sight, so only the browser moves keyboard focus into it: by Tab from the control before it, by
 * Shift+Tab from the control after it. */
const WIDGET = 'iframe,[data-knc-widget]'

/** A surface that covers an open dialog and has a control of its own: the error state of an
 * overlay `LazySurface` (ui/LazySurface.tsx sets the attribute). Focus inside it is left there,
 * and so is Tab pressed inside it. */
const ABOVE_DIALOG = '[data-above-dialog]'

/** Whether `node` is within reach of the keyboard as far as the markup tells. A selector match
 * alone also covers a hidden input (Turnstile's response field), a disabled field and whatever
 * sits in a part that is inert or hidden. */
function reachable(node: HTMLElement): boolean {
  return (
    !node.matches('input[type="hidden"],:disabled') && node.closest('[inert],[hidden]') === null
  )
}

/** The controls of `card` that Tab can stop at as far as the markup tells, in document order. */
export function tabStops(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable)
}

/** Moves focus into `card`: to its first control, or to its last when `backwards`, passing over a
 * control that does not take it (one that is not rendered, say). The card itself holds the focus
 * when none does. */
export function focusIntoCard(card: HTMLElement, backwards: boolean): void {
  const stops = tabStops(card)
  for (const stop of backwards ? stops.reverse() : stops) {
    stop.focus()
    if (document.activeElement === stop) return
  }
  card.focus()
}

/**
 * Whether Tab, or Shift+Tab when `backwards`, would take focus out of `card` from where it is, so
 * that the dialog has to wrap it: forwards from the last control, backwards from the first one or
 * from the card itself. A card without a control is always left.
 *
 * An embedded widget that lies beyond that control is still inside the card. The step into it,
 * Tab from the last control or Shift+Tab from the first, is the browser's and the only way in: a
 * verification challenge under a submit button that is disabled until it is solved.
 */
export function tabLeavesCard(card: HTMLElement, backwards: boolean): boolean {
  const active = document.activeElement
  // Shift+Tab from the card itself leaves it whatever it holds: all of it comes after.
  if (backwards && active === card) return true
  const order = [...card.querySelectorAll<HTMLElement>(`${FOCUSABLE},${WIDGET}`)].filter(reachable)
  const stops = order.filter((node) => node.matches(FOCUSABLE))
  const edge = backwards ? stops[0] : stops[stops.length - 1]
  if (edge === undefined) return order.length === 0
  // Everything beyond the outermost control is a widget.
  const beyond = backwards ? order.indexOf(edge) : order.length - 1 - order.indexOf(edge)
  return beyond === 0 && active === edge
}

/** The cards of the open dialogs in the order they opened. */
const openCards: HTMLElement[] = []

/** The dialog keyboard focus belongs in: the last one opened that can hold it. A dialog left open
 * inside a part of the page that has since become inert (the closed desktop booking fold keeps its
 * content mounted) holds nothing until that part returns. */
function topCard(): HTMLElement | undefined {
  for (let index = openCards.length - 1; index >= 0; index--) {
    const card = openCards[index]
    if (card !== undefined && card.isConnected && card.closest('[inert]') === null) return card
  }
  return undefined
}

function returnFocusToTopDialog(event: FocusEvent): void {
  const card = topCard()
  const target = event.target
  if (card === undefined || !(target instanceof Element) || card.contains(target)) return
  if (target.closest(ABOVE_DIALOG) !== null) return
  card.focus({ preventScroll: true })
}

function enterTopDialogOnTab(event: KeyboardEvent): void {
  const card = topCard()
  const active = document.activeElement
  if (card === undefined || event.key !== 'Tab' || card.contains(active)) return
  if (active !== null && active.closest(ABOVE_DIALOG) !== null) return
  event.preventDefault()
  focusIntoCard(card, event.shiftKey)
}

/** Keeps keyboard focus in `card` while it is the topmost open dialog: focus that lands outside it
 * returns to it, and Tab pressed while focus is outside it enters it. Focus on a widget embedded in
 * the card is inside it: the event names the widget's host element. A surface above the dialog
 * keeps both its focus and its Tab. Returns the release. */
export function holdKeyboardFocus(card: HTMLElement): () => void {
  if (openCards.length === 0) {
    document.addEventListener('focusin', returnFocusToTopDialog)
    document.addEventListener('keydown', enterTopDialogOnTab, true)
  }
  openCards.push(card)
  return () => {
    const index = openCards.lastIndexOf(card)
    if (index !== -1) openCards.splice(index, 1)
    if (openCards.length > 0) return
    document.removeEventListener('focusin', returnFocusToTopDialog)
    document.removeEventListener('keydown', enterTopDialogOnTab, true)
  }
}

/**
 * Settles keyboard focus once a closed dialog has left the document. `opener` held the focus when
 * the dialog opened and has been given it back once already. Focus that rests on something is left
 * alone. Otherwise, in order: the opener, if it is still in the document and takes focus; the
 * dialog below; the page's main landmark, without a visible change.
 *
 * Only a page that has declared its main landmark a focus target does this (`hasSkipLink`: the
 * public shell). On the staff pages, in Studio and in the frames Studio embeds, closing a dialog
 * gives focus back to the opener and nothing more.
 */
export function settleFocusAfterClose(opener: HTMLElement | null): void {
  if (!hasSkipLink()) return
  const active = document.activeElement
  if (active !== null && active !== document.body) return
  if (opener !== null && opener !== document.body && opener.isConnected) {
    opener.focus()
    if (document.activeElement === opener) return
  }
  // The opener is gone (a booked time, a cancelled row), was the document body (nothing held focus
  // when the dialog opened) or sits in a part that cannot hold focus now.
  const below = topCard()
  if (below !== undefined) below.focus({ preventScroll: true })
  else focusQuietly(mainLandmark())
}
