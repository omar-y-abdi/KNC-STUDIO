import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildEmailMessage, loadEmailTemplate, sendViaResend } from '../_shared/email.ts'

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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ ok: true })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!url || !key || !resendKey) return json({ ok: false, error: 'not_configured' }, 503)
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
    const link = `https://bladeblendstudio.se/reset?token_hash=${encodeURIComponent(generated.data.properties.hashed_token)}&type=recovery`
    const message = buildEmailMessage({ to: email, lang, copy, ctaHref: link })
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
