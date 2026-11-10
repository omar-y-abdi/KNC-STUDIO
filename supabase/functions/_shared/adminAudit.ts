// The admin log entry for a change a staff function makes with the service role on behalf of a
// signed-in member of staff. A change made with the member's own JWT is recorded by the database
// itself (the audit trigger reads the JWT). A service-role write carries no staff identity, so the
// function that made it says who acted, through `internal_record_admin_action`.
//
// An entry names the actor, the action, the table, the row and, for an update, the changed columns.
// It never holds a value.
//
// This module imports nothing, so every staff function can use it: the calendar-* functions deploy
// without an import map.
//
// The staff action has already happened when its entry is written, so no function waits long for
// the admin log: the write, and every read a function makes only for it, is given up after
// `ADMIN_LOG_BOUND_MS` (`withinAdminLogBound`), and the function answers as it would have.

/** How long a staff function waits for the admin log, or for a read it makes on its behalf. */
export const ADMIN_LOG_BOUND_MS = 3000

/** A call that answered within the bound, or one that was given up on. */
export type BoundedAnswer<T> =
  { readonly timedOut: false; readonly value: T } | { readonly timedOut: true }

/**
 * Wait for `call`, but no longer than `ADMIN_LOG_BOUND_MS`. A call that answers in time clears the
 * timer; one that throws or rejects in time rejects here. A call that is given up on keeps running:
 * its late answer or rejection ends in the handlers below and is never an unhandled rejection.
 */
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

/** The service-role client, as far as this module uses it. */
export interface AdminAuditService {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { code?: string } | null }>
}

/**
 * The tables `internal_record_admin_action` accepts, each with its columns other than the key. The
 * database refuses a column name the table does not have, and a refused entry is only a log line:
 * naming the columns here turns a misspelt one into a compile error instead.
 */
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
  /** The auth user id of the signed-in member of staff, taken from the verified JWT. The calendar
   *  OAuth callback carries no JWT: there it is the one staff account of the barber id in the
   *  signed state. */
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

/**
 * One staff action. An update names at least one column of its table; an insert or a delete concerns
 * the whole row and names none.
 */
export type AdminActionRecord = { [Table in AuditedTable]: AdminActionOn<Table> }[AuditedTable]

/**
 * `code` is the database's error code, the name of what was thrown, or `timeout` when the write did
 * not answer within the bound; never a message.
 */
export type AdminAuditResult = { readonly ok: true } | { readonly ok: false; readonly code: string }

/**
 * Write the entry. Never throws and never waits past the bound: a failure is the `ok: false`
 * result.
 */
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

/**
 * Write the entry for a staff action that has already happened. The caller answers as it would
 * without the admin log, so a failure is only logged: the function's name and the error code,
 * nothing of the record.
 */
export async function recordOrLogAdminAction(
  source: string,
  service: AdminAuditService,
  record: AdminActionRecord,
): Promise<void> {
  const recorded = await recordAdminAction(service, record)
  if (!recorded.ok) console.error(`${source}: admin log write failed:`, recorded.code)
}
