export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/** Verify one single-use Turnstile token server-side; any transport/upstream failure fails closed. */
export async function verifyTurnstile(
  token: string,
  ip: string,
  secret: string,
  fetcher: TurnstileFetch = globalThis.fetch,
): Promise<boolean> {
  if (token === '') return false
  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token)
    if (ip !== 'unknown') form.set('remoteip', ip)
    const response = await fetcher(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
    if (!response.ok) return false
    const data = (await response.json()) as { readonly success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}
