import type * as ExternalActionsModule from '../../supabase/functions/_shared/externalActions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarConnectButton } from '../../src/admin/calendar/CalendarConnectButton'
import { useCalendarSync } from '../../src/admin/calendar/useCalendarSync'
import { buildAdminStyles } from '../../src/admin/adminStyles'
import { palette } from '../../src/booking/bookingStyles'
import { adminText } from '../../src/i18n/adminStrings'

vi.mock('../../src/admin/calendar/useCalendarSync', () => ({ useCalendarSync: vi.fn() }))

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
})

const dispatch = vi.hoisted(() => ({ rpc: vi.fn(), settle: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: dispatch.rpc }) }))
vi.mock('../../supabase/functions/_shared/externalActions', async (original) => ({
  ...(await original<typeof ExternalActionsModule>()),
  settleExternalAction: dispatch.settle,
}))

describe('Calendar dispatch HTTP boundary', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('dispatches Calendar jobs through the generic dispatcher alone', async () => {
    const id = '54000000-0000-4000-8000-000000000001'
    const token = '54000000-0000-4000-8000-000000000002'
    const action = {
      id,
      dispatch_token: token,
      action_type: 'calendar_event_delete',
      booking_id: id,
      barber_id: 'owner',
      google_event_id: 'event',
      refresh_token: 'refresh',
      calendar_id: 'primary',
    }
    dispatch.rpc.mockReset().mockResolvedValue({ data: action, error: null })
    dispatch.settle.mockReset().mockResolvedValue({ status: 'completed' })
    let handler: ((request: Request) => Promise<Response>) | undefined
    vi.stubGlobal('Deno', {
      env: { get: () => 'unit-config' },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request')
      }),
    )
    await vi.importActual('../../supabase/functions/external-cleanup/index.ts')
    if (!handler) throw new Error('Missing cleanup handler')
    const response = await handler(
      new Request('https://edge.example.test/external-cleanup', {
        method: 'POST',
        headers: { 'x-webhook-secret': 'unit-config' },
        body: JSON.stringify({ action_id: id, dispatch_token: token }),
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: 'completed',
      action: 'calendar_event_delete',
    })
    expect(dispatch.rpc.mock.calls).toEqual([
      ['external_action_for_dispatch', { p_id: id, p_dispatch_token: token }],
    ])
    expect(dispatch.settle).toHaveBeenCalledWith(action, expect.any(Object), expect.any(Object))
    expect(fetch).not.toHaveBeenCalled()
  })
})
