// One shared script; independent, disposable widgets. Retries recover from script/network failure
// as well as expired tokens. Action + hostname are checked again by the Edge gateway.
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import type { TurnstilePolicy } from '../../supabase/functions/_shared/turnstile'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || undefined
export const turnstileConfigured = SITE_KEY !== undefined

interface TurnstileRenderOptions {
  readonly sitekey: string
  readonly action: TurnstilePolicy['action']
  readonly language: Lang
  readonly callback: (token: string) => void
  readonly 'expired-callback': () => void
  readonly 'error-callback': () => void
  readonly 'timeout-callback': () => void
}
interface TurnstileApi {
  readonly render: (el: HTMLElement, opts: TurnstileRenderOptions) => string
  readonly remove: (widgetId: string) => void
}
declare global {
  interface Window {
    readonly turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile !== undefined) return Promise.resolve()
  if (scriptPromise !== null) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')
    const cleanup = (): void => {
      clearTimeout(timer)
      script.removeEventListener('load', loaded)
      script.removeEventListener('error', failed)
    }
    const failed = (): void => {
      cleanup()
      script.remove()
      reject(new Error('Turnstile script unavailable'))
    }
    const loaded = (): void => {
      if (window.turnstile === undefined) {
        failed()
        return
      }
      cleanup()
      resolve()
    }
    const timer = setTimeout(failed, 12_000)
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', failed, { once: true })
    if (existing === null) {
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  }).catch((error: unknown) => {
    scriptPromise = null
    throw error
  })
  return scriptPromise
}

export interface TurnstileProps {
  readonly action: TurnstilePolicy['action']
  readonly lang: Lang
  readonly onToken: (token: string) => void
  /** A parent with its own recovery UI can keep handling widget errors. */
  readonly onError?: () => void
  readonly resetNonce: number
}

export function Turnstile(props: TurnstileProps): JSX.Element | null {
  const { action, lang, resetNonce } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(props.onToken)
  const onErrorRef = useRef(props.onError)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    onTokenRef.current = props.onToken
  }, [props.onToken])
  useEffect(() => {
    onErrorRef.current = props.onError
  }, [props.onError])

  useEffect(() => {
    onTokenRef.current('')
    setFailed(false)
    if (SITE_KEY === undefined) return
    let cancelled = false
    let widget: string | undefined
    const notifyError = (): void => {
      if (cancelled) return
      setFailed(true)
      onTokenRef.current('')
      onErrorRef.current?.()
    }
    void loadTurnstileScript()
      .then(() => {
        if (cancelled) return
        const api = window.turnstile
        const container = containerRef.current
        if (!api || !container) {
          notifyError()
          return
        }
        widget = api.render(container, {
          sitekey: SITE_KEY,
          action,
          language: lang,
          callback: (token) => {
            if (cancelled) return
            setFailed(false)
            onTokenRef.current(token)
          },
          'expired-callback': notifyError,
          'error-callback': notifyError,
          'timeout-callback': notifyError,
        })
      })
      .catch(notifyError)
    return () => {
      cancelled = true
      if (widget !== undefined) window.turnstile?.remove(widget)
    }
  }, [action, lang, resetNonce, retry])

  if (SITE_KEY === undefined) return null
  return (
    <div style={{ marginTop: '4px' }}>
      <div ref={containerRef} />
      {failed && props.onError === undefined ? (
        <div role="alert" style={{ fontSize: '12px', lineHeight: 1.5, margin: '8px 0' }}>
          <span>
            {lang === 'sv'
              ? 'Verifieringen kunde inte slutföras.'
              : 'Verification could not be completed.'}
          </span>{' '}
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            style={{
              padding: '4px 0',
              color: 'inherit',
              background: 'transparent',
              border: 0,
              font: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {lang === 'sv' ? 'Försök igen' : 'Try again'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
