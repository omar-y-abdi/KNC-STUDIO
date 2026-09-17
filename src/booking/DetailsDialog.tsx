// The booking "details" modal — ported from the original mock, wrapped in the accessible
// Dialog. The only addition over the mock is per-field validation feedback (red border + a
// localized red note under each invalid field) rendered ONLY after a failed submit, so the
// default popup renders exactly as the mock did.

import type { JSX } from 'preact'
import type { BookingStrings } from '../i18n/index'
import { Dialog } from '../ui/Dialog'
import { FOCUS_CLS } from '../ui/pseudo'
import type { BookingStyles } from './bookingStyles'
import type { FieldErrors } from './validation'

const BACKDROP_STYLE =
  'position:fixed;inset:0;box-sizing:border-box;background:rgba(10,10,12,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px 16px;z-index:40;animation:kncOverlay .2s ease both;overflow:hidden;'

export interface DetailsDialogProps {
  readonly t: BookingStrings
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
  /** Per-field error flags from the last failed submit (all false = pristine popup). */
  readonly fieldErrors: FieldErrors
  /** Generic system/submit error (port failure), or null. Distinct from field errors. */
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
    <label
      data-cms-node="detailsdialog-label-1"
      style="display:flex;flex-direction:column;gap:5px;"
    >
      <span
        data-cms-node="detailsdialog-span-2"
        style="font-size:12px;font-weight:600;opacity:.55;"
      >
        {label}
      </span>
      <input
        data-cms-node="detailsdialog-input-3"
        value={value}
        onInput={onInput}
        placeholder={placeholder}
        type={inputType}
        autoComplete={inputType === 'text' ? 'name' : inputType}
        {...(inputType !== 'text' ? { inputMode: inputType } : {})}
        aria-invalid={invalid ? 'true' : undefined}
        style={invalid ? s.inputErrorStyle : s.inputStyle}
        class={FOCUS_CLS}
      />
      {invalid ? (
        <span data-cms-node="detailsdialog-span-4" role="alert" style={s.fieldErrorNoteStyle}>
          {note}
        </span>
      ) : null}
    </label>
  )

  return (
    <Dialog
      titleId="knc-details-title"
      onClose={props.onClose}
      onBackdropClick={props.onBackdropClick}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={s.overlayCardStyle}
    >
      <div data-cms-node="detailsdialog-div-5" style={s.overlayHeaderStyle}>
        <span
          data-cms-node="detailsdialog-span-6"
          data-cms-copy="site:yourDetails"
          id="knc-details-title"
          style="font-family:'Inter Variable';font-weight:600;font-size:17px;"
        >
          {t.yourDetails}
        </span>
        <button
          data-cms-node="detailsdialog-button-7"
          onClick={props.onClose}
          style={s.closeBtnStyle}
          aria-label={props.closeLabel}
        >
          ×
        </button>
      </div>
      <div data-cms-node="detailsdialog-div-8" style="padding:16px 18px 18px;">
        <div data-cms-node="detailsdialog-div-9" style={s.summaryBoxStyle}>
          <span
            data-cms-node="detailsdialog-span-10"
            data-cms-copy="site:summary"
            style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;opacity:.55;"
          >
            {t.summary}
          </span>
          <div
            data-cms-node="detailsdialog-div-11"
            style="display:flex;justify-content:space-between;font-size:14px;"
          >
            <span
              data-cms-node="detailsdialog-span-12"
              data-cms-copy="site:fBarber"
              style="opacity:.55;"
            >
              {t.fBarber}
            </span>
            <span data-cms-node="detailsdialog-span-13" style="font-weight:600;">
              {props.sumBarber}
            </span>
          </div>
          <div
            data-cms-node="detailsdialog-div-14"
            style="display:flex;justify-content:space-between;font-size:14px;"
          >
            <span
              data-cms-node="detailsdialog-span-15"
              data-cms-copy="site:fWhen"
              style="opacity:.55;"
            >
              {t.fWhen}
            </span>
            <span data-cms-node="detailsdialog-span-16" style="font-weight:600;text-align:right;">
              {props.sumWhen}
            </span>
          </div>
          <div
            data-cms-node="detailsdialog-div-17"
            style="display:flex;justify-content:space-between;font-size:14px;"
          >
            <span
              data-cms-node="detailsdialog-span-18"
              data-cms-copy="site:fService"
              style="opacity:.55;"
            >
              {t.fService}
            </span>
            <span data-cms-node="detailsdialog-span-19" style="font-weight:600;text-align:right;">
              {props.sumService}
            </span>
          </div>
          <div data-cms-node="detailsdialog-div-20" style={s.dividerStyle}></div>
          <div
            data-cms-node="detailsdialog-div-21"
            style="display:flex;justify-content:space-between;font-size:15px;"
          >
            <span
              data-cms-node="detailsdialog-span-22"
              data-cms-copy="site:fTotal"
              style="font-weight:600;"
            >
              {t.fTotal}
            </span>
            <span data-cms-node="detailsdialog-span-23" style="font-weight:700;">
              {props.sumPrice}
            </span>
          </div>
        </div>

        <div
          data-cms-node="detailsdialog-div-24"
          style="display:flex;flex-direction:column;gap:10px;"
        >
          {field(t.name, props.nameValue, props.onName, t.namePh, 'text', e.name, t.errName)}
          {field(t.phone, props.phoneValue, props.onPhone, t.phonePh, 'tel', e.phone, t.errPhone)}
          {field(t.email, props.emailValue, props.onEmail, t.emailPh, 'email', e.email, t.errEmail)}
        </div>

        <p
          data-cms-node="detailsdialog-p-25"
          data-cms-copy="site:policy"
          style="font-size:11.5px;line-height:1.5;opacity:.5;margin:16px 0 14px;"
        >
          {t.policy}
        </p>
        <p
          data-cms-node="detailsdialog-p-26"
          style="font-size:12px;line-height:1.5;margin:0 0 14px;"
        >
          <a
            data-cms-node="detailsdialog-a-27"
            data-cms-copy="copy:booking:termsLink"
            href="/terms"
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
          <div
            data-cms-node="detailsdialog-div-28"
            style="display:flex;justify-content:center;margin:0 0 14px;"
          >
            {props.turnstile}
          </div>
        ) : null}

        {props.submitError !== null ? (
          <p data-cms-node="detailsdialog-p-29" role="alert" style={s.submitErrorStyle}>
            {props.submitError}
          </p>
        ) : null}

        <button
          data-cms-node="detailsdialog-button-30"
          data-cms-copy="copy:booking:book"
          onClick={props.bookDisabled ? undefined : props.onBook}
          disabled={props.bookDisabled}
          style={s.bookBtnStyle}
        >
          {t.book}
        </button>
      </div>
    </Dialog>
  )
}
