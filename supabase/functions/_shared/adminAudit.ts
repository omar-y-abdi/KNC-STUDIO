// Admin log entries for service-role writes, which carry no JWT for the database's audit trigger to
// read. An entry never holds a value. Imports nothing: the calendar-* functions have no import map.
// The staff action has already happened, so the log never makes a function wait past its bound.

export const ADMIN_LOG_BOUND_MS = 3000

export type BoundedAnswer<T> =
  { readonly timedOut: false; readonly value: T } | { readonly timedOut: true }

/** A call given up on keeps running; its late answer or rejection is handled, never unhandled. */
export function withinAdminLogBound<T>(call: () => PromiseLike<T>): Promise<BoundedAnswer<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ADMIN_LOG_BOUND_MS)
    // Started inside the chain, so a call that throws at once is a rejection like any other.
    Promise.resolve()
      .then(call)
      .then(
        (value) => {
          clearTimeout(timer)
          resolve({ timedOut: false, value })
        },
        (thrown: unknown) => {
          clearTimeout(timer)
          reject(thrown)
        },
      )
  })
}

export interface AdminAuditService {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { code?: string } | null }>
}

/** The database refuses an unknown column, and a refused entry is only a log line: naming the
 * columns here makes a misspelt one a compile error. */
interface AuditedColumns {
  readonly profiles:
    | 'role'
    | 'barber_id'
    | 'created_at'
    | 'must_change_password'
    | 'account_enabled'
    | 'auth_sync_version'
  readonly staff_invitations: 'token_hash' | 'created_at'
  readonly barber_photos: 'storage_path' | 'updated_at'
  readonly barber_calendar_tokens:
    | 'refresh_token'
    | 'google_email'
    | 'calendar_id'
    | 'connected_at'
    | 'updated_at'
    | 'last_sync_at'
    | 'last_sync_error'
    | 'disconnect_requested_at'
}

type AuditedTable = keyof AuditedColumns

type AdminActionOn<Table extends AuditedTable> = {
  /** The auth user id from the verified JWT; in the calendar OAuth callback (no JWT), the staff
   *  account of the signed state's barber id. */
  readonly actorId: string
  readonly table: Table
  /** `profiles.id` or `staff_invitations.user_id`; for a photo or a calendar link the barber id. */
  readonly targetId: string
} & (
  | { readonly action: 'insert' | 'delete'; readonly changedColumns?: never }
  | {
      readonly action: 'update'
      readonly changedColumns: readonly [AuditedColumns[Table], ...AuditedColumns[Table][]]
    }
)

export type AdminActionRecord = { [Table in AuditedTable]: AdminActionOn<Table> }[AuditedTable]

/** `code`: the database's error code, a thrown error's name or `timeout`; never a message. */
export type AdminAuditResult = { readonly ok: true } | { readonly ok: false; readonly code: string }

/** Never throws or waits past the bound. */
export async function recordAdminAction(
  service: AdminAuditService,
  record: AdminActionRecord,
): Promise<AdminAuditResult> {
  try {
    const answer = await withinAdminLogBound(() =>
      service.rpc('internal_record_admin_action', {
        p_actor: record.actorId,
        p_action: record.action,
        p_target_table: record.table,
        p_target_id: record.targetId,
        p_detail: record.action === 'update' ? { changed: [...record.changedColumns] } : null,
      }),
    )
    if (answer.timedOut) return { ok: false, code: 'timeout' }
    const { error } = answer.value
    if (error === null) return { ok: true }
    return {
      ok: false,
      code: typeof error.code === 'string' && error.code !== '' ? error.code : 'unknown',
    }
  } catch (thrown) {
    return { ok: false, code: thrown instanceof Error ? thrown.name : 'unknown' }
  }
}

/** A failure is only logged, with the function's name and error code, nothing of the record. */
export async function recordOrLogAdminAction(
  source: string,
  service: AdminAuditService,
  record: AdminActionRecord,
): Promise<void> {
  const recorded = await recordAdminAction(service, record)
  if (!recorded.ok) console.error(`${source}: admin log write failed:`, recorded.code)
}
