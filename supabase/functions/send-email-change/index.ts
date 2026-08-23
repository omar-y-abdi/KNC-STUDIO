import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import {
  buildEmailMessage,
  loadEmailBusiness,
  loadEmailTemplate,
  sendViaResend,
} from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!url || !key || !resendKey) return json({ ok: false, error: 'not_configured' }, 503)
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
  if (typeof raw !== 'object' || raw === null)
    return json({ ok: false, error: 'invalid_payload' }, 400)
  const body = raw as Record<string, unknown>
  const newEmail = typeof body.new_email === 'string' ? body.new_email.trim().toLowerCase() : ''
  const lang = body.lang === 'en' ? 'en' : 'sv'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
    return json({ ok: false, error: 'invalid_email' }, 400)
  }
  if (newEmail === caller.data.user.email.toLowerCase())
    return json({ ok: false, error: 'same_email' }, 400)
  const scope = await sha256(`email-change:${caller.data.user.id}`)
  const limited = await service.rpc('consume_auth_email_send', {
    p_kind: 'email_change',
    p_scope_hash: scope,
  })
  if (limited.error || limited.data !== true) return json({ ok: false, error: 'rate_limited' }, 429)
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
    const message = buildEmailMessage({
      to: newEmail,
      lang,
      copy,
      variables: { new_email: newEmail },
      ctaHref: link,
      business,
    })
    await sendViaResend(
      message,
      resendKey,
      `auth-email-change/${generated.data.properties.hashed_token.slice(0, 48)}`,
    )
    return json({ ok: true })
  } catch (error) {
    console.error('send-email-change:', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, error: 'send_failed' }, 502)
  }
})
