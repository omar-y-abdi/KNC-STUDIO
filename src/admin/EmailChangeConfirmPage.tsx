import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { isBackendConfigured } from '../backend/config'
import { palette } from '../booking/bookingStyles'
import { adminText } from '../i18n/adminStrings'
import { AuthCard } from './AuthCard'
import { buildAdminStyles } from './adminStyles'
import { confirmOwnEmailChange } from './auth'
import { LangSwitch } from './chrome'
import { parseEmailChangeToken } from './emailChangeLink'
import { useTheme } from './useTheme'

export interface EmailChangeConfirmPageProps {
  readonly onDone: () => void
  readonly onInvalid: () => void
}

type Phase = 'ready' | 'submitting' | 'done' | 'invalid'

export function EmailChangeConfirmPage(props: EmailChangeConfirmPageProps): JSX.Element {
  const { dark, lang, setLang } = useTheme()
  const c = palette(dark)
  const s = buildAdminStyles(c, dark)
  const t = adminText(lang)
  const [tokenHash] = useState(() => parseEmailChangeToken(window.location.search))
  const [phase, setPhase] = useState<Phase>(tokenHash === null ? 'invalid' : 'ready')

  const confirm = async (): Promise<void> => {
    if (phase !== 'ready' || tokenHash === null || !isBackendConfigured()) {
      setPhase('invalid')
      return
    }
    setPhase('submitting')
    const result = await confirmOwnEmailChange(tokenHash)
    setPhase(result.ok ? 'done' : 'invalid')
  }

  const overlay = (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        right: '16px',
        zIndex: 10,
      }}
    >
      <LangSwitch lang={lang} setLang={setLang} dark={dark} />
    </div>
  )

  return (
    <>
      {overlay}
      <AuthCard subtitle={t.emailChangeConfirmSubtitle}>
        {phase === 'done' ? (
          <>
            <p
              role="status"
              style={{ ...s.successText, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5 }}
            >
              {t.emailChangeConfirmSuccess}
            </p>
            <button type="button" style={{ ...s.primaryBtn, width: '100%' }} onClick={props.onDone}>
              {t.emailChangeConfirmToAdmin}
            </button>
          </>
        ) : phase === 'invalid' ? (
          <>
            <p
              role="alert"
              style={{ ...s.errorText, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5 }}
            >
              {t.emailChangeConfirmInvalid}
            </p>
            <button
              type="button"
              style={{ ...s.primaryBtn, width: '100%' }}
              onClick={props.onInvalid}
            >
              {t.authToSignIn}
            </button>
          </>
        ) : (
          <>
            <p style={{ ...s.mutedText, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5 }}>
              {t.emailChangeConfirmIntro}
            </p>
            <button
              type="button"
              disabled={phase === 'submitting'}
              style={{
                ...s.primaryBtn,
                width: '100%',
                opacity: phase === 'submitting' ? 0.6 : 1,
                cursor: phase === 'submitting' ? 'default' : 'pointer',
              }}
              onClick={() => void confirm()}
            >
              {phase === 'submitting' ? t.emailChangeConfirming : t.emailChangeConfirmSubmit}
            </button>
          </>
        )}
      </AuthCard>
    </>
  )
}
