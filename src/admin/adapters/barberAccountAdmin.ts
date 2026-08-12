// Adapter for the `admin-create-barber` edge function. The function is OWNER-gated server-side
// (JWT → profiles.role check); this adapter just packages the call and maps the typed error codes
// to Swedish user-facing messages. Uses the admin client (anon key + owner session JWT — the edge
// function receives the Authorization header automatically).
//
// Boundary discipline: maps BOTH invoke transport errors and `{ok:false,error}` bodies to an
// `AdminResult`. Never throws to the UI.

import { getAdminClient } from '../adminClient'
import type { AdminResult } from '../types'
import { err, ok } from '../types'

const GENERIC_ERROR = 'Kunde inte skapa kontot. Försök igen.'

/** Map an edge function error code to a Swedish `AdminResult<void>` error. */
function mapErrorCode(code: string | undefined): AdminResult<void> {
  switch (code) {
    case 'email_taken':
      return err('validation', 'E-posten används redan.')
    case 'barber_linked':
      return err('validation', 'Barberaren har redan ett kopplat konto.')
    case 'invite_send_failed':
      return err('network', 'Kontot kunde inte bjudas in. Försök igen.')
    case 'forbidden':
      return err('forbidden', 'Endast ägaren kan skapa konton.')
    case 'invalid_payload':
      return err('validation', 'Ogiltig e-post eller barberare.')
    default:
      return err('network', GENERIC_ERROR)
  }
}

/**
 * Ask the `admin-create-barber` edge function to provision a Supabase auth login for an existing
 * barber. The owner's JWT is forwarded automatically by the admin client; the function validates
 * the role server-side. On success the barber receives a single-use invitation to create a personal
 * password. No shared credential is created or returned.
 *
 * Handles both supabase-js v2 behaviour variants:
 *   - Some versions return `{ data, error:null }` on 2xx and `{ data:null, error }` on non-2xx.
 *   - Others may populate `data` even on non-2xx; `data?.ok` is checked first.
 */
export async function createBarberAccount(
  email: string,
  barberId: string,
  lang: 'sv' | 'en',
): Promise<AdminResult<void>> {
  try {
    const { data, error } = await getAdminClient().functions.invoke('admin-create-barber', {
      body: { email, barber_id: barberId, lang },
    })

    // Check the typed body first — some supabase-js versions return data even on non-2xx.
    if (data !== null && typeof data === 'object') {
      const d = data as Record<string, unknown>
      if (d['ok'] === true) return ok(undefined)
      if (d['ok'] === false) return mapErrorCode(d['error'] as string | undefined)
    }

    if (error !== null) {
      // Non-2xx response: try to read the typed error body from the response context.
      try {
        const ctx = (error as unknown as { context?: Response }).context
        if (ctx !== undefined) {
          const body = (await ctx.json()) as Record<string, unknown>
          if (body['ok'] === false) return mapErrorCode(body['error'] as string | undefined)
        }
      } catch {
        // Parse failure — fall through to generic error below.
      }
      return err('network', GENERIC_ERROR)
    }

    // Unexpected: no data, no error.
    return err('network', GENERIC_ERROR)
  } catch {
    return err('network', GENERIC_ERROR)
  }
}
