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
  readonly confirmSentLine: string
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
      <button onClick={props.onReset} style={s.confirmCloseStyle}>
        ×
      </button>
      <div style="padding:28px 22px 20px;text-align:center;">
        <div style={s.successCircleStyle}>
          <img src="/icons/checkmark.svg" alt="" style={s.successCheckStyle} />
        </div>
        <div
          id="knc-booked-title"
          style="font-family:'SF Pro Display';font-weight:600;font-size:20px;margin-bottom:6px;"
        >
          {t.bookedTitle}
        </div>
        <div style="font-size:13.5px;opacity:.6;line-height:1.45;max-width:300px;margin:0 auto;">
          {props.confirmSentLine}
        </div>
      </div>
      <div style={s.confirmSummaryStyle}>
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
          <span style="font-weight:600;text-align:right;">
            {props.sumService} · {props.sumPrice}
          </span>
        </div>
      </div>
      <div style="padding:16px 18px 8px;">
        <div style="font-size:12px;font-weight:600;opacity:.55;margin-bottom:9px;">
          {t.addToCal}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <a
            href={props.icsHref}
            download="knc-studio.ics"
            style={s.calRowStyle}
            class={pseudoClass('hover', props.calRowHover)}
          >
            <img src="/icons/calendar.badge.plus.svg" alt="" style={s.calIconStyle} />
            {t.calApple}
          </a>
          <a
            href={props.gcalHref}
            target="_blank"
            rel="noopener noreferrer"
            style={s.calRowStyle}
            class={pseudoClass('hover', props.calRowHover)}
          >
            <img src="/icons/calendar.svg" alt="" style={s.calIconStyle} />
            {t.calGoogle}
          </a>
          {props.showDirections ? (
            <a
              href={props.mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              style={s.calRowStyle}
              class={pseudoClass('hover', props.calRowHover)}
            >
              <img src="/icons/mappin.circle.fill.svg" alt="" style={s.calIconStyle} />
              {t.directions}
            </a>
          ) : null}
        </div>
      </div>
      <div style="padding:6px 18px 18px;">
        <button onClick={props.onReset} style={s.resetBtnStyle}>
          {t.newBooking}
        </button>
      </div>
    </Dialog>
  )
}
