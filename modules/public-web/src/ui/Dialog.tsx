// Accessible modal wrapper shared by the booking details popup and the confirmation popup.
// It adds behaviour + ARIA around the caller's backdrop/card markup WITHOUT changing the visual
// markup or styles: same backdrop element (class + style passed in), same card.
//
// Behaviour added:
//  - role="dialog", aria-modal, aria-labelledby (the title element id)
//  - focus the dialog on open; restore focus to the previously-focused trigger on close. In the
//    public shell, when that trigger is gone or can no longer hold focus, the dialog below takes
//    it, else the page's main landmark (without a visible change)
//  - focus trap: Tab / Shift+Tab cycle within the dialog, over the controls that can take focus.
//    An embedded widget at either end of them (the verification challenge) is entered by the
//    browser's own Tab, which the trap leaves alone there
//  - the page behind stays out of reach of the keyboard: focus that lands outside the topmost open
//    dialog returns to it, and Tab pressed while nothing in it holds focus (the focused element was
//    removed) enters it. The page is not made `inert`: this dialog is shared with the staff pages,
//    whose own elements carry an `inert` the renderer owns, and an attribute removed from outside
//    would leave them out of step with it.
//    (The three points above are ui/dialogFocus.ts.)
//  - Escape closes (in addition to the existing backdrop click-to-close)
//  - prefers-reduced-motion: gate the entry animation only (settled appearance unchanged)

import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { useNativeSource, useNativeSurface } from '../cms/NativeSurface'
import type { CmsLang, CmsMode } from '@bladeblend/content-contracts/cms'
import {
  focusIntoCard,
  holdKeyboardFocus,
  settleFocusAfterClose,
  tabLeavesCard,
} from './dialogFocus'
import { prefersReducedMotion } from './reducedMotion'

export interface DialogProps {
  readonly cms?: { surface: string; lang: CmsLang; mode: CmsMode }
  /** Stable id used for `aria-labelledby` and applied to the title element by the caller. */
  readonly titleId: string
  /** Close handler — wired to Escape and (by the caller) to backdrop click. */
  readonly onClose: () => void
  /** Backdrop click handler (callers close when the click target is the backdrop itself). */
  readonly onBackdropClick: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void
  /** Inline style string for the backdrop. */
  readonly backdropStyle: string
  /** Class name for the backdrop (e.g. `knc-sheet-backdrop`). */
  readonly backdropClass: string
  /** Inline style object for the card (includes the entry `animation`). */
  readonly cardStyle: JSX.CSSProperties
  /** Class name for the card (e.g. `knc-sheet-card`). */
  readonly cardClass: string
  readonly children: ComponentChildren
}

/**
 * Renders backdrop + centered card with dialog semantics, focus management and a focus trap.
 * The caller fully controls the visual output; only behaviour/ARIA is layered on.
 */
export function Dialog(props: DialogProps): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  // A Studio source or capture frame shows the dialog as a scene: nothing there holds the keyboard.
  const nativeSource = useNativeSource()

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const card = cardRef.current
    if (card) card.focus()
    const release = card && !nativeSource ? holdKeyboardFocus(card) : null
    return () => {
      // Released first: the restore below moves focus out of this dialog.
      release?.()
      const prev = previouslyFocused.current
      if (prev && typeof prev.focus === 'function') prev.focus()
      // Settled once the closing tree has left the document: only then is it known whether the
      // restore held. A dialog closed together with the one it opened from is restored into that
      // one and loses the focus with it. Outside the public shell this changes nothing.
      queueMicrotask(() => settleFocusAfterClose(prev))
    }
  }, [])

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      props.onClose()
      return
    }
    if (e.key !== 'Tab') return
    const card = cardRef.current
    if (!card || !tabLeavesCard(card, e.shiftKey)) return
    e.preventDefault()
    focusIntoCard(card, e.shiftKey)
  }

  // Reduced motion: drop only the entry animation; the settled card looks identical.
  const cardStyle: JSX.CSSProperties = prefersReducedMotion()
    ? { ...props.cardStyle, animation: 'none' }
    : props.cardStyle

  const source = (
    <div
      onClick={props.onBackdropClick}
      onKeyDown={onKeyDown}
      class={props.backdropClass}
      style={props.backdropStyle}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.titleId}
        tabIndex={-1}
        class={props.cardClass}
        style={cardStyle}
      >
        {props.children}
      </div>
    </div>
  )
  return useNativeSurface(
    source,
    props.cms?.surface ?? `dialog-${props.titleId}`,
    props.cms?.lang ?? 'sv',
    props.cms?.mode ?? 'light',
  )
}
