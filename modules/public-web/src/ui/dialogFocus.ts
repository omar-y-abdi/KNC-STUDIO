// Keyboard focus around the shared dialog (ui/Dialog.tsx): Tab stops, holding focus in the topmost
// open dialog, and where focus settles when one closes.

import { focusQuietly, hasSkipLink, mainLandmark } from './pageFocus'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

/** A frame, or the marked host of one in a closed shadow root (booking/Turnstile.tsx): only the
 * browser's own Tab moves focus into it. */
const WIDGET = 'iframe,[data-knc-widget]'

/** A surface over an open dialog with a control of its own (the error state of ui/LazySurface.tsx):
 * focus and Tab inside it are left alone. */
const ABOVE_DIALOG = '[data-above-dialog]'

/** Within keyboard reach as far as the markup tells: not a hidden input or a disabled field, and
 * not in a part that is inert or hidden. */
function reachable(node: HTMLElement): boolean {
  return (
    !node.matches('input[type="hidden"],:disabled') && node.closest('[inert],[hidden]') === null
  )
}

/** The controls of `card` that Tab can stop at as far as the markup tells, in document order. */
export function tabStops(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable)
}

/** Focuses the first control of `card` (the last when `backwards`) that takes focus, else the card
 * itself. */
export function focusIntoCard(card: HTMLElement, backwards: boolean): void {
  const stops = tabStops(card)
  for (const stop of backwards ? stops.reverse() : stops) {
    stop.focus()
    if (document.activeElement === stop) return
  }
  card.focus()
}

/** Whether Tab (Shift+Tab when `backwards`) leaves `card`, so the dialog must wrap it. A widget
 * past the edge control is entered by the browser (a challenge under a disabled submit). */
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

/** The last opened dialog that can hold focus: one left open in a part that has become inert (the
 * closed desktop booking fold) holds nothing until that part returns. */
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

/** While `card` is the topmost open dialog, focus that lands outside it returns and Tab outside it
 * enters it; a surface above the dialog keeps its focus and Tab. Returns the release. */
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

/** Once a closed dialog has left the document and nothing holds focus: the opener, else the dialog
 * below, else the main landmark. Only in the public shell (`hasSkipLink`). */
export function settleFocusAfterClose(opener: HTMLElement | null): void {
  if (!hasSkipLink()) return
  const active = document.activeElement
  if (active !== null && active !== document.body) return
  if (opener !== null && opener !== document.body && opener.isConnected) {
    opener.focus()
    if (document.activeElement === opener) return
  }
  // The opener is gone, was the body, or sits in a part that cannot hold focus now.
  const below = topCard()
  if (below !== undefined) below.focus({ preventScroll: true })
  else focusQuietly(mainLandmark())
}
