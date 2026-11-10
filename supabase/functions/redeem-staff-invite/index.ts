// Public only because the recipient has no session yet. The 256-bit, one-use capability is the
// credential. GET/mail prefetch never consumes it; the invite page POSTs after an explicit click.
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { json } from '../_shared/http.ts'
import { staffCors } from '../_shared/staffCors.ts'
import { hashStaffInvitationToken } from '../_shared/staffInvitation.ts'

const requestSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const reply = (body: unknown, status = 200): Response =>
  json(body, status, { 'Cache-Control': 'no-store' })
const invalid = (): Response => reply({ ok: false, error: 'invalid_invitation' }, 400)
const unavailable = (): Response => reply({ ok: false, error: 'unavailable' }, 503)

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return reply({ ok: true })
  if (req.method !== 'POST') return reply({ ok: false, error: 'method_not_allowed' }, 405)
  let raw: unknown
  try {
    const text = await req.text()
    if (text.length > 1024) return invalid()
    raw = JSON.parse(text)
  } catch {
    return invalid()
  }
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) return invalid()
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return unavailable()
  const service = createClient(url, key, { auth: { persistSession: false } })
  try {
    const claimed = await service.rpc('consume_staff_invitation', {
      p_token_hash: await hashStaffInvitationToken(parsed.data.token),
    })
    if (claimed.error) return unavailable()
    if (typeof claimed.data !== 'string') return invalid()

    const existing = await service.auth.admin.getUserById(claimed.data)
    const user = existing.data.user
    if (existing.error) return unavailable()
    if (!user?.email || user.email_confirmed_at) return invalid()

    // Claim precedes generation: concurrent calls cannot rotate each other's Auth invite token.
    // From this point the durable link is spent, just as an ordinary Auth invite is spent when
    // opened. On delivery/network failure the owner can issue a replacement invitation.
    const generated = await service.auth.admin.generateLink({
      type: 'invite',
      email: user.email,
      options: { redirectTo: 'https://bladeblendstudio.se/invite' },
    })
    if (generated.error || generated.data.user.id !== claimed.data) return unavailable()
    return reply({ ok: true, token_hash: generated.data.properties.hashed_token })
  } catch {
    return unavailable()
  }
}

Deno.serve(staffCors(Deno.env.get('CMS_ALLOWED_ORIGINS'), handle))
