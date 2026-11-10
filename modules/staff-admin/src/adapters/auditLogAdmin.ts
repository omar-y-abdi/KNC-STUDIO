// Admin log adapter (owner only): one page of `admin_list_audit_log`, newest first. An entry says who
// changed which row of which staff-managed table, and for an update which columns; it never holds a
// value. The database refuses every caller but an enabled owner with SQLSTATE 42501, which arrives
// here as `forbidden`. A request without a valid session is answered with HTTP 401 and arrives as
// `auth`.
//
// Boundary discipline: every answer is Zod-parsed; failure -> AdminError. Never throws to the UI.

import { getAdminClient } from '../adminClient'
import { auditLogPage, parseWith, type AuditLogEntryRow } from '../adminSchemas'
import type { AdminBarberId, AdminResult } from '../types'
import { err, ok } from '../types'

/**
 * Who made the change, as the staff account is now: `removed` once it no longer exists, `unknown`
 * for a role this panel has no name for (a later migration added it).
 */
export type AuditActor =
  | { readonly kind: 'owner' }
  | { readonly kind: 'barber'; readonly barberId: AdminBarberId | null }
  | { readonly kind: 'removed' }
  | { readonly kind: 'unknown'; readonly role: string }

/**
 * What was done to the row. Only an update names columns, and it names at least one. `unknown` is an
 * action this panel has no name for, by its stored name, with the columns it names (none: empty).
 */
export type AuditChange =
  | { readonly action: 'insert' }
  | { readonly action: 'delete' }
  | { readonly action: 'update'; readonly changedColumns: readonly string[] }
  | {
      readonly action: 'unknown'
      readonly name: string
      readonly changedColumns: readonly string[]
    }

export interface AuditLogEntry {
  readonly id: string
  /** The database timestamp verbatim: it is also the paging cursor, so never round it. */
  readonly createdAt: string
  readonly actor: AuditActor
  readonly change: AuditChange
  /** The table name as stored; the panel names the fourteen it knows. */
  readonly targetTable: string
  /** The row's primary key as stored. */
  readonly targetId: string
}

/** Where the next page starts: just after this entry in newest-first order. */
export interface AuditLogCursor {
  readonly before: string
  readonly beforeId: string
}

export interface AuditLogPage {
  readonly entries: readonly AuditLogEntry[]
  readonly hasMore: boolean
}

const READ_ERROR = 'Kunde inte läsa adminloggen.'
const SESSION_EXPIRED = 'Din session har gått ut. Logga in igen.'
const PAGE_SIZE = 50

function toActor(row: AuditLogEntryRow): AuditActor {
  switch (row.actor_role) {
    case null:
      return { kind: 'removed' }
    case 'owner':
      return { kind: 'owner' }
    case 'barber':
      return { kind: 'barber', barberId: row.actor_barber_id }
    default:
      return { kind: 'unknown', role: row.actor_role }
  }
}

function toChange(row: AuditLogEntryRow): AuditChange {
  if (row.action === 'insert' || row.action === 'delete') return { action: row.action }
  if (row.action === 'update' && row.changed_columns !== null)
    return { action: 'update', changedColumns: row.changed_columns }
  return { action: 'unknown', name: row.action, changedColumns: row.changed_columns ?? [] }
}

function toEntry(row: AuditLogEntryRow): AuditLogEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    actor: toActor(row),
    change: toChange(row),
    targetTable: row.target_table,
    targetId: row.target_id,
  }
}

export async function listAuditLog(
  cursor: AuditLogCursor | null,
): Promise<AdminResult<AuditLogPage>> {
  try {
    const { data, error, status } = await getAdminClient().rpc('admin_list_audit_log', {
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: PAGE_SIZE,
    })
    // 401: the request carried no valid session (expired, missing, or the anonymous role, whose
    // refusal is a 42501 as well). A signed-in caller who is not the owner is refused with 403.
    if (status === 401) return err('auth', SESSION_EXPIRED)
    if (error?.code === '42501') return err('forbidden', 'Endast ägaren kan läsa adminloggen.')
    if (error !== null || data === null) return err('network', READ_ERROR)
    const parsed = parseWith(auditLogPage, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok({ entries: parsed.value.entries.map(toEntry), hasMore: parsed.value.has_more })
  } catch {
    return err('network', READ_ERROR)
  }
}
