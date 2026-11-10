import { createClient } from '@supabase/supabase-js'
import { verifyTurnstile, turnstilePolicy } from '../_shared/turnstile.ts'
import { corsHeaders, corsJson as json, parse } from '../_shared/http.ts'
import { requestSchema } from './request.ts'

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown'
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
  const parsed = parse(requestSchema, raw)
  if (!parsed.ok) return json({ ok: false, error: 'invalid_payload' }, 400)
  const { email, lang, turnstileToken } = parsed.data
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ ok: true })
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET')
  if (!turnstileSecret) return json({ ok: false, error: 'not_configured' }, 503)
  if (
    !(await verifyTurnstile(
      turnstileToken,
      clientIp(req),
      turnstileSecret,
      turnstilePolicy('password_recovery', Deno.env.get('PUBLIC_SITE_ORIGINS')),
    ))
  ) {
    return json({ ok: false, error: 'failed_challenge' })
  }
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ ok: false, error: 'not_configured' }, 503)
  const service = createClient(url, key, { auth: { persistSession: false } })
  try {
    // Auth emails only an existing account, so its answer can differ between a known and an
    // unknown address. It never reaches the caller.
    const requested = await service.auth.resetPasswordForEmail(email, {
      redirectTo: `https://bladeblendstudio.se/reset?lang=${lang}`,
    })
    if (requested.error) console.error('send-recovery-email:', requested.error.message)
  } catch (error) {
    console.error('send-recovery-email:', error instanceof Error ? error.message : 'unknown error')
  }
  return json({ ok: true })
})
