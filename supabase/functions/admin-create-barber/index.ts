// admin-create-barber — Supabase Edge Function (Deno) — OWNER-ONLY account provisioning.
//
// Purpose: the owner provisions a Supabase auth login for an existing barber. They POST
//   { email, barber_id, lang }; this function:
//   1. validates that the caller holds an owner JWT (fail-closed),
//   2. validates the body (email shape + barber_id exists in public.barbers),
//   3. generates a single-use Supabase invite link via service-role,
//   4. links the invited user to the barber profile,
//   5. sends the branded, owner-editable invitation through Resend, and
//   6. returns { ok:true } (no credentials or invite token in the response).
//
// AUTH GATE (fail-closed): the caller's JWT is validated via auth.getUser() — never decoded-
// and-trusted — then profiles.role is checked against the DB. Any doubt → reject. The caller's
// identity comes entirely from the verified JWT, never the request body.
//
// SECURITY BOUNDARY: the service role key stays server-side in this function only. No credentials,
// PII, or auth tokens appear in any response. verify_jwt = true (config.toml) means Supabase also
// validates the JWT at the gateway before this function runs.
//
// CORS: the admin panel is served from Cloudflare (different origin); CORS headers + OPTIONS preflight
// handling are required for browser-originated requests.
//
// Invocation: admin panel -> supabase.functions.invoke('admin-create-barber', { body, headers })
// Run locally: npx supabase functions serve admin-create-barber --env-file supabase/functions/.env

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildEmailMessage, loadEmailTemplate, sendViaResend } from '../_shared/email.ts'

// --- CORS -------------------------------------------------------------------------------------
// The admin panel (Cloudflare) and this function (Supabase) are different origins. The Authorization
// header must be listed explicitly so browsers permit it in the preflight response.
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Types ------------------------------------------------------------------------------------

interface CreateBarberBody {
  readonly email: string
  readonly barber_id: string
  readonly lang: 'sv' | 'en'
}

type ParseResult =
  | { readonly ok: true; readonly body: CreateBarberBody }
  | { readonly ok: false; readonly error: string }

// --- Validation (boundary; never trust the request body) -------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254
}

function parseBody(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const r = raw as Record<string, unknown>
  if (!isNonEmptyString(r.email)) return { ok: false, error: 'email is required' }
  if (!looksLikeEmail(r.email)) return { ok: false, error: 'email is invalid' }
  if (!isNonEmptyString(r.barber_id)) return { ok: false, error: 'barber_id is required' }
  return {
    ok: true,
    body: {
      email: r.email.trim().toLowerCase(),
      barber_id: r.barber_id,
      lang: r.lang === 'en' ? 'en' : 'sv',
    },
  }
}

// --- Helper -----------------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// --- HTTP handler -----------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight — must be first, always returns 200 with CORS headers.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405)
  }

  // --- Setup: service-role client (server-side only; key never returned to caller) -----------
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!supabaseUrl || !serviceKey || !resendKey) {
    console.error('admin-create-barber: missing required server configuration')
    return json({ ok: false, error: 'not_configured' }, 500)
  }
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // --- AUTH GATE (fail-closed): validate JWT + enforce owner role --------------------------
  //
  // Even though verify_jwt=true means the gateway already rejected invalid tokens, we call
  // auth.getUser(jwt) ourselves to (a) extract the user ID and (b) add defense-in-depth.
  // The owner role check is the real gate: a valid JWT is necessary but not sufficient.
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const { data: callerData, error: callerError } = await service.auth.getUser(jwt)
  if (callerError || callerData.user === null) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  const callerId = callerData.user.id

  // Read the caller's role from profiles (DB-authoritative; do not trust JWT claims for role).
  const { data: profileData, error: profileError } = await service
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single()
  if (profileError || profileData === null) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (profileData.role !== 'owner') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  // --- PARSE + VALIDATE body ----------------------------------------------------------------
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const parsed = parseBody(raw)
  if (!parsed.ok) {
    return json({ ok: false, error: 'invalid_payload', detail: parsed.error }, 400)
  }
  const { email, barber_id, lang } = parsed.body

  // Confirm barber_id references a real row in public.barbers (owner can only link real barbers).
  const { data: barberData, error: barberError } = await service
    .from('barbers')
    .select('id')
    .eq('id', barber_id)
    .single()
  if (barberError || barberData === null) {
    return json({ ok: false, error: 'invalid_payload', detail: 'barber_id not found' }, 400)
  }

  const linked = await service
    .from('profiles')
    .select('id')
    .eq('barber_id', barber_id)
    .maybeSingle()
  if (linked.error) {
    console.error('admin-create-barber: profile precheck failed:', linked.error.message)
    return json({ ok: false, error: 'create_failed' }, 500)
  }
  if (linked.data !== null) return json({ ok: false, error: 'barber_linked' }, 409)

  // generateLink(type=invite) creates an unconfirmed Auth user without assigning a shared password.
  // The link itself points at our domain; `/invite` verifies the token only after an explicit click.
  const generated = await service.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: 'https://bladeblendstudio.se/invite' },
  })

  if (generated.error) {
    // Detect duplicate email without leaking details about existing accounts.
    const msg = generated.error.message.toLowerCase()
    if (
      msg.includes('already registered') ||
      msg.includes('already been registered') ||
      msg.includes('duplicate')
    ) {
      return json({ ok: false, error: 'email_taken' }, 409)
    }
    console.error('admin-create-barber: generateLink error:', generated.error.message)
    return json({ ok: false, error: 'create_failed' }, 500)
  }

  const newUserId = generated.data.user.id

  // --- LINK: insert profiles row -----------------------------------------------------------
  //
  // The invite acceptance page creates the first password before login, so no forced-password flag
  // is needed. On any later failure, remove both rows so the owner can retry with a fresh invite.
  const { error: insertError } = await service.from('profiles').insert({
    id: newUserId,
    role: 'barber',
    barber_id,
    must_change_password: false,
  })

  if (insertError) {
    console.error('admin-create-barber: profiles insert failed:', insertError.message)
    // Best-effort cleanup — do not propagate this error (the real error is the insert failure).
    const { error: deleteError } = await service.auth.admin.deleteUser(newUserId)
    if (deleteError) {
      console.error(
        `admin-create-barber: ORPHAN WARNING — auth user ${newUserId} created but profile insert failed and cleanup also failed:`,
        deleteError.message,
      )
    }
    return json({ ok: false, error: 'link_failed' }, 500)
  }

  try {
    const tokenHash = generated.data.properties.hashed_token
    const copy = await loadEmailTemplate(service, 'auth_invite', lang)
    const link = `https://bladeblendstudio.se/invite?token_hash=${encodeURIComponent(tokenHash)}&type=invite`
    const message = buildEmailMessage({ to: email, lang, copy, ctaHref: link })
    await sendViaResend(message, resendKey, `auth-invite/${tokenHash.slice(0, 48)}`)
    return json({ ok: true }, 200)
  } catch (error) {
    console.error(
      'admin-create-barber: invite delivery failed:',
      error instanceof Error ? error.message : 'unknown',
    )
    const profileCleanup = await service.from('profiles').delete().eq('id', newUserId)
    if (profileCleanup.error) {
      console.error('admin-create-barber: profile cleanup failed:', profileCleanup.error.message)
    }
    const authCleanup = await service.auth.admin.deleteUser(newUserId)
    if (authCleanup.error) {
      console.error('admin-create-barber: auth cleanup failed:', authCleanup.error.message)
    }
    return json({ ok: false, error: 'invite_send_failed' }, 502)
  }
})
