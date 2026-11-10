// admin-create-barber — Supabase Edge Function (Deno) — OWNER-ONLY account provisioning.
//
// Purpose: the owner provisions a Supabase auth login for an existing barber. They POST
//   { email, barber_id, lang }; this function:
//   1. validates that the caller holds an owner JWT (fail-closed),
//   2. validates the body (email shape + barber_id exists in public.barbers),
//   3. provisions or refreshes an unconfirmed Supabase user via service-role,
//   4. links a new invited user to the barber profile,
//   5. stores a non-expiring one-use enrollment digest and sends its capability through Resend, and
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
// ADMIN LOG: written under the owner once the invite is delivered. A failed request records
// nothing, except a re-sent invite whose mail failed: it has already replaced the earlier link.
//
// CORS: the admin panel is served from Cloudflare (different origin); CORS headers + OPTIONS preflight
// handling (from _shared/staffCors.ts) are required for browser-originated requests.
//
// Invocation: admin panel -> supabase.functions.invoke('admin-create-barber', { body, headers })
// Run locally: npx supabase functions serve admin-create-barber --env-file supabase/functions/.env

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordOrLogAdminAction, withinAdminLogBound } from '../_shared/adminAudit.ts'
import {
  loadEmailBusiness,
  loadEmailTemplate,
  prepareEmail,
  sendViaResend,
} from '../_shared/email.ts'
import { json, parse } from '../_shared/http.ts'
import { staffCors } from '../_shared/staffCors.ts'
import { requestSchema } from './request.ts'
import { hashStaffInvitationToken, newStaffInvitationToken } from '../_shared/staffInvitation.ts'

/** Read before a re-sent invite stores its digest. Never throws or waits past the admin log's
 * bound: the invite does not depend on it. */
async function hasStoredInvitation(
  service: SupabaseClient,
  userId: string,
): Promise<boolean | null> {
  try {
    const answer = await withinAdminLogBound(() =>
      service.from('staff_invitations').select('user_id').eq('user_id', userId).maybeSingle(),
    )
    if (answer.timedOut) {
      console.error('admin-create-barber: invitation precheck failed:', 'timeout')
      return null
    }
    const stored = answer.value
    if (stored.error) {
      console.error('admin-create-barber: invitation precheck failed:', stored.error.code)
      return null
    }
    return stored.data !== null
  } catch (error) {
    console.error(
      'admin-create-barber: invitation precheck failed:',
      error instanceof Error ? error.name : 'unknown',
    )
    return null
  }
}

/** An account with a profile existed before this request and is not its to remove. Never throws. */
async function hasProfile(service: SupabaseClient, userId: string): Promise<boolean | null> {
  try {
    const answer = await withinAdminLogBound(() =>
      service.from('profiles').select('id').eq('id', userId).maybeSingle(),
    )
    if (answer.timedOut) {
      console.error('admin-create-barber: profile lookup failed:', 'timeout')
      return null
    }
    const found = answer.value
    if (found.error) {
      console.error('admin-create-barber: profile lookup failed:', found.error.code)
      return null
    }
    return found.data !== null
  } catch (error) {
    console.error(
      'admin-create-barber: profile lookup failed:',
      error instanceof Error ? error.name : 'unknown',
    )
    return null
  }
}

// --- HTTP handler -----------------------------------------------------------------------------

async function handle(req: Request): Promise<Response> {
  // CORS preflight — must be first, always returns 200; `staffCors` adds the CORS headers.
  if (req.method === 'OPTIONS') {
    return new Response('ok')
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
    .select('role,account_enabled')
    .eq('id', callerId)
    .single()
  if (profileError || profileData === null) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (profileData.role !== 'owner' || profileData.account_enabled !== true) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  // --- PARSE + VALIDATE body ----------------------------------------------------------------
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const parsed = parse(requestSchema, raw)
  if (!parsed.ok) {
    return json({ ok: false, error: 'invalid_payload', detail: parsed.detail }, 400)
  }
  const { email, barber_id, lang } = parsed.data

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
  let isNewAccount = linked.data === null

  if (linked.data !== null) {
    const existing = await service.auth.admin.getUserById(linked.data.id)
    if (existing.error || existing.data.user === null) {
      console.error(
        'admin-create-barber: linked auth user lookup failed:',
        existing.error?.message ?? 'missing user',
      )
      return json({ ok: false, error: 'create_failed' }, 500)
    }
    if (
      typeof existing.data.user.email_confirmed_at === 'string' &&
      existing.data.user.email_confirmed_at !== ''
    ) {
      return json({ ok: false, error: 'account_active' }, 409)
    }
    if (existing.data.user.email?.toLowerCase() !== email) {
      return json({ ok: false, error: 'email_mismatch' }, 409)
    }
    isNewAccount = false
  }

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

  if (linked.data !== null && newUserId !== linked.data.id) {
    console.error('admin-create-barber: refreshed invite resolved to a different auth user')
    return json({ ok: false, error: 'create_failed' }, 500)
  }

  // --- LINK: insert profiles row -----------------------------------------------------------
  //
  // The invite acceptance page creates the first password before login, so no forced-password flag
  // is needed. On any later failure, remove both rows so the owner can retry with a fresh invite.
  if (isNewAccount) {
    const { error: insertError } = await service.from('profiles').insert({
      id: newUserId,
      role: 'barber',
      barber_id,
      must_change_password: false,
    })

    if (insertError) {
      console.error('admin-create-barber: profiles insert failed:', insertError.message)
      // The address may be another barber's unconfirmed account, whose profile failed this insert:
      // the cleanup below must never remove it, nor anything when that cannot be known.
      const alreadyLinked = await hasProfile(service, newUserId)
      if (alreadyLinked === null) return json({ ok: false, error: 'link_failed' }, 500)
      if (alreadyLinked) return json({ ok: false, error: 'email_taken' }, 409)
      // Best-effort cleanup — do not propagate this error (the real error is the insert failure).
      const { error: deleteError } = await service.auth.admin.deleteUser(newUserId)
      if (deleteError) {
        console.error('admin-create-barber: auth cleanup failed after profile insert failure')
        const queued = await service.rpc('internal_queue_auth_user_delete', {
          p_user_id: newUserId,
        })
        if (queued.error) {
          console.error('admin-create-barber: durable auth cleanup queue failed')
        }
      }
      return json({ ok: false, error: 'link_failed' }, 500)
    }
  }

  // A new account has no invitation yet: its profile was inserted just above.
  const invitationStored = isNewAccount ? false : await hasStoredInvitation(service, newUserId)

  // ADMIN LOG: nothing when the earlier invitation state could not be read.
  const recordInvitation = async (): Promise<void> => {
    if (invitationStored === false) {
      await recordOrLogAdminAction('admin-create-barber', service, {
        actorId: callerId,
        action: 'insert',
        table: 'staff_invitations',
        targetId: newUserId,
      })
    } else if (invitationStored === true) {
      await recordOrLogAdminAction('admin-create-barber', service, {
        actorId: callerId,
        action: 'update',
        table: 'staff_invitations',
        targetId: newUserId,
        changedColumns: ['token_hash', 'created_at'],
      })
    }
  }

  let invitationWritten = false
  try {
    const invitationToken = newStaffInvitationToken()
    const tokenHash = await hashStaffInvitationToken(invitationToken)
    const stored = await service.from('staff_invitations').upsert(
      {
        user_id: newUserId,
        token_hash: tokenHash,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (stored.error) throw new Error('Could not persist staff invitation')
    invitationWritten = true
    const copy = await loadEmailTemplate(service, 'auth_invite', lang)
    const business = await loadEmailBusiness(service)
    const link = `https://bladeblendstudio.se/invite#staff_invite=${invitationToken}`
    const message = prepareEmail(
      'auth_invite',
      { to: email, lang, copy, ctaHref: link, business },
      null,
    )
    await sendViaResend(message, resendKey, `auth-invite/${tokenHash.slice(0, 48)}`, service)
  } catch (error) {
    console.error(
      'admin-create-barber: invite delivery failed:',
      error instanceof Error ? error.message : 'unknown',
    )
    if (isNewAccount) {
      const profileCleanup = await service.from('profiles').delete().eq('id', newUserId)
      if (profileCleanup.error) {
        console.error('admin-create-barber: profile cleanup failed:', profileCleanup.error.message)
      }
      const authCleanup = await service.auth.admin.deleteUser(newUserId)
      if (authCleanup.error) {
        console.error('admin-create-barber: auth cleanup failed:', authCleanup.error.message)
        const queued = await service.rpc('internal_queue_auth_user_delete', {
          p_user_id: newUserId,
        })
        if (queued.error) {
          console.error('admin-create-barber: durable auth cleanup queue failed')
        }
      }
    } else if (invitationWritten) {
      // The account stays, but its earlier invite link is dead though no mail arrived: recorded.
      await recordInvitation()
    }
    return json({ ok: false, error: 'invite_send_failed' }, 502)
  }

  // ADMIN LOG: the database cannot attribute a service-role write; a failed entry is only logged.
  // After the block above, so it can never reach the cleanup there.
  if (isNewAccount) {
    await recordOrLogAdminAction('admin-create-barber', service, {
      actorId: callerId,
      action: 'insert',
      table: 'profiles',
      targetId: newUserId,
    })
  }
  await recordInvitation()
  return json({ ok: true }, 200)
}

Deno.serve(staffCors(Deno.env.get('CMS_ALLOWED_ORIGINS'), handle))
