// Admin log adapter (owner only): one newest-first page of `admin_list_audit_log`, never a value.
// SQLSTATE 42501 is `forbidden`, HTTP 401 is `auth`; answers are Zod-parsed, nothing throws.

import { getAdminClient } from '../adminClient'
import { auditLogPage, parseWith, type AuditLogEntryRow } from '../adminSchemas'
import type { AdminBarberId, AdminResult } from '../types'
import { err, ok } from '../types'

/** The actor's account as it is now: `removed` once deleted, `unknown` for a role named later. */
export type AuditActor =
  | { readonly kind: 'owner' }
  | { readonly kind: 'barber'; readonly barberId: AdminBarberId | null }
  | { readonly kind: 'removed' }
  | { readonly kind: 'unknown'; readonly role: string }

/** Only an update names columns (at least one); `unknown` keeps an action's stored name. */
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
  readonly targetTable: string
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
    // 401: no valid session, also for the anonymous role, whose refusal is a 42501 too.
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
