import { createClient } from '@supabase/supabase-js'
import {
  loadEmailBusiness,
  loadEmailTemplate,
  prepareEmail,
  sendViaResend,
} from '../_shared/email.ts'
import { sha256Hex } from '../_shared/encoding.ts'
import { json, parse } from '../_shared/http.ts'
import { staffCors } from '../_shared/staffCors.ts'
import { requestSchema } from './request.ts'

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!url || !key || !anonKey || !resendKey)
    return json({ ok: false, error: 'not_configured' }, 503)
  const service = createClient(url, key, { auth: { persistSession: false } })
  const header = req.headers.get('authorization') ?? ''
  const jwt = header.startsWith('Bearer ') ? header.slice(7) : ''
  const caller = jwt ? await service.auth.getUser(jwt) : null
  if (caller === null || caller.error || caller.data.user === null || !caller.data.user.email) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  const profile = await service
    .from('profiles')
    .select('account_enabled')
    .eq('id', caller.data.user.id)
    .single()
  if (profile.error !== null || profile.data?.account_enabled !== true) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  const parsed = parse(requestSchema, raw)
  if (!parsed.ok) return json({ ok: false, error: 'invalid_payload' }, 400)
  const { new_email: newEmail, current_password: currentPassword, lang } = parsed.data
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
    return json({ ok: false, error: 'invalid_email' }, 400)
  }
  if (newEmail === caller.data.user.email.toLowerCase())
    return json({ ok: false, error: 'same_email' }, 400)
  // The limiter is consumed before the password is checked: one guess a minute for each account.
  const scope = await sha256Hex(`email-change:${caller.data.user.id}`)
  const limited = await service.rpc('consume_auth_email_send', {
    p_kind: 'email_change',
    p_scope_hash: scope,
  })
  if (limited.error || limited.data !== true) return json({ ok: false, error: 'rate_limited' }, 429)
  // The current password is proven by a sign-in whose session is revoked at once and never leaves
  // this function. Auth's own PUT /auth/v1/user is closed by the linkless email-change template.
  const reauth = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const verified = await reauth.auth.signInWithPassword({
    email: caller.data.user.email,
    password: currentPassword,
  })
  if (verified.error !== null) {
    // An expected outcome answers 200 so the panel reads the reason. Only refused credentials mean a
    // wrong password; a banned or unconfirmed account or a CAPTCHA demand is another failure.
    if (verified.error.code === 'invalid_credentials')
      return json({ ok: false, error: 'wrong_password' })
    console.error(
      'send-email-change reauth:',
      verified.error.status ?? 'unknown',
      verified.error.code ?? 'unknown',
    )
    return json({ ok: false, error: 'reauth_unavailable' }, 503)
  }
  // `auth.signOut` reports a refused revocation (401, 403, 404) as success; the admin call returns it.
  const revoked = await reauth.auth.admin.signOut(verified.data.session.access_token, 'local')
  if (revoked.error !== null || verified.data.user.id !== caller.data.user.id) {
    console.error('send-email-change reauth: temporary session not settled')
    return json({ ok: false, error: 'reauth_unavailable' }, 503)
  }
  const generated = await service.auth.admin.generateLink({
    type: 'email_change_new',
    email: caller.data.user.email,
    newEmail,
    options: { redirectTo: 'https://bladeblendstudio.se/auth/confirm' },
  })
  if (generated.error) {
    console.error('send-email-change generateLink:', generated.error.message)
    return json({ ok: false, error: 'generate_failed' }, 500)
  }
  try {
    const copy = await loadEmailTemplate(service, 'auth_email_change', lang)
    const business = await loadEmailBusiness(service)
    const link = `https://bladeblendstudio.se/auth/confirm?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=email_change`
    const message = prepareEmail(
      'auth_email_change',
      { to: newEmail, lang, copy, variables: { new_email: newEmail }, ctaHref: link, business },
      null,
    )
    await sendViaResend(
      message,
      resendKey,
      `auth-email-change/${generated.data.properties.hashed_token.slice(0, 48)}`,
      service,
    )
    return json({ ok: true })
  } catch (error) {
    console.error('send-email-change:', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, error: 'send_failed' }, 502)
  }
}

Deno.serve(staffCors(Deno.env.get('CMS_ALLOWED_ORIGINS'), handle))
