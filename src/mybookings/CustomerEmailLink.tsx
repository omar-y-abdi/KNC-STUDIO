import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { buildBookingStyles, palette } from '../booking/bookingStyles'
import { parseEmail } from '../booking/validation'
import { customerEmailLinkStrings } from '../i18n/customerEmailLinkStrings'
import type { Lang } from '../i18n/index'
import { FOCUS_CLS } from '../ui/pseudo'
import type { CustomerEmailLinkResult, CustomerProfile } from './domain'
import type { MyBookingsPort } from './port'

type LinkStatus = Extract<CustomerEmailLinkResult, { readonly ok: true }>['status']
type LinkError = Extract<CustomerEmailLinkResult, { readonly ok: false }>['error'] | 'email'

interface LinkState {
  readonly expanded: boolean
  readonly email: string
  readonly busy: boolean
  readonly status: LinkStatus | null
  readonly error: LinkError | null
}

export interface CustomerEmailLinkProps {
  readonly lang: Lang
  readonly dark: boolean
  readonly port: MyBookingsPort
  /** Only a profile returned with verified authority; device and unverified access pass null. */
  readonly profile: CustomerProfile | null
  /** Undefined opens management; null is a malformed proof; a string still requires a button click. */
  readonly code?: string | null
  readonly onLinked: () => void
}

export function CustomerEmailLink(props: CustomerEmailLinkProps): JSX.Element | null {
  const t = customerEmailLinkStrings(props.lang)
  const c = palette(props.dark)
  const s = buildBookingStyles(c, props.dark, false)
  const email = props.profile?.email ?? ''
  const verified = parseEmail(email).ok
  const current = useRef({
    port: props.port,
    email,
    code: props.code,
    active: true,
    sequence: 0,
    busy: false,
  })
  if (
    current.current.port !== props.port ||
    current.current.email !== email ||
    current.current.code !== props.code
  ) {
    current.current = {
      port: props.port,
      email,
      code: props.code,
      active: true,
      sequence: 0,
      busy: false,
    }
  }
  const owner = current.current
  const initial: LinkState = {
    expanded: false,
    email: '',
    busy: false,
    status: null,
    error: null,
  }
  const [snapshot, setSnapshot] = useState({ owner, value: initial })
  const state = snapshot.owner === owner ? snapshot.value : initial
  const isCurrent = (): boolean => current.current === owner && owner.active
  const update = (change: Partial<LinkState>): void => {
    if (!isCurrent()) return
    setSnapshot((previous) =>
      isCurrent()
        ? { owner, value: { ...(previous.owner === owner ? previous.value : initial), ...change } }
        : previous,
    )
  }
  useEffect(() => {
    owner.active = true
    return () => {
      owner.active = false
      owner.sequence++
    }
  }, [owner])

  const run = async (operation: () => Promise<CustomerEmailLinkResult>): Promise<void> => {
    if (!verified || !isCurrent() || owner.busy) return
    owner.busy = true
    const sequence = ++owner.sequence
    update({ busy: true, error: null, status: null })
    try {
      const result = await operation()
      if (!isCurrent() || owner.sequence !== sequence) return
      if (!result.ok) {
        update({ error: result.error })
        return
      }
      update({ status: result.status })
      if (result.status === 'linked' || result.status === 'already_linked') props.onLinked()
    } catch {
      if (isCurrent() && owner.sequence === sequence) update({ error: 'system' })
    } finally {
      if (isCurrent() && owner.sequence === sequence) {
        owner.busy = false
        update({ busy: false })
      }
    }
  }

  const request = (event: JSX.TargetedSubmitEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (owner.busy || state.status !== null) return
    const parsed = parseEmail(state.email)
    if (!parsed.ok) {
      update({ error: 'email' })
      return
    }
    void run(() => owner.port.requestEmailLink(parsed.value, props.lang, owner.email))
  }
  const confirm = (): void => {
    const code = owner.code
    if (typeof code === 'string') void run(() => owner.port.confirmEmailLink(code))
  }

  if (props.code === undefined && !verified) return null
  const messages = {
    queued: t.queued,
    already_linked: t.alreadyLinked,
    waiting: t.waiting,
    linked: t.linked,
  }
  const errors: Readonly<Record<LinkError, string>> = {
    access_denied: t.accessDenied,
    invalid: t.invalid,
    stale: t.invalid,
    rate_limited: t.rateLimited,
    system: t.system,
    email: t.invalidEmail,
  }
  const noteStyle: JSX.CSSProperties = {
    margin: 0,
    fontSize: '13px',
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
  }
  const actionStyle: JSX.CSSProperties = {
    ...s.bookBtnStyle,
    marginTop: '4px',
    opacity: state.busy ? 0.6 : 1,
    cursor: state.busy ? 'default' : 'pointer',
  }
  const result = (
    <>
      {state.status !== null ? (
        <p role="status" style={noteStyle}>
          {messages[state.status]}
        </p>
      ) : null}
      {state.error !== null ? (
        <p role="alert" style={{ ...s.submitErrorStyle, margin: 0 }}>
          {errors[state.error]}
        </p>
      ) : null}
    </>
  )

  if (props.code !== undefined) {
    return (
      <section
        aria-label={t.confirmTitle}
        style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;"
      >
        <h3 style="margin:0;font-size:15px;">{t.confirmTitle}</h3>
        {props.code === null ? (
          <p role="alert" style={noteStyle}>
            {t.invalid}
          </p>
        ) : !verified ? (
          <p role="status" style={noteStyle}>
            {t.accessDenied}
          </p>
        ) : (
          <>
            <p style={noteStyle}>{t.explanation}</p>
            <p style={noteStyle}>
              {t.session} <strong>{email}</strong>
            </p>
            {state.status === null &&
            state.error !== 'access_denied' &&
            state.error !== 'invalid' &&
            state.error !== 'stale' ? (
              <button
                type="button"
                class={FOCUS_CLS}
                style={actionStyle}
                disabled={state.busy}
                onClick={confirm}
              >
                {state.busy ? t.busy : t.confirm}
              </button>
            ) : null}
            {result}
          </>
        )}
      </section>
    )
  }

  const aliases = [
    ...new Set([email, ...(props.profile?.emails ?? [])].filter((value) => value.trim() !== '')),
  ]
  return (
    <section style={{ borderTop: '.5px solid ' + c.line, paddingTop: '12px' }}>
      <button
        type="button"
        class={FOCUS_CLS}
        aria-expanded={state.expanded}
        onClick={() => update({ expanded: !state.expanded })}
        style={{
          border: 'none',
          background: 'transparent',
          color: c.text,
          font: 'inherit',
          fontSize: '13px',
          padding: '4px 0',
          textDecoration: 'underline',
          textUnderlineOffset: '3px',
          cursor: 'pointer',
        }}
      >
        {t.manage}
      </button>
      {state.expanded ? (
        <form
          onSubmit={request}
          noValidate
          style="display:flex;flex-direction:column;gap:12px;margin-top:10px;"
        >
          <p style={noteStyle}>{t.addresses}</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;overflow-wrap:anywhere;">
            {aliases.map((address) => (
              <li key={address}>{address}</li>
            ))}
          </ul>
          <p style={noteStyle}>{t.explanation}</p>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;">
            {t.email}
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              class={FOCUS_CLS}
              value={state.email}
              disabled={state.busy}
              onInput={(event) => {
                if (!owner.busy)
                  update({ email: event.currentTarget.value, error: null, status: null })
              }}
              aria-invalid={state.error === 'email' ? true : undefined}
              style={state.error === 'email' ? s.inputErrorStyle : s.inputStyle}
            />
          </label>
          {state.status === null ? (
            <button
              type="submit"
              class={FOCUS_CLS}
              style={actionStyle}
              disabled={state.busy || state.email.trim() === ''}
            >
              {state.busy ? t.busy : t.request}
            </button>
          ) : null}
          {result}
        </form>
      ) : null}
    </section>
  )
}
