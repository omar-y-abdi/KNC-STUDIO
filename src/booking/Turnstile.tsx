// Cloudflare Turnstile widget (PLAN §3). Renders the managed challenge in the booking details
// dialog and hands the resulting token up via `onToken`. The booking gateway (`submit-booking`)
// verifies that token server-side.
//
// With `VITE_TURNSTILE_SITE_KEY` unset, this renders nothing and emits an empty token. That supports
// the mock adapter locally; the production gateway rejects empty tokens and missing server config.
// A token is single-use and expires (~300s), so the flow bumps `resetNonce` after every submit attempt
// to force a fresh challenge; the widget's `expired-callback` clears a stale held token meanwhile.
//
// Effects (DOM script injection, the global `window.turnstile` API, widget lifecycle) are isolated
// here at the edge; the component's contract is purely `(onToken, resetNonce) -> token`.

import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** The public site key, or `undefined` when unset/blank (-> render nothing, emit an empty token). */
function readSiteKey(): string | undefined {
  const raw = import.meta.env.VITE_TURNSTILE_SITE_KEY
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

const SITE_KEY = readSiteKey()

/** Whether a Turnstile site key is configured — the widget renders a challenge. When false the
 * widget renders nothing; callers should pass `null` so no empty wrapper lands in the DOM (keeping
 * the offline site byte-identical). */
export const turnstileConfigured = SITE_KEY !== undefined

// --- Cloudflare Turnstile JS API (typed; the script attaches `window.turnstile`) ----------------

interface TurnstileRenderOptions {
  readonly sitekey: string
  readonly callback: (token: string) => void
  readonly 'expired-callback': () => void
  readonly 'error-callback': () => void
  readonly 'timeout-callback': () => void
}

interface TurnstileApi {
  readonly render: (el: HTMLElement, opts: TurnstileRenderOptions) => string
  readonly reset: (widgetId?: string) => void
  readonly remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    readonly turnstile?: TurnstileApi
  }
}

// --- one-shot script loader (module-level promise; loaded only when a site key is set) -----------

let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (scriptPromise !== null) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing !== null) {
      if (window.turnstile !== undefined) {
        resolve()
      } else {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('turnstile script failed')), {
          once: true,
        })
      }
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('turnstile script failed')), {
      once: true,
    })
    document.head.appendChild(script)
  })
  return scriptPromise
}

export interface TurnstileProps {
  /** Called with a fresh token on success, and with `''` on expiry / error / unset key. */
  readonly onToken: (token: string) => void
  /** Called when the managed challenge needs user-visible recovery (error, timeout, or expiry). */
  readonly onError?: () => void
  /** Bump (increment) to force a fresh challenge — a token is single-use and ~5-min-expiring. */
  readonly resetNonce: number
}

/**
 * The Turnstile widget. Renders the managed challenge (invisible for most real users) and reports
 * its token. Renders `null` when no site key is configured.
 */
export function Turnstile(props: TurnstileProps): JSX.Element | null {
  const { onToken, onError, resetNonce } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  // Keep the latest callback in a ref so the mount/reset effects never re-run when the parent
  // re-renders with a new closure (the widget is rendered ONCE; only `resetNonce` re-executes it).
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const notifyError = (): void => {
    onTokenRef.current('')
    onErrorRef.current?.()
  }

  // Mount: load the script and render the widget once. Unset key emits an empty token; mock mode
  // remains usable. Script/widget failures notify an interested caller so it can offer recovery.
  useEffect(() => {
    if (SITE_KEY === undefined) {
      onTokenRef.current('')
      return
    }
    let cancelled = false
    void loadTurnstileScript()
      .then(() => {
        if (cancelled) return
        const api = window.turnstile
        const el = containerRef.current
        if (api === undefined || el === null) {
          notifyError()
          return
        }
        widgetIdRef.current = api.render(el, {
          sitekey: SITE_KEY,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': notifyError,
          'error-callback': notifyError,
          'timeout-callback': notifyError,
        })
      })
      .catch(() => {
        if (!cancelled) notifyError()
      })
    return () => {
      cancelled = true
      const api = window.turnstile
      if (api !== undefined && widgetIdRef.current !== null) api.remove(widgetIdRef.current)
      widgetIdRef.current = null
    }
  }, [])

  // Reset on every nonce bump (after a submit attempt) so the next submit gets a FRESH, unspent token.
  // The initial render (nonce's first value) is handled by the mount effect, so skip the first run.
  const firstNonceRef = useRef(true)
  useEffect(() => {
    if (firstNonceRef.current) {
      firstNonceRef.current = false
      return
    }
    if (SITE_KEY === undefined) {
      onTokenRef.current('')
      return
    }
    const api = window.turnstile
    if (api !== undefined && widgetIdRef.current !== null) api.reset(widgetIdRef.current)
  }, [resetNonce])

  if (SITE_KEY === undefined) return null
  return <div ref={containerRef} style={{ marginTop: '4px' }} />
}
