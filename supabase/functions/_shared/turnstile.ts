export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface TurnstilePolicy {
  readonly action: 'booking' | 'customer_access' | 'review' | 'password_recovery'
  readonly hostnames: readonly string[]
}

/** Hostnames come from deployment configuration, never the caller's Origin/header/body. */
export function turnstilePolicy(
  action: TurnstilePolicy['action'],
  origins?: string,
): TurnstilePolicy {
  const values = origins?.split(',') ?? [
    'https://bladeblendstudio.se',
    'https://www.bladeblendstudio.se',
  ]
  const hostnames = values.flatMap((value) => {
    try {
      const url = new URL(value.trim())
      return ['http:', 'https:'].includes(url.protocol) ? [url.hostname] : []
    } catch {
      return []
    }
  })
  return { action, hostnames: [...new Set(hostnames)] }
}

/** Verify one single-use Turnstile token server-side; any transport/upstream failure fails closed. */
export async function verifyTurnstile(
  token: string,
  ip: string,
  secret: string,
  policy: TurnstilePolicy,
  fetcher: TurnstileFetch = globalThis.fetch,
): Promise<boolean> {
  if (
    token.length === 0 ||
    token.length > 2048 ||
    secret.length === 0 ||
    policy.hostnames.length === 0
  )
    return false
  const testSecret = secret === '1x0000000000000000000000000000000AA'
  // Cloudflare's official test response has example.com and no action. Permit it only when
  // every configured host is loopback; a test secret must fail closed on a deployed website.
  const localTest =
    testSecret &&
    policy.hostnames.every((host) => ['127.0.0.1', 'localhost', '[::1]'].includes(host))
  if (testSecret && !localTest) return false
  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token)
    if (ip !== 'unknown') form.set('remoteip', ip)
    const response = await fetcher(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return false
    const data = (await response.json()) as {
      readonly success?: boolean
      readonly hostname?: string
      readonly action?: string
      readonly metadata?: { readonly result_with_testing_key?: boolean }
    }
    return (
      data.success === true &&
      (localTest
        ? data.metadata?.result_with_testing_key === true
        : policy.hostnames.includes(data.hostname ?? '') && data.action === policy.action)
    )
  } catch {
    return false
  }
}
