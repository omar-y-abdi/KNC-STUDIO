// Pure decisions of the Settings admin log list; AuditLogSection owns the state and the calls.

import type { AuditActor, AuditChange, AuditLogEntry } from '../adapters/auditLogAdmin'
import type { AdminStrings } from '../adminStrings'
import { fillSlot } from './ownerLists'
import type { AdminBarber } from './viewTypes'

type TargetLabelKey = Extract<keyof AdminStrings, `auditTarget${string}`>

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

export function auditTargetLabel(table: string, t: AuditTargetText): string {
  const key = TARGET_LABEL_KEYS.get(table)
  return key === undefined ? table : t[key]
}

export type AuditActorText = Pick<
  AdminStrings,
  'auditActorOwner' | 'auditActorBarber' | 'auditActorRemoved' | 'auditActorUnknown'
>

/** A barber the roster does not hold (deleted, or not arrived yet) is named by the stored id. */
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

export interface AuditLine {
  /** "Ägare", "Barberare Hassan", "Kontot borttaget". */
  readonly who: string
  /** "Ändrade recension". */
  readonly what: string
  /** `null` when the entry names no columns. */
  readonly columns: string | null
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
