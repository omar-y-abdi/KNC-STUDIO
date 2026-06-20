// Accessible modal wrapper shared by the booking details popup and the confirmation popup.
// It adds behaviour + ARIA around the source's existing backdrop/card markup WITHOUT changing
// the visual markup or styles: same backdrop element (class + style passed in), same card.
//
// Behaviour added:
//  - role="dialog", aria-modal, aria-labelledby (the title element id)
//  - focus the dialog on open; restore focus to the previously-focused trigger on close
//  - focus trap: Tab / Shift+Tab cycle within the dialog
//  - Escape closes (in addition to the existing backdrop click-to-close)
//  - prefers-reduced-motion: gate the entry animation only (settled appearance unchanged)

import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export interface DialogProps {
  /** Stable id used for `aria-labelledby` and applied to the title element by the caller. */
  readonly titleId: string
  /** Close handler — wired to Escape and (by the caller) to backdrop click. */
  readonly onClose: () => void
  /** Backdrop click handler (source closes when the click target is the backdrop itself). */
  readonly onBackdropClick: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void
  /** Inline style string for the backdrop (kept verbatim from the source). */
  readonly backdropStyle: string
  /** Class name for the backdrop (the source uses `knc-sheet-backdrop`). */
  readonly backdropClass: string
  /** Inline style object for the card (kept verbatim from the source; includes `animation`). */
  readonly cardStyle: JSX.CSSProperties
  /** Class name for the card (the source uses `knc-sheet-card`). */
  readonly cardClass: string
  readonly children: ComponentChildren
}

/**
 * Renders backdrop + centered card with dialog semantics, focus management and a focus trap.
 * Visual output is identical to the source; only behaviour/ARIA is layered on.
 */
export function Dialog(props: DialogProps): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const card = cardRef.current
    if (card) card.focus()
    return () => {
      const prev = previouslyFocused.current
      if (prev && typeof prev.focus === 'function') prev.focus()
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
    if (!card) return
    const nodes = card.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (nodes.length === 0) {
      e.preventDefault()
      card.focus()
      return
    }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || active === card) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Reduced motion: drop only the entry animation; the settled card looks identical.
  const cardStyle: JSX.CSSProperties = prefersReducedMotion()
    ? { ...props.cardStyle, animation: 'none' }
    : props.cardStyle

  return (
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
}
