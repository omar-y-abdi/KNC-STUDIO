// A reusable "type the token to confirm" dialog for HIGH-STAKES destructive admin actions (deleting a
// barber, purging all history). It is the same compact centered card as `ConfirmDialog`, but the
// confirm button stays disabled until the operator types the exact `token` (shown in quotes) — a
// deliberate friction gate so an irreversible delete can't be a single mis-click. Generic on purpose:
// the caller supplies the localized copy + the token to match, so the same component guards any
// type-to-confirm flow. Wraps the shared accessible `Dialog` (focus trap + Escape + restore focus).

import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { Dialog } from '../ui/Dialog'
import { palette } from '../booking/bookingStyles'
import { buildAdminStyles } from './adminStyles'

export interface TypeToConfirmDialogProps {
  readonly dark: boolean
  readonly title: string
  readonly body: string
  /** The exact string the operator must type (shown in quotes) before confirm enables. */
  readonly token: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  /** Disable every control while the action runs (prevents double-submit). */
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onClose: () => void
}

const TITLE_ID = 'admin-type-confirm-title'

export function TypeToConfirmDialog(props: TypeToConfirmDialogProps): JSX.Element {
  const c = palette(props.dark)
  const s = buildAdminStyles(c, props.dark)
  const [input, setInput] = useState('')

  // The gate: exact match (trimmed) AND not mid-flight. Both the button and Enter respect it.
  const matched = input.trim() === props.token
  const canConfirm = matched && !props.busy

  const backdropStyle =
    'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
    'padding:20px;background:rgba(0,0,0,.42);'
  const cardStyle: JSX.CSSProperties = {
    width: '100%',
    maxWidth: '360px',
    background: c.bg,
    color: c.text,
    border: '0.5px solid ' + c.line,
    borderRadius: '16px',
    padding: '20px 22px',
    boxShadow: '0 24px 60px rgba(0,0,0,.4)',
    fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
  }

  const onBackdropClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && !props.busy) props.onClose()
  }

  const onInputKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && canConfirm) {
      e.preventDefault()
      props.onConfirm()
    }
  }

  return (
    <Dialog
      titleId={TITLE_ID}
      onClose={props.onClose}
      onBackdropClick={onBackdropClick}
      backdropStyle={backdropStyle}
      backdropClass="knc-admin-type-confirm-backdrop"
      cardStyle={cardStyle}
      cardClass="knc-admin-type-confirm-card"
    >
      <h2
        id={TITLE_ID}
        style={{
          fontFamily: "'SF Pro Display',-apple-system,system-ui,sans-serif",
          fontSize: '17px',
          fontWeight: 700,
          margin: '0 0 8px',
        }}
      >
        {props.title}
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: '14px', lineHeight: 1.5, opacity: 0.8 }}>
        {props.body}
      </p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
        {/* The quoted token doubles as the input's visible, associated label. */}
        <span style={{ ...s.label, fontSize: '15px', fontWeight: 700, opacity: 1, margin: 0 }}>
          {'"' + props.token + '"'}
        </span>
        <input
          style={s.input}
          value={input}
          autoComplete="off"
          spellcheck={false}
          disabled={props.busy}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onInputKeyDown}
        />
      </label>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button type="button" style={s.ghostBtn} onClick={props.onClose} disabled={props.busy}>
          {props.cancelLabel}
        </button>
        <button
          type="button"
          style={{
            ...s.dangerBtn,
            opacity: canConfirm ? 1 : 0.5,
            cursor: canConfirm ? 'pointer' : 'default',
          }}
          onClick={props.onConfirm}
          disabled={!canConfirm}
        >
          {props.busy ? '…' : props.confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
