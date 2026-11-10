// A small confirm dialog for destructive admin actions (cancel booking, delete image). Wraps the
// shared accessible `Dialog` (focus trap + Escape + restore focus) so every admin confirmation has
// the same a11y guarantees as the booking popups. Visual: a compact centered card in the palette.

import type { JSX } from 'preact'
import { Dialog } from '@bladeblend/public-web/dialog'
import { palette } from '@bladeblend/public-web/booking-styles'
import {
  buildAdminStyles,
  DIALOG_BACKDROP_STYLE,
  dialogCardStyle,
  dialogTitleStyle,
} from './adminStyles'

export interface ConfirmDialogProps {
  readonly dark: boolean
  readonly title: string
  readonly body: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  /** When true the confirm button uses the danger style. */
  readonly danger: boolean
  /** Disable the buttons while the action runs. */
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onClose: () => void
}

const TITLE_ID = 'admin-confirm-title'

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const c = palette(props.dark)
  const s = buildAdminStyles(c, props.dark)

  const onBackdropClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && !props.busy) props.onClose()
  }

  return (
    <Dialog
      titleId={TITLE_ID}
      onClose={props.onClose}
      onBackdropClick={onBackdropClick}
      backdropStyle={DIALOG_BACKDROP_STYLE}
      backdropClass="knc-admin-confirm-backdrop"
      cardStyle={dialogCardStyle(c, '360px')}
      cardClass="knc-admin-confirm-card"
    >
      <h2 id={TITLE_ID} style={dialogTitleStyle('8px')}>
        {props.title}
      </h2>
      <p style={{ margin: '0 0 18px', fontSize: '14px', lineHeight: 1.5, opacity: 0.8 }}>
        {props.body}
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button type="button" style={s.ghostBtn} onClick={props.onClose} disabled={props.busy}>
          {props.cancelLabel}
        </button>
        <button
          type="button"
          style={{
            ...(props.danger ? s.dangerBtn : s.primaryBtn),
            opacity: props.busy ? 0.6 : 1,
            cursor: props.busy ? 'default' : 'pointer',
          }}
          onClick={props.onConfirm}
          disabled={props.busy}
        >
          {props.busy ? '…' : props.confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
