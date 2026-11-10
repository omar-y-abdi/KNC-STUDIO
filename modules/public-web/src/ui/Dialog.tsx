// Accessible modal wrapper shared by the booking details popup and the confirmation popup.
// It adds behaviour + ARIA around the caller's backdrop/card markup WITHOUT changing the visual
// markup or styles: same backdrop element (class + style passed in), same card.
//
// Behaviour added:
//  - role="dialog", aria-modal, aria-labelledby (the title element id)
//  - focus the dialog on open; restore focus to the previously-focused trigger on close (in the
//    public shell, when it is gone: the dialog below, else the main landmark)
//  - focus trap: Tab / Shift+Tab cycle within the dialog; the browser's own Tab enters an embedded
//    widget at either end (the verification challenge)
//  - focus outside the topmost open dialog returns to it. Not `inert`: the staff pages' elements
//    carry an `inert` their renderer owns. (These three: ui/dialogFocus.ts.)
//  - Escape closes (in addition to the existing backdrop click-to-close)
//  - prefers-reduced-motion: gate the entry animation only (settled appearance unchanged)

import type { ComponentChildren, JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
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

  // Focus in the opening commit: a deferred effect runs a frame after the dialog is interactive and
  // would pull focus out of a field the customer already entered, dropping what they type next.
  useLayoutEffect(() => {
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
      // Once the closing tree has left the document, when it is known whether the restore held (a
      // dialog closed with the one it opened from loses it). Outside the public shell: nothing.
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
