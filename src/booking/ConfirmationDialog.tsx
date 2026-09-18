import { CmsImage } from '../cms/context'
// The booking "confirmation" modal — ported from the original mock, wrapped in the accessible
// Dialog. Calendar/map links come from the BookingPort result; the local adapter reproduces the
// mock's link strings, so output is identical.

import type { JSX } from 'preact'
import type { BookingStrings } from '../i18n/index'
import { Dialog } from '../ui/Dialog'
import { pseudoClass } from '../ui/pseudo'
import type { BookingStyles } from './bookingStyles'

const BACKDROP_STYLE =
  'position:fixed;inset:0;box-sizing:border-box;background:rgba(10,10,12,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px 16px;z-index:50;animation:kncOverlay .2s ease both;overflow:hidden;'

export interface ConfirmationDialogProps {
  readonly t: BookingStrings
  readonly s: BookingStyles
  readonly closeLabel: string
  readonly confirmSentLine: string
  readonly customerAccessNote?: string
  readonly sumBarber: string
  readonly sumWhen: string
  readonly sumService: string
  readonly sumPrice: string
  readonly icsHref: string
  readonly gcalHref: string
  readonly mapsHref: string
  readonly showDirections: boolean
  readonly calRowHover: string
  readonly onReset: () => void
  /** Open "Mina bokningar" (resets the flow, then opens the popup). Omitted → the button is hidden. */
  readonly onMyBookings?: (() => void) | undefined
  /** Label for the "Mina bokningar" button (from the shell strings); required when onMyBookings is set. */
  readonly myBookingsLabel?: string | undefined
  readonly onBackdropClick: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void
}

export function ConfirmationDialog(props: ConfirmationDialogProps): JSX.Element {
  const { t, s } = props
  return (
    <Dialog
      titleId="knc-booked-title"
      onClose={props.onReset}
      onBackdropClick={props.onBackdropClick}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={s.overlayCardStyle}
    >
      <button
        data-cms-node="confirmationdialog-button-1"
        onClick={props.onReset}
        style={s.confirmCloseStyle}
        aria-label={props.closeLabel}
      >
        ×
      </button>
      <div
        data-cms-node="confirmationdialog-div-2"
        style="padding:28px 22px 20px;text-align:center;"
      >
        <div data-cms-node="confirmationdialog-div-3" style={s.successCircleStyle}>
          <CmsImage
            data-cms-node="confirmationdialog-img-4"
            src="/icons/checkmark.svg"
            alt=""
            style={s.successCheckStyle}
          />
        </div>
        <div
          data-cms-node="confirmationdialog-div-5"
          data-cms-copy="site:bookedTitle"
          id="knc-booked-title"
          style="font-family:'Inter Variable';font-weight:600;font-size:20px;margin-bottom:6px;"
        >
          {t.bookedTitle}
        </div>
        <div
          data-cms-node="confirmationdialog-div-6"
          style="font-size:13.5px;opacity:.6;line-height:1.45;max-width:300px;margin:0 auto;"
        >
          {props.confirmSentLine}
        </div>
        {props.customerAccessNote ? (
          <p
            data-cms-node="confirmationdialog-p-7"
            style={{ fontSize: '13px', lineHeight: 1.45, margin: '12px auto 0', maxWidth: '300px' }}
          >
            {props.customerAccessNote}
          </p>
        ) : null}
      </div>
      <div data-cms-node="confirmationdialog-div-8" style={s.confirmSummaryStyle}>
        <div
          data-cms-node="confirmationdialog-div-9"
          style="display:flex;justify-content:space-between;font-size:14px;"
        >
          <span
            data-cms-node="confirmationdialog-span-10"
            data-cms-copy="site:fBarber"
            style="opacity:.55;"
          >
            {t.fBarber}
          </span>
          <span data-cms-node="confirmationdialog-span-11" style="font-weight:600;">
            {props.sumBarber}
          </span>
        </div>
        <div
          data-cms-node="confirmationdialog-div-12"
          style="display:flex;justify-content:space-between;font-size:14px;"
        >
          <span
            data-cms-node="confirmationdialog-span-13"
            data-cms-copy="site:fWhen"
            style="opacity:.55;"
          >
            {t.fWhen}
          </span>
          <span
            data-cms-node="confirmationdialog-span-14"
            style="font-weight:600;text-align:right;"
          >
            {props.sumWhen}
          </span>
        </div>
        <div
          data-cms-node="confirmationdialog-div-15"
          style="display:flex;justify-content:space-between;font-size:14px;"
        >
          <span
            data-cms-node="confirmationdialog-span-16"
            data-cms-copy="site:fService"
            style="opacity:.55;"
          >
            {t.fService}
          </span>
          <span
            data-cms-node="confirmationdialog-span-17"
            style="font-weight:600;text-align:right;"
          >
            {props.sumService} · {props.sumPrice}
          </span>
        </div>
      </div>
      <div data-cms-node="confirmationdialog-div-18" style="padding:16px 18px 8px;">
        <div
          data-cms-node="confirmationdialog-div-19"
          data-cms-copy="site:addToCal"
          style="font-size:12px;font-weight:600;opacity:.55;margin-bottom:9px;"
        >
          {t.addToCal}
        </div>
        <div
          data-cms-node="confirmationdialog-div-20"
          style="display:flex;flex-direction:column;gap:8px;"
        >
          <a
            data-cms-node="confirmationdialog-a-21"
            href={props.icsHref}
            download="blade-blend-studio.ics"
            style={s.calRowStyle}
            class={pseudoClass('hover', props.calRowHover)}
          >
            <CmsImage
              data-cms-node="confirmationdialog-img-22"
              src="/icons/calendar.badge.plus.svg"
              alt=""
              style={s.calIconStyle}
            />
            {t.calApple}
          </a>
          <a
            data-cms-node="confirmationdialog-a-23"
            href={props.gcalHref}
            target="_blank"
            rel="noopener noreferrer"
            style={s.calRowStyle}
            class={pseudoClass('hover', props.calRowHover)}
          >
            <CmsImage
              data-cms-node="confirmationdialog-img-24"
              src="/icons/calendar.svg"
              alt=""
              style={s.calIconStyle}
            />
            {t.calGoogle}
          </a>
          {props.showDirections ? (
            <a
              data-cms-node="confirmationdialog-a-25"
              href={props.mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              style={s.calRowStyle}
              class={pseudoClass('hover', props.calRowHover)}
            >
              <CmsImage
                data-cms-node="confirmationdialog-img-26"
                src="/icons/mappin.circle.fill.svg"
                alt=""
                style={s.calIconStyle}
              />
              {t.directions}
            </a>
          ) : null}
        </div>
      </div>
      <div data-cms-node="confirmationdialog-div-27" style="padding:6px 18px 18px;">
        {props.onMyBookings !== undefined && props.myBookingsLabel !== undefined ? (
          <button
            data-cms-node="confirmationdialog-button-28"
            onClick={props.onMyBookings}
            style={{ ...s.secondaryBtnStyle, marginBottom: '10px' }}
          >
            {props.myBookingsLabel}
          </button>
        ) : null}
        <button
          data-cms-node="confirmationdialog-button-29"
          data-cms-copy="copy:booking:newBooking"
          onClick={props.onReset}
          style={s.resetBtnStyle}
        >
          {t.newBooking}
        </button>
      </div>
    </Dialog>
  )
}
