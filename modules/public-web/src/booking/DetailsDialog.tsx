// The booking "details" modal — ported from the original mock, wrapped in the accessible
// Dialog. The only addition over the mock is per-field validation feedback (red border + a
// localized red note under each invalid field) rendered ONLY after a failed submit, so the
// default popup renders exactly as the mock did.

import type { JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { BookingStrings, Lang } from '../i18n/index'
import { Dialog, type DialogProps } from '../ui/Dialog'
import { langHref } from '../ui/langHref'
import { FOCUS_CLS } from '../ui/pseudo'
import { sheetBackdropStyle, type BookingStyles } from './bookingStyles'
import type { FieldErrors } from './validation'

const BACKDROP_STYLE = sheetBackdropStyle(40)

/** While the pending layer covers `card`: the card at its top, the focus inside it. The release
 * gives back the scroll position, and the focus the inert form dropped. */
export function holdCard(card: HTMLElement): () => void {
  const top = card.scrollTop
  const before = document.activeElement
  const dropped =
    before === null ||
    before === document.body ||
    (card.contains(before) && before.closest('[inert]') !== null)
  card.scrollTop = 0
  if (dropped) card.focus({ preventScroll: true })
  return () => {
    card.scrollTop = top
    // Safari counts a zoomed card's position in whole pixels and lands one short of it.
    if (card.scrollTop < top) card.scrollTop = top + 1
    if (
      dropped &&
      document.activeElement === card &&
      before instanceof HTMLElement &&
      card.contains(before)
    )
      before.focus({ preventScroll: true })
  }
}

export interface DetailsDialogProps {
  readonly cms?: DialogProps['cms']
  readonly t: BookingStrings
  /** The language of `t`: the terms link opens the terms in it. */
  readonly lang: Lang
  readonly s: BookingStyles
  readonly closeLabel: string
  readonly sumBarber: string
  readonly sumWhen: string
  readonly sumService: string
  readonly sumPrice: string
  readonly nameValue: string
  readonly phoneValue: string
  readonly emailValue: string
  readonly bookDisabled: boolean
  /** A submit is on its way: the pending layer covers the card, whose form is inert meanwhile; the
   * button itself only gets `aria-busy`. */
  readonly bookBusy: boolean
  /** Per-field error flags from the last failed submit (all false = pristine popup). */
  readonly fieldErrors: FieldErrors
  /** The line above the book button about a submit, or null. Distinct from field errors. */
  readonly submitError: string | null
  readonly onName: (e: JSX.TargetedInputEvent<HTMLInputElement>) => void
  readonly onPhone: (e: JSX.TargetedInputEvent<HTMLInputElement>) => void
  readonly onEmail: (e: JSX.TargetedInputEvent<HTMLInputElement>) => void
  readonly onBook: () => void
  readonly onClose: () => void
  readonly onBackdropClick: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void
  /** The Cloudflare Turnstile widget (or null when unconfigured/offline), rendered above the
   * Book button. Kept as an injected node so this dialog stays presentational. */
  readonly turnstile: JSX.Element | null
}

export function DetailsDialog(props: DetailsDialogProps): JSX.Element {
  const { t, s } = props
  const e = props.fieldErrors
  const busy = props.bookBusy
  // On an existing control: a ref makes an element required in the CMS, and this one already is.
  const closeRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const card = busy ? closeRef.current?.closest<HTMLElement>('[role="dialog"]') : null
    return card ? holdCard(card) : undefined
  }, [busy])

  // A field's input swaps to the error style (red border + ring) when flagged; a localized red
  // note renders directly under it inside the same label column. When not flagged, the markup
  // matches the original mock.
  const field = (
    label: string,
    value: string,
    onInput: (ev: JSX.TargetedInputEvent<HTMLInputElement>) => void,
    placeholder: string,
    inputType: 'text' | 'tel' | 'email',
    invalid: boolean,
    note: string,
  ): JSX.Element => (
    <label style="display:flex;flex-direction:column;gap:5px;">
      <span style="font-size:12px;font-weight:600;opacity:.55;">{label}</span>
      <input
        value={value}
        onInput={onInput}
        placeholder={placeholder}
        type={inputType}
        autoComplete={inputType === 'text' ? 'name' : inputType}
        {...(inputType !== 'text' ? { inputMode: inputType } : {})}
        aria-required="true"
        aria-invalid={invalid ? 'true' : undefined}
        style={invalid ? s.inputErrorStyle : s.inputStyle}
        class={FOCUS_CLS}
      />
      {invalid ? (
        <span role="alert" style={s.fieldErrorNoteStyle}>
          {note}
        </span>
      ) : null}
    </label>
  )

  return (
    <Dialog
      titleId="knc-details-title"
      {...(props.cms ? { cms: props.cms } : {})}
      onClose={props.onClose}
      onBackdropClick={props.onBackdropClick}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={busy ? { ...s.overlayCardStyle, overflow: 'hidden' } : s.overlayCardStyle}
    >
      <div style={s.overlayHeaderStyle} inert={busy}>
        {/* A heading by role, not tag: the published presentation stores it as a span. */}
        <span
          id="knc-details-title"
          role="heading"
          aria-level={2}
          style="font-family:'Inter Variable';font-weight:600;font-size:17px;"
        >
          {t.yourDetails}
        </span>
        <button
          ref={closeRef}
          onClick={props.onClose}
          style={s.closeBtnStyle}
          aria-label={props.closeLabel}
        >
          ×
        </button>
      </div>
      <div style="padding:16px 18px 18px;" inert={busy}>
        <div style={s.summaryBoxStyle}>
          <span style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;opacity:.55;">
            {t.summary}
          </span>
          <div style="display:flex;justify-content:space-between;font-size:14px;">
            <span style="opacity:.55;">{t.fBarber}</span>
            <span style="font-weight:600;">{props.sumBarber}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:14px;">
            <span style="opacity:.55;">{t.fWhen}</span>
            <span style="font-weight:600;text-align:right;">{props.sumWhen}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:14px;">
            <span style="opacity:.55;">{t.fService}</span>
            <span style="font-weight:600;text-align:right;">{props.sumService}</span>
          </div>
          <div style={s.dividerStyle}></div>
          <div style="display:flex;justify-content:space-between;font-size:15px;">
            <span style="font-weight:600;">{t.fTotal}</span>
            <span style="font-weight:700;">{props.sumPrice}</span>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          {field(t.name, props.nameValue, props.onName, t.namePh, 'text', e.name, t.errName)}
          {field(t.phone, props.phoneValue, props.onPhone, t.phonePh, 'tel', e.phone, t.errPhone)}
          {field(t.email, props.emailValue, props.onEmail, t.emailPh, 'email', e.email, t.errEmail)}
        </div>

        <p style="font-size:11.5px;line-height:1.5;opacity:.5;margin:16px 0 14px;">{t.policy}</p>
        <p style="font-size:12px;line-height:1.5;margin:0 0 14px;">
          <a
            href={langHref('/terms', props.lang)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.termsLinkLabel}
            class={FOCUS_CLS}
            style="color:inherit;text-underline-offset:3px;"
          >
            {t.termsLink}
          </a>
        </p>

        {props.turnstile !== null ? (
          <div style="display:flex;justify-content:center;margin:0 0 14px;">{props.turnstile}</div>
        ) : null}

        {props.submitError !== null ? (
          <p role="alert" style={s.submitErrorStyle}>
            {props.submitError}
          </p>
        ) : null}

        <button
          onClick={props.bookDisabled ? undefined : props.onBook}
          disabled={props.bookDisabled}
          aria-busy={props.bookBusy ? 'true' : undefined}
          style={s.bookBtnStyle}
        >
          {t.book}
        </button>
      </div>
      {busy ? (
        <div
          key="booking-pending"
          class="knc-pending"
          role="status"
          aria-live="polite"
          style={s.pendingStyle}
        >
          <div class="knc-pending-body" style={s.pendingBodyStyle}>
            <div aria-hidden="true" style={s.pendingIndicatorStyle}>
              <div class="knc-pending-orbit" style={s.pendingOrbitStyle}>
                <div class="knc-pending-comet" style={s.pendingCometStyle}></div>
                <div class="knc-pending-head" style={s.pendingHeadStyle}></div>
              </div>
              <div class="knc-pending-disc" style={s.pendingDiscStyle}>
                <img src="/icons/calendar.svg" alt="" style={s.pendingIconStyle} />
              </div>
            </div>
            <div style={s.pendingTitleStyle}>{t.bookingInProgress}</div>
            <div style={s.pendingSubStyle}>
              {props.sumWhen} · {props.sumService}
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}
