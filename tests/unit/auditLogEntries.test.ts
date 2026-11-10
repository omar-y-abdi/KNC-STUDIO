import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type {
  AuditChange,
  AuditLogEntry,
} from '../../modules/staff-admin/src/adapters/auditLogAdmin'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import {
  auditActionLabel,
  auditActorLabel,
  auditLine,
  auditTargetLabel,
} from '../../modules/staff-admin/src/views/auditLogEntries'

const sv = adminText('sv')
const en = adminText('en')

/** Each table the log can name, with the panel's Swedish and English word for one row. */
const TABLES = [
  ['bookings', 'bokning', 'booking'],
  ['barbers', 'barberare', 'barber'],
  ['services', 'tjänst', 'service'],
  ['profiles', 'personalkonto', 'staff account'],
  ['site_settings', 'inställning', 'setting'],
  ['barber_schedules', 'veckoschema', 'weekly schedule'],
  ['barber_time_off', 'ledighet', 'time off'],
  ['barber_slot_blocks', 'blockerad tid', 'blocked time'],
  ['barber_recurring_breaks', 'återkommande paus', 'recurring break'],
  ['reviews', 'recension', 'review'],
  ['staff_invitations', 'inbjudan', 'invitation'],
  ['barber_photos', 'profilbild', 'profile photo'],
  ['barber_calendar_tokens', 'kalenderkoppling', 'calendar connection'],
  ['cms_revisions', 'publicering av webbplatsen', 'site publication'],
] as const

const roster = [
  { id: 'hassan', name: 'Hassan' },
  { id: 'victor', name: 'Victor' },
]

const migrationSql = (): string =>
  readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(`supabase/migrations/${name}`, 'utf8'))
    .join('\n')

const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: '66666666-6666-4666-8666-666666666661',
  createdAt: '2026-11-10T13:05:00.654321+00:00',
  actor: { kind: 'owner' },
  change: { action: 'update', changedColumns: ['published'] },
  targetTable: 'reviews',
  targetId: '55555555-5555-4555-8555-555555555551',
  ...overrides,
})

describe('admin log table names', () => {
  it.each(TABLES)('names a row of %s in both languages', (table, swedish, english) => {
    expect(auditTargetLabel(table, sv)).toBe(swedish)
    expect(auditTargetLabel(table, en)).toBe(english)
  })

  it('shows a table it does not know by its stored name', () => {
    expect(auditTargetLabel('gift_cards', sv)).toBe('gift_cards')
    expect(auditTargetLabel('gift_cards', en)).toBe('gift_cards')
    expect(auditTargetLabel('', sv)).toBe('')
    // Object.prototype keys are unknown table names too.
    expect(auditTargetLabel('constructor', sv)).toBe('constructor')
    expect(auditTargetLabel('toString', en)).toBe('toString')
  })

  it('has a name for every table the admin log accepts in the database', () => {
    const sql = migrationSql()
    const constraints = [
      ...sql.matchAll(
        /constraint\s+admin_audit_log_target_table_check\s+check\s*\(\s*target_table\s+in\s*\(([^)]*)\)\s*\)/g,
      ),
    ]
    // The newest definition is the one in force.
    const list = constraints.at(-1)?.[1] ?? ''
    const accepted = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '')

    // The thirteen tables staff write by hand or through an Edge Function, at the least.
    expect(accepted.length).toBeGreaterThanOrEqual(13)
    const named: readonly string[] = TABLES.map(([table]) => table)
    expect(accepted.filter((table) => !named.includes(table))).toEqual([])
  })

  it('names one CMS Studio publish by its revision number', () => {
    const publish: AuditLogEntry = entry({
      change: { action: 'insert' },
      targetTable: 'cms_revisions',
      targetId: '42',
    })
    expect(auditLine(publish, roster, sv)).toEqual({
      who: 'Ägare',
      what: 'Skapade publicering av webbplatsen',
      columns: null,
      target: 'Id: 42',
    })
    expect(auditLine(publish, roster, en)).toEqual({
      who: 'Owner',
      what: 'Created site publication',
      columns: null,
      target: 'Id: 42',
    })
  })
})

describe('admin log actor', () => {
  it('names the owner', () => {
    expect(auditActorLabel({ kind: 'owner' }, roster, sv)).toBe('Ägare')
    expect(auditActorLabel({ kind: 'owner' }, roster, en)).toBe('Owner')
  })

  it('names a barber by the roster', () => {
    expect(auditActorLabel({ kind: 'barber', barberId: 'hassan' }, roster, sv)).toBe(
      'Barberare Hassan',
    )
    expect(auditActorLabel({ kind: 'barber', barberId: 'victor' }, roster, en)).toBe(
      'Barber Victor',
    )
  })

  it('names a barber the roster does not hold by the stored id', () => {
    expect(auditActorLabel({ kind: 'barber', barberId: 'omar' }, roster, sv)).toBe('Barberare omar')
    // The roster has not arrived yet.
    expect(auditActorLabel({ kind: 'barber', barberId: 'hassan' }, [], en)).toBe('Barber hassan')
  })

  it('says only "barber" for a barber account that is linked to no barber', () => {
    expect(auditActorLabel({ kind: 'barber', barberId: null }, roster, sv)).toBe('Barberare')
    expect(auditActorLabel({ kind: 'barber', barberId: null }, roster, en)).toBe('Barber')
  })

  it('says the account is removed when it no longer exists', () => {
    expect(auditActorLabel({ kind: 'removed' }, roster, sv)).toBe('Kontot borttaget')
    expect(auditActorLabel({ kind: 'removed' }, roster, en)).toBe('Account removed')
  })

  it('says staff, with the stored role, for a role it has no name for', () => {
    expect(auditActorLabel({ kind: 'unknown', role: 'manager' }, roster, sv)).toBe(
      'Personal (manager)',
    )
    expect(auditActorLabel({ kind: 'unknown', role: 'manager' }, roster, en)).toBe(
      'Staff (manager)',
    )
    expect(auditActorLabel({ kind: 'unknown', role: '$& {role}' }, roster, sv)).toBe(
      'Personal ($& {role})',
    )
  })
})

describe('admin log action', () => {
  const changes: readonly AuditChange[] = [
    { action: 'insert' },
    { action: 'update', changedColumns: ['published'] },
    { action: 'delete' },
  ]

  it('says created, changed or deleted', () => {
    expect(changes.map((change) => auditActionLabel(change, sv))).toEqual([
      'Skapade',
      'Ändrade',
      'Tog bort',
    ])
    expect(changes.map((change) => auditActionLabel(change, en))).toEqual([
      'Created',
      'Changed',
      'Deleted',
    ])
  })

  it('says the action is unknown, with its stored name, when it has no name for it', () => {
    const merge: AuditChange = { action: 'unknown', name: 'merge', changedColumns: [] }
    expect(auditActionLabel(merge, sv)).toBe('Okänd åtgärd (merge):')
    expect(auditActionLabel(merge, en)).toBe('Unknown action (merge):')
    expect(
      auditActionLabel({ action: 'unknown', name: '$& {action}', changedColumns: [] }, en),
    ).toBe('Unknown action ($& {action}):')
  })
})

describe('admin log entry lines', () => {
  it('shows an update with its columns and the row id as they are stored', () => {
    const update = entry({
      actor: { kind: 'barber', barberId: 'hassan' },
      change: { action: 'update', changedColumns: ['end_min', 'start_min'] },
      targetTable: 'barber_schedules',
      targetId: 'hassan/1',
    })
    expect(auditLine(update, roster, sv)).toEqual({
      who: 'Barberare Hassan',
      what: 'Ändrade veckoschema',
      columns: 'Ändrade fält: end_min, start_min',
      target: 'Id: hassan/1',
    })
    expect(auditLine(update, roster, en)).toEqual({
      who: 'Barber Hassan',
      what: 'Changed weekly schedule',
      columns: 'Changed fields: end_min, start_min',
      target: 'Id: hassan/1',
    })
  })

  it.each(['insert', 'delete'] as const)('shows no column line for a %s', (action) => {
    const line = auditLine(entry({ change: { action } }), roster, sv)
    expect(line.columns).toBeNull()
    expect(line.what).toBe(action === 'insert' ? 'Skapade recension' : 'Tog bort recension')
    expect(line.target).toBe('Id: 55555555-5555-4555-8555-555555555551')
  })

  it('shows an entry of a removed account on a table it does not know', () => {
    expect(
      auditLine(
        entry({
          actor: { kind: 'removed' },
          change: { action: 'delete' },
          targetTable: 'gift_cards',
          targetId: 'card-7',
        }),
        roster,
        en,
      ),
    ).toEqual({
      who: 'Account removed',
      what: 'Deleted gift_cards',
      columns: null,
      target: 'Id: card-7',
    })
  })

  it('takes a stored id literally, also when it looks like a pattern', () => {
    expect(auditLine(entry({ targetId: '$& {id}' }), roster, sv).target).toBe('Id: $& {id}')
  })

  it('shows an entry with an action and a role it has no name for, and the columns it names', () => {
    const unknown = entry({
      actor: { kind: 'unknown', role: 'manager' },
      change: { action: 'unknown', name: 'merge', changedColumns: ['published', 'text'] },
    })
    expect(auditLine(unknown, roster, sv)).toEqual({
      who: 'Personal (manager)',
      what: 'Okänd åtgärd (merge): recension',
      columns: 'Ändrade fält: published, text',
      target: 'Id: 55555555-5555-4555-8555-555555555551',
    })
    expect(auditLine(unknown, roster, en)).toEqual({
      who: 'Staff (manager)',
      what: 'Unknown action (merge): review',
      columns: 'Changed fields: published, text',
      target: 'Id: 55555555-5555-4555-8555-555555555551',
    })
  })

  it('shows no column line for an action it has no name for that names no columns', () => {
    const truncate = entry({ change: { action: 'unknown', name: 'truncate', changedColumns: [] } })
    expect(auditLine(truncate, roster, sv).columns).toBeNull()
    expect(auditLine(truncate, roster, sv).what).toBe('Okänd åtgärd (truncate): recension')
  })
})

describe('admin log retention line', () => {
  // The purge function's retention in months; the newest definition is the one in force.
  const months = [
    ...migrationSql().matchAll(
      /create or replace function public\.internal_purge_admin_audit_log\(\)[\s\S]*?interval '(\d+) months'/g,
    ),
  ].at(-1)?.[1]

  it('says how long entries are kept: as long as the database keeps them', () => {
    expect(months).toMatch(/^\d+$/)
    expect(sv.auditRetention).toContain(`sparas i ${months} månader`)
    expect(en.auditRetention).toContain(`kept for ${months} months`)
  })

  // A booking or review entry holds a customer row's id, so the line names only what is absent.
  it.each([
    ['sv', sv.auditRetention, 'kunduppgifter', ['kundnamn', 'telefonnummer', 'e-postadresser']],
    [
      'en',
      en.auditRetention,
      'customer data',
      ['customer names', 'phone numbers', 'e-mail addresses'],
    ],
  ] as const)(
    'names what an entry does not hold instead of a general claim (%s)',
    (_, line, general, absent) => {
      expect(line.toLowerCase()).not.toContain(general)
      for (const kind of absent) expect(line.toLowerCase()).toContain(kind)
    },
  )
})
