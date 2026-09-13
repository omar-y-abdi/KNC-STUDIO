import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CalendarConnectButton } from '../../src/admin/calendar/CalendarConnectButton'
import { useCalendarSync } from '../../src/admin/calendar/useCalendarSync'
import { buildAdminStyles } from '../../src/admin/adminStyles'
import { palette } from '../../src/booking/bookingStyles'
import { adminText } from '../../src/i18n/adminStrings'

vi.mock('../../src/admin/calendar/useCalendarSync', () => ({ useCalendarSync: vi.fn() }))

const calendarCallback = readFileSync('supabase/functions/calendar-oauth-callback/index.ts', 'utf8')
const calendarBackfill = readFileSync('supabase/functions/_shared/calendarBackfill.ts', 'utf8')
const externalCleanup = readFileSync('supabase/functions/external-cleanup/index.ts', 'utf8')
const deletionOutboxMigration = readFileSync(
  'supabase/migrations/20260813115438_durable_storage_cleanup.sql',
  'utf8',
)
const syncOutboxMigration = readFileSync(
  'supabase/migrations/20260823174500_close_launch_review_findings.sql',
  'utf8',
)
const reassignmentMigration = readFileSync(
  'supabase/migrations/20260902005645_calendar_reassignment_cleanup.sql',
  'utf8',
)
interface RenderedNode {
  readonly type?: unknown
  readonly props?: { readonly children?: unknown; readonly [key: string]: unknown }
}

function elements(node: unknown): readonly RenderedNode[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as RenderedNode
  return [vnode, ...elements(vnode.props?.children)]
}

function content(node: unknown): string {
  if (Array.isArray(node)) return node.map(content).join('')
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''
  return content((node as RenderedNode).props?.children)
}

describe('Calendar external-action ownership', () => {
  it('keeps deletion durable and makes the legacy webhook a sync-queue compatibility path', () => {
    expect(deletionOutboxMigration).toContain('booking_calendar_cleanup_on_status')
    expect(deletionOutboxMigration).toContain('booking_calendar_cleanup_on_delete')
    expect(deletionOutboxMigration).toContain("'calendar_event_delete'")

    expect(syncOutboxMigration).toContain("'calendar_event_sync'")
    expect(syncOutboxMigration).toContain('booking_calendar_sync_on_change')
    expect(calendarCallback).not.toContain("service.rpc('calendar_deletion_context'")
  })

  it('routes OAuth backfill through the durable reassignment state machine', () => {
    expect(calendarCallback).toContain("from '../_shared/calendarBackfill.ts'")
    expect(calendarCallback).toContain(
      'await queueBackfill(service as unknown as CalendarBackfillService',
    )
    expect(calendarCallback).not.toContain('insertEvent(')
    expect(calendarCallback).not.toContain('refreshAccessToken(')
    expect(calendarCallback).not.toContain("service.rpc('calendar_record_event'")
    expect(calendarBackfill).toContain("service.rpc('calendar_backfill_source'")
    expect(calendarBackfill).toContain("service.rpc('queue_calendar_event_sync'")
    expect(calendarBackfill).toContain('mapped_barber_id')
    expect(calendarBackfill).toContain('mapped_calendar_id')
    expect(calendarBackfill).toContain('mapped_google_event_id')
    expect(reassignmentMigration).toContain(
      'perform public.queue_calendar_event_sync(p_booking_id)',
    )
  })

  it('queues cleanup-only sync when a confirmed reassignment has an old map', () => {
    expect(reassignmentMigration).toContain(
      'create or replace function public.queue_calendar_event_sync(p_booking_id uuid)',
    )
    expect(reassignmentMigration).toContain("and b.status = 'confirmed'")
    expect(reassignmentMigration).toContain('from public.calendar_event_map m')
    expect(reassignmentMigration).toContain('m.booking_id = b.id')
    expect(reassignmentMigration).toContain('and t.disconnect_requested_at is null')
  })

  it('repairs blocked sync jobs without sweeping healthy Calendar mappings', () => {
    expect(reassignmentMigration).toContain(
      'create or replace function public.calendar_authorization_owner_for_job',
    )
    expect(reassignmentMigration).toContain(
      'calendar_authorization_owner_for_job(j.action_type, j.payload) = p_barber_id',
    )
    expect(reassignmentMigration).toContain(
      'calendar_authorization_owner_for_job(j.action_type, j.payload) = me.bid',
    )
    expect(reassignmentMigration).toContain('m.barber_id is distinct from b.barber_id')
    expect(reassignmentMigration).toContain("p_action_type = 'calendar_event_sync'")
    expect(reassignmentMigration).toContain('and b.barber_id = p_barber_id')
    expect(reassignmentMigration).toContain('t.google_email is null')
    expect(reassignmentMigration).toContain("pg_catalog.btrim(t.google_email) = ''")
    expect(reassignmentMigration).toContain('v_identity_bound')
    expect(reassignmentMigration).toContain("j.status in ('pending', 'dispatching', 'blocked')")
    const connectedRepairStart = reassignmentMigration.indexOf(
      'if v_token_found and v_disconnect_requested_at is null and v_repair_required then',
    )
    const connectedRepairEnd = reassignmentMigration.indexOf(
      'insert into public.barber_calendar_tokens',
      connectedRepairStart,
    )
    expect(connectedRepairStart).toBeGreaterThan(-1)
    expect(connectedRepairEnd).toBeGreaterThan(connectedRepairStart)
    expect(reassignmentMigration.slice(connectedRepairStart, connectedRepairEnd)).not.toContain(
      'for v_map in',
    )
  })

  it.each([
    { connected: true, disconnectPending: false },
    { connected: false, disconnectPending: true },
  ])('offers reauthorization before ordinary actions for repair state %j', (state) => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const disconnect = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useCalendarSync).mockReturnValue({
      status: {
        ...state,
        repairRequired: true,
        googleEmail: 'barber@example.test',
        lastSyncError: null,
      },
      loading: false,
      busy: false,
      error: null,
      connect,
      disconnect,
      refresh: vi.fn().mockResolvedValue(undefined),
    })
    const tree = CalendarConnectButton({
      s: buildAdminStyles(palette(false), false),
      dark: false,
      lang: 'sv',
    })
    const t = adminText('sv')
    expect(content(tree)).toContain(t.calendarRepairHint)
    expect(content(tree)).not.toContain(t.calendarOpenApp)
    const buttons = elements(tree).filter((node) => node.type === 'button')
    const repair = buttons.find((node) => content(node) === t.calendarRepairAccess)
    expect(repair).toBeDefined()
    expect(repair?.props?.disabled).toBe(false)
    expect(buttons.some((node) => content(node) === t.calendarDisconnect)).toBe(false)
    const onClick = repair?.props?.onClick
    expect(typeof onClick).toBe('function')
    if (typeof onClick === 'function') onClick()
    expect(connect).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('uses the Calendar dispatcher first and falls back to the generic seam only when absent', () => {
    expect(
      externalCleanup.indexOf("service.rpc('calendar_external_action_for_dispatch'"),
    ).toBeGreaterThan(-1)
    expect(externalCleanup.indexOf("service.rpc('external_action_for_dispatch'")).toBeGreaterThan(
      -1,
    )
    expect(externalCleanup).toContain('isMissingCalendarDispatcherError')
    expect(externalCleanup).toContain('calendarContext.data !== null')
  })
})
