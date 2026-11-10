// Pure decisions of the admin log list in Settings: how a table is named, who an entry says acted
// and what its lines read. No effects: the section owns the state and makes the calls.

import type { AuditActor, AuditChange, AuditLogEntry } from '../adapters/auditLogAdmin'
import type { AdminStrings } from '../adminStrings'
import { fillSlot } from './ownerLists'
import type { AdminBarber } from './viewTypes'

type TargetLabelKey = Extract<keyof AdminStrings, `auditTarget${string}`>

/** The fourteen tables the log can name, each with the string that names one row of it. */
const TARGET_LABEL_KEYS: ReadonlyMap<string, TargetLabelKey> = new Map<string, TargetLabelKey>([
  ['bookings', 'auditTargetBookings'],
  ['barbers', 'auditTargetBarbers'],
  ['services', 'auditTargetServices'],
  ['profiles', 'auditTargetProfiles'],
  ['site_settings', 'auditTargetSiteSettings'],
  ['barber_schedules', 'auditTargetBarberSchedules'],
  ['barber_time_off', 'auditTargetBarberTimeOff'],
  ['barber_slot_blocks', 'auditTargetBarberSlotBlocks'],
  ['barber_recurring_breaks', 'auditTargetBarberRecurringBreaks'],
  ['reviews', 'auditTargetReviews'],
  ['staff_invitations', 'auditTargetStaffInvitations'],
  ['barber_photos', 'auditTargetBarberPhotos'],
  ['barber_calendar_tokens', 'auditTargetBarberCalendarTokens'],
  ['cms_revisions', 'auditTargetCmsRevisions'],
])

export type AuditTargetText = Pick<AdminStrings, TargetLabelKey>

/** The kind of thing a table holds, in the panel's language; a table it does not know by its name. */
export function auditTargetLabel(table: string, t: AuditTargetText): string {
  const key = TARGET_LABEL_KEYS.get(table)
  return key === undefined ? table : t[key]
}

export type AuditActorText = Pick<
  AdminStrings,
  'auditActorOwner' | 'auditActorBarber' | 'auditActorRemoved' | 'auditActorUnknown'
>

/**
 * Who acted: the owner, a barber by the roster's name, or a staff account that no longer exists. A
 * barber the roster does not hold (deleted, or the roster has not arrived) is named by the stored id.
 * An account with a role this panel has no name for is staff with that role as it is stored.
 */
export function auditActorLabel(
  actor: AuditActor,
  barbers: readonly Pick<AdminBarber, 'id' | 'name'>[],
  t: AuditActorText,
): string {
  switch (actor.kind) {
    case 'owner':
      return t.auditActorOwner
    case 'removed':
      return t.auditActorRemoved
    case 'barber': {
      if (actor.barberId === null) return t.auditActorBarber
      const barber = barbers.find((candidate) => candidate.id === actor.barberId)
      return `${t.auditActorBarber} ${barber?.name ?? actor.barberId}`
    }
    case 'unknown':
      return fillSlot(t.auditActorUnknown, '{role}', actor.role)
  }
}

export type AuditActionText = Pick<
  AdminStrings,
  'auditActionInsert' | 'auditActionUpdate' | 'auditActionDelete' | 'auditActionUnknown'
>

/** Created, changed or deleted; an action this panel has no name for by its stored name. */
export function auditActionLabel(change: AuditChange, t: AuditActionText): string {
  switch (change.action) {
    case 'insert':
      return t.auditActionInsert
    case 'update':
      return t.auditActionUpdate
    case 'delete':
      return t.auditActionDelete
    case 'unknown':
      return fillSlot(t.auditActionUnknown, '{action}', change.name)
  }
}

/** The columns an entry names, as they are stored: an update always, another action when it does. */
function namedColumns(change: AuditChange): readonly string[] {
  switch (change.action) {
    case 'insert':
    case 'delete':
      return []
    case 'update':
    case 'unknown':
      return change.changedColumns
  }
}

export type AuditLineText = AuditTargetText &
  AuditActorText &
  AuditActionText &
  Pick<AdminStrings, 'auditChangedColumns' | 'auditRowId'>

/** The lines one entry shows, apart from its time. */
export interface AuditLine {
  /** "Ägare", "Barberare Hassan", "Kontot borttaget". */
  readonly who: string
  /** "Ändrade recension". */
  readonly what: string
  /** The changed column names as they are stored; `null` for a created or deleted row. */
  readonly columns: string | null
  /** The row's key as it is stored. */
  readonly target: string
}

export function auditLine(
  entry: AuditLogEntry,
  barbers: readonly Pick<AdminBarber, 'id' | 'name'>[],
  t: AuditLineText,
): AuditLine {
  const columns = namedColumns(entry.change)
  return {
    who: auditActorLabel(entry.actor, barbers, t),
    what: `${auditActionLabel(entry.change, t)} ${auditTargetLabel(entry.targetTable, t)}`,
    columns:
      columns.length > 0 ? fillSlot(t.auditChangedColumns, '{columns}', columns.join(', ')) : null,
    target: fillSlot(t.auditRowId, '{id}', entry.targetId),
  }
}
