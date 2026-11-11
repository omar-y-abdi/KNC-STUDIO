// The booking "confirmation" modal — ported from the original mock, wrapped in the accessible
// Dialog. Calendar/map links come from the BookingPort result; the local adapter reproduces the
// mock's link strings, so output is identical.

import type { JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { useNativeSource } from '../cms/NativeSurface'
import type { BookingStrings } from '../i18n/index'
import { Dialog, type DialogProps } from '../ui/Dialog'
import { pseudoClass } from '../ui/pseudo'
import { prefersReducedMotion } from '../ui/reducedMotion'
import { sheetBackdropStyle, type BookingStyles } from './bookingStyles'
import { checkMoves, checkTargets, inkOf, playCheck, type CheckEntrance } from './checkAnimation'

const BACKDROP_STYLE = sheetBackdropStyle(50)
const TITLE_ID = 'knc-booked-title'

export interface ConfirmationDialogProps {
  readonly cms?: DialogProps['cms']
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
  /** `still` in the Studio's confirmation scene, where nothing was just booked. */
  readonly checkEntrance: CheckEntrance
}

export function ConfirmationDialog(props: ConfirmationDialogProps): JSX.Element {
  const { t, s } = props
  const frame = useNativeSource() ? 'source' : 'site'
  // On an existing control: a ref makes an element required in the CMS, and this one already is.
  const closeRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const motion = prefersReducedMotion() ? 'reduced' : 'full'
    if (!checkMoves(props.checkEntrance, motion, frame)) return
    const card = closeRef.current?.closest('[role="dialog"]')
    const targets = card ? checkTargets(card, TITLE_ID) : undefined
    if (card && targets) playCheck(targets, inkOf(getComputedStyle(card).color))
  }, [])
  return (
    <Dialog
      titleId={TITLE_ID}
      {...(props.cms ? { cms: props.cms } : {})}
      onClose={props.onReset}
      onBackdropClick={props.onBackdropClick}
      backdropClass="knc-sheet-backdrop"
      backdropStyle={BACKDROP_STYLE}
      cardClass="knc-sheet-card"
      cardStyle={s.overlayCardStyle}
    >
      <button
        ref={closeRef}
        onClick={props.onReset}
        style={s.confirmCloseStyle}
        aria-label={props.closeLabel}
      >
        ×
      </button>
      <div style="padding:28px 22px 20px;text-align:center;">
        <div style={s.successCircleStyle}>
          <img src="/icons/checkmark.svg" alt="" style={s.successCheckStyle} />
        </div>
        {/* A heading by role, not tag: the published presentation stores it as a div. */}
        <div
          id={TITLE_ID}
          role="heading"
          aria-level={2}
          style="font-family:'Inter Variable';font-weight:600;font-size:20px;margin-bottom:6px;"
        >
          {t.bookedTitle}
        </div>
        <div style="font-size:13.5px;opacity:.6;line-height:1.45;max-width:300px;margin:0 auto;">
          {props.confirmSentLine}
        </div>
        {props.customerAccessNote ? (
          <p
            style={{ fontSize: '13px', lineHeight: 1.45, margin: '12px auto 0', maxWidth: '300px' }}
          >
            {props.customerAccessNote}
          </p>
        ) : null}
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
            download="blade-blend-studio.ics"
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
        {props.onMyBookings !== undefined && props.myBookingsLabel !== undefined ? (
          <button
            onClick={props.onMyBookings}
            style={{ ...s.secondaryBtnStyle, marginBottom: '10px' }}
          >
            {props.myBookingsLabel}
          </button>
        ) : null}
        <button onClick={props.onReset} style={s.resetBtnStyle}>
          {t.newBooking}
        </button>
      </div>
    </Dialog>
  )
}
