// admin-create-barber — Supabase Edge Function (Deno) — OWNER-ONLY account provisioning.
//
// Purpose: the owner provisions a Supabase auth login for an existing barber. They POST
//   { email, barber_id }; this function:
//   1. validates that the caller holds an owner JWT (fail-closed),
//   2. validates the body (email shape + barber_id exists in public.barbers),
//   3. creates a Supabase auth user (password '123456', email pre-confirmed) via service-role,
//   4. inserts a profiles row { id, role:'barber', barber_id, must_change_password:true }, and
//   5. returns { ok:true } (no credentials in the response).
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
}

type ParseResult =
  | { readonly ok: true; readonly body: CreateBarberBody }
  | { readonly ok: false; readonly error: string }

// --- Validation (boundary; never trust the request body) -------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function looksLikeEmail(v: string): boolean {
  // Minimal sanity check — the real validation happens in Supabase auth on createUser.
  return v.includes('@') && v.length >= 3 && v.length <= 254
}

function parseBody(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'body must be a JSON object' }
  }
  const r = raw as Record<string, unknown>
  if (!isNonEmptyString(r.email)) return { ok: false, error: 'email is required' }
  if (!looksLikeEmail(r.email)) return { ok: false, error: 'email is invalid' }
  if (!isNonEmptyString(r.barber_id)) return { ok: false, error: 'barber_id is required' }
  return { ok: true, body: { email: r.email, barber_id: r.barber_id } }
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
  if (!supabaseUrl || !serviceKey) {
    console.error('admin-create-barber: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
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
  const { email, barber_id } = parsed.body

  // Confirm barber_id references a real row in public.barbers (owner can only link real barbers).
  const { data: barberData, error: barberError } = await service
    .from('barbers')
    .select('id')
    .eq('id', barber_id)
    .single()
  if (barberError || barberData === null) {
    return json({ ok: false, error: 'invalid_payload', detail: 'barber_id not found' }, 400)
  }

  // --- CREATE auth user (service-role; temporary initial password) -------------------------
  //
  // password: '123456' — barber must change it on first login (must_change_password = true below).
  // email_confirm: true — no confirmation email; owner provisions the account directly.
  const { data: createData, error: createError } =
    await service.auth.admin.createUser({
      email,
      password: '123456',
      email_confirm: true,
    })

  if (createError) {
    // Detect duplicate email without leaking details about existing accounts.
    const msg = createError.message.toLowerCase()
    if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('duplicate')) {
      return json({ ok: false, error: 'email_taken' }, 409)
    }
    console.error('admin-create-barber: createUser error:', createError.message)
    return json({ ok: false, error: 'create_failed' }, 500)
  }

  const newUserId = createData.user.id

  // --- LINK: insert profiles row -----------------------------------------------------------
  //
  // must_change_password = true forces the barber to pick a new password on first login.
  // On insert failure, best-effort delete the just-created auth user to avoid an orphan.
  const { error: insertError } = await service.from('profiles').insert({
    id: newUserId,
    role: 'barber',
    barber_id,
    must_change_password: true,
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

  // Success — no credentials or sensitive data in the response.
  return json({ ok: true }, 200)
})
