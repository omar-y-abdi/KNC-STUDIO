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

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown'
}

async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  if (token === '') return false
  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token)
    if (ip && ip !== 'unknown') form.set('remoteip', ip)
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
    const data = (await response.json()) as { success?: boolean }
    return data.success === true
  } catch (error) {
    console.error(
      'send-recovery-email: Turnstile verify error:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return false
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  if (typeof raw !== 'object' || raw === null)
    return json({ ok: false, error: 'invalid_payload' }, 400)
  const body = raw as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const lang = body.lang === 'en' ? 'en' : 'sv'
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ ok: true })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET')
  if (!url || !key || !resendKey || !turnstileSecret)
    return json({ ok: false, error: 'not_configured' }, 503)
  if (!(await verifyTurnstile(turnstileToken, clientIp(req), turnstileSecret))) {
    return json({ ok: true })
  }
  const service = createClient(url, key, { auth: { persistSession: false } })
  const scope = await sha256(`recovery:${email}`)
  const limited = await service.rpc('consume_auth_email_send', {
    p_kind: 'recovery',
    p_scope_hash: scope,
  })
  if (limited.error || limited.data !== true) return json({ ok: true })
  const generated = await service.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'https://bladeblendstudio.se/reset' },
  })
  if (generated.error) return json({ ok: true })
  try {
    const copy = await loadEmailTemplate(service, 'auth_recovery', lang)
    const business = await loadEmailBusiness(service)
    const link = `https://bladeblendstudio.se/reset?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=recovery`
    const message = buildEmailMessage({ to: email, lang, copy, ctaHref: link, business })
    await sendViaResend(
      message,
      resendKey,
      `auth-recovery/${generated.data.properties.hashed_token.slice(0, 48)}`,
    )
  } catch (error) {
    console.error('send-recovery-email:', error instanceof Error ? error.message : 'unknown error')
  }
  return json({ ok: true })
})
