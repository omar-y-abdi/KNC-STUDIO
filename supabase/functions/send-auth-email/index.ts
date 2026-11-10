// Supabase Auth's Send Email hook: Auth calls this function instead of sending its own email. It
// carries no JWT and no browser calls it; the Standard Webhooks signature is the credential.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Webhook } from 'standardwebhooks'
import { retainTaskUntilSettled } from '../_shared/backgroundTask.ts'
import {
  loadEmailBusiness,
  loadEmailTemplate,
  prepareEmail,
  sendViaResend,
  type EmailLanguage,
} from '../_shared/email.ts'
import { sha256Hex } from '../_shared/encoding.ts'
import { json, parse } from '../_shared/http.ts'
import { requestSchema, type HookPayload } from './request.ts'

const SITE = 'https://bladeblendstudio.se'

/**
 * Auth gives a hook five seconds in total and discards the token it issued when no answer came.
 * The handler answers by this deadline whatever is still in flight.
 */
const ANSWER_DEADLINE_MS = 3_500

const REFUSAL_STATUS = {
  forbidden: 403,
  rate_limited: 429,
  send_failed: 502,
  timeout: 504,
} as const
type Refusal = keyof typeof REFUSAL_STATUS

/** Auth reports every non-2xx answer to its own caller as a server error and sends nothing. */
function refuse(status: number, message: string): Response {
  return json({ error: { http_code: status, message } }, status)
}

/** The app names the reader's language as `?lang=` on the redirect it asks Auth for. */
function languageOf(redirectTo: string): EmailLanguage {
  try {
    return new URL(redirectTo).searchParams.get('lang') === 'en' ? 'en' : 'sv'
  } catch {
    return 'sv'
  }
}

async function withinLimit(
  service: SupabaseClient,
  kind: 'recovery' | 'email_change',
  scope: string,
): Promise<boolean> {
  const limited = await service.rpc('consume_auth_email_send', {
    p_kind: kind,
    p_scope_hash: await sha256Hex(scope),
  })
  return limited.error === null && limited.data === true
}

async function sendRecovery(
  service: SupabaseClient,
  resendKey: string,
  { user, email_data: data }: HookPayload,
): Promise<Refusal | null> {
  if (!(await withinLimit(service, 'recovery', `recovery:${user.email}`))) return 'rate_limited'
  const lang = languageOf(data.redirect_to)
  const copy = await loadEmailTemplate(service, 'auth_recovery', lang)
  const business = await loadEmailBusiness(service)
  const link = `${SITE}/reset?token_hash=${encodeURIComponent(data.token_hash)}&type=recovery`
  const message = prepareEmail(
    'auth_recovery',
    { to: user.email, lang, copy, ctaHref: link, business },
    null,
  )
  await sendViaResend(message, resendKey, `auth-recovery/${data.token_hash.slice(0, 48)}`, service)
  return null
}

/** With secure email change off, `token_hash` is the one hash and confirms the new address. */
async function sendEmailChange(
  service: SupabaseClient,
  resendKey: string,
  { user, email_data: data }: HookPayload,
  newEmail: string,
  answered: () => boolean,
): Promise<Refusal | null> {
  const profile = await service
    .from('profiles')
    .select('account_enabled')
    .eq('id', user.id)
    .single()
  if (profile.error !== null || profile.data?.account_enabled !== true) return 'forbidden'
  if (!(await withinLimit(service, 'email_change', `email-change:${user.id}`))) {
    return 'rate_limited'
  }
  const lang = languageOf(data.redirect_to)
  const copy = await loadEmailTemplate(service, 'auth_email_change', lang)
  const business = await loadEmailBusiness(service)
  const link = `${SITE}/auth/confirm?token_hash=${encodeURIComponent(data.token_hash)}&type=email_change`
  const message = prepareEmail(
    'auth_email_change',
    { to: newEmail, lang, copy, variables: { new_email: newEmail }, ctaHref: link, business },
    null,
  )
  // Auth was already told this send failed and has dropped the token the link carries.
  if (answered()) return 'timeout'
  await sendViaResend(
    message,
    resendKey,
    `auth-email-change/${data.token_hash.slice(0, 48)}`,
    service,
  )
  return null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return refuse(405, 'method_not_allowed')
  const secret = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  if (!secret) return refuse(503, 'not_configured')
  const body = await req.text()
  let raw: unknown
  try {
    // Auth's secret reads `v1,whsec_<base64>`; the library takes it from `whsec_` on.
    raw = new Webhook(secret.replace(/^v1,/, '')).verify(body, Object.fromEntries(req.headers))
  } catch {
    return refuse(401, 'invalid_signature')
  }
  const parsed = parse(requestSchema, raw)
  if (!parsed.ok) return refuse(400, 'invalid_payload')
  const type = parsed.data.email_data.email_action_type
  const newEmail = parsed.data.user.new_email
  if (type !== 'recovery' && (type !== 'email_change' || !newEmail)) {
    console.error('send-auth-email: unsupported email', type)
    return refuse(422, 'unsupported_email')
  }

  let answered = false
  const deliver = async (): Promise<Refusal | null> => {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!url || !key || !resendKey) throw new Error('not configured')
    const service = createClient(url, key, { auth: { persistSession: false } })
    return type === 'email_change' && newEmail
      ? sendEmailChange(service, resendKey, parsed.data, newEmail, () => answered)
      : sendRecovery(service, resendKey, parsed.data)
  }
  const sending = retainTaskUntilSettled(deliver()).catch((error: unknown): Refusal => {
    console.error('send-auth-email:', error instanceof Error ? error.message : 'unknown error')
    return 'send_failed'
  })
  let deadline: ReturnType<typeof setTimeout> | undefined
  const refusal = await Promise.race([
    sending,
    new Promise<Refusal>((resolve) => {
      deadline = setTimeout(() => resolve('timeout'), ANSWER_DEADLINE_MS)
    }),
  ])
  clearTimeout(deadline)
  answered = true
  if (refusal === null) return json({})
  console.error('send-auth-email: not sent', type, refusal)
  // Auth calls the hook only for an existing account, so an error here would confirm the address.
  return type === 'recovery' ? json({}) : refuse(REFUSAL_STATUS[refusal], refusal)
})
