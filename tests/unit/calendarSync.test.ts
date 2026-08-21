// Unit tests for the pure calendar-SYNC logic:
//   - signState / verifyState (the OAuth `state` HMAC — security-critical) from the shared edge module,
//   - buildEvent (booking -> Google event mapping),
//   - parseCalendarStatus (the RPC boundary parser).
// The shared module uses only Web-standard globals (crypto.subtle, TextEncoder/atob), so it imports
// cleanly in Node/vitest as well as in the Deno edge runtime.

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEvent,
  googleEventId,
  GoogleHttpError,
  insertEvent,
  isTransientGoogleError,
  revokeToken,
  signState,
  verifyState,
  withGoogleRetry,
} from '../../supabase/functions/_shared/calendar'
import { parseCalendarStatus } from '../../src/admin/calendar/status'

const SECRET = 'unit-test-state-secret'
const NOW_MS = 1_700_000_000_000
const NOW_SEC = NOW_MS / 1000

describe('signState / verifyState', () => {
  it('round-trips a valid payload', async () => {
    const token = await signState({ barber_id: 'hassan', iat: NOW_SEC }, SECRET)
    const payload = await verifyState(token, SECRET, 600, NOW_MS)
    expect(payload).not.toBeNull()
    expect(payload?.barber_id).toBe('hassan')
  })

  it('rejects a tampered signature', async () => {
    const token = await signState({ barber_id: 'hassan', iat: NOW_SEC }, SECRET)
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    expect(await verifyState(tampered, SECRET, 600, NOW_MS)).toBeNull()
  })

  it('rejects a tampered body (id swap)', async () => {
    const token = await signState({ barber_id: 'hassan', iat: NOW_SEC }, SECRET)
    const forged = await signState({ barber_id: 'victor', iat: NOW_SEC }, SECRET)
    // Splice hassan's signature onto victor's body — the HMAC must not validate.
    const body = forged.split('.')[0]
    const sig = token.split('.')[1]
    expect(await verifyState(`${body}.${sig}`, SECRET, 600, NOW_MS)).toBeNull()
  })

  it('rejects a wrong secret', async () => {
    const token = await signState({ barber_id: 'hassan', iat: NOW_SEC }, SECRET)
    expect(await verifyState(token, 'other-secret', 600, NOW_MS)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = await signState({ barber_id: 'hassan', iat: NOW_SEC }, SECRET)
    expect(await verifyState(token, SECRET, 600, NOW_MS + 601_000)).toBeNull()
  })

  it('rejects a malformed token', async () => {
    expect(await verifyState('not-a-token', SECRET, 600, NOW_MS)).toBeNull()
    expect(await verifyState('a.b.c', SECRET, 600, NOW_MS)).toBeNull()
  })

  it('preserves return_to when present', async () => {
    const token = await signState(
      { barber_id: 'victor', iat: NOW_SEC, return_to: 'https://app.example' },
      SECRET,
    )
    const payload = await verifyState(token, SECRET, 600, NOW_MS)
    expect(payload?.return_to).toBe('https://app.example')
  })
})

describe('buildEvent', () => {
  const base = {
    service_name: 'Skägg & puts',
    customer_name: 'Omar',
    phone: '0701234567',
    start_at: '2026-07-24T12:00:00+00:00',
    end_at: '2026-07-24T12:30:00+00:00',
  }

  it('maps summary, description, time, timezone and reminder', () => {
    const e = buildEvent(base)
    expect(e.summary).toBe('Omar — Skägg & puts')
    expect(e.description).toContain('Kund: Omar')
    expect(e.description).not.toContain('0701234567')
    expect(e.description).not.toContain('Telefon')
    expect(e.description).toContain('Tjänst: Skägg & puts')
    expect(e.start).toEqual({ dateTime: base.start_at, timeZone: 'Europe/Stockholm' })
    expect(e.end).toEqual({ dateTime: base.end_at, timeZone: 'Europe/Stockholm' })
    expect(e.reminders.useDefault).toBe(false)
    expect(e.reminders.overrides[0]).toEqual({ method: 'popup', minutes: 30 })
  })

  it('never includes contact details in the event', () => {
    const e = buildEvent({ ...base, phone: null })
    expect(e.description).not.toContain('Telefon')
  })
})

describe('public Calendar privacy disclosure', () => {
  const privacy = readFileSync(
    new URL('../../public/privacy.html', import.meta.url),
    'utf8',
  ).replace(/\s+/g, ' ')

  it('matches minimized event content and durable disconnect cleanup', () => {
    expect(privacy).toContain('kundens namn, behandling och bokad tid')
    expect(privacy).toContain("customer's name, service, and appointment time")
    expect(privacy).toContain('Telefonnummer och e-post skrivs inte till Google Calendar')
    expect(privacy).toContain(
      'Phone numbers and email addresses are not written to Google Calendar',
    )
    expect(privacy).toContain('refresh token behålls endast under')
    expect(privacy).toContain('refresh token is retained only during this')
    expect(privacy).not.toContain('Kalenderhändelser som redan skapats ligger kvar')
    expect(privacy).not.toContain('Calendar events already created remain')
  })
})

describe('idempotent event insertion', () => {
  afterEach(() => vi.unstubAllGlobals())

  const bookingId = '4d3f88f7-5e08-4d03-abfa-9604816f5614'
  const eventId = 'bbs4d3f88f75e084d03abfa9604816f5614'
  const event = buildEvent({
    service_name: 'Klippning',
    customer_name: 'Omar',
    phone: '0701234567',
    start_at: '2026-07-24T12:00:00+00:00',
    end_at: '2026-07-24T12:30:00+00:00',
  })

  it('derives a stable Google-compatible id from the booking UUID', () => {
    expect(googleEventId(bookingId)).toBe(eventId)
    expect(() => googleEventId('not-a-uuid')).toThrow('invalid booking id')
  })

  it('sends the stable id in the insert body', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: eventId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(insertEvent('token', 'primary', eventId, event)).resolves.toBe(eventId)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ id: eventId, summary: event.summary })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('treats duplicate-id 409 as idempotent success', async () => {
    vi.stubGlobal('fetch', async () => new Response('duplicate', { status: 409 }))
    await expect(insertEvent('token', 'primary', eventId, event)).resolves.toBe(eventId)
  })
})

describe('parseCalendarStatus', () => {
  it('parses a connected row', () => {
    expect(
      parseCalendarStatus({ connected: true, google_email: 'a@b.se', last_sync_error: null }),
    ).toEqual({
      connected: true,
      disconnectPending: false,
      repairRequired: false,
      googleEmail: 'a@b.se',
      lastSyncError: null,
    })
  })

  it('defaults to disconnected on junk', () => {
    expect(parseCalendarStatus(null)).toEqual({
      connected: false,
      disconnectPending: false,
      repairRequired: false,
      googleEmail: null,
      lastSyncError: null,
    })
    expect(parseCalendarStatus({ connected: 'yes' })).toEqual({
      connected: false,
      disconnectPending: false,
      repairRequired: false,
      googleEmail: null,
      lastSyncError: null,
    })
  })

  it('parses durable disconnect state', () => {
    expect(parseCalendarStatus({ connected: false, disconnect_pending: true })).toMatchObject({
      connected: false,
      disconnectPending: true,
      repairRequired: false,
    })
  })

  it('parses a disconnect that requires same-account reauthorization', () => {
    expect(
      parseCalendarStatus({
        connected: false,
        disconnect_pending: true,
        repair_required: true,
        google_email: 'barber@example.test',
      }),
    ).toMatchObject({
      connected: false,
      disconnectPending: true,
      repairRequired: true,
      googleEmail: 'barber@example.test',
    })
  })

  it('carries a sync error string', () => {
    expect(parseCalendarStatus({ connected: true, last_sync_error: 'boom' }).lastSyncError).toBe(
      'boom',
    )
  })
})

describe('isTransientGoogleError', () => {
  it('treats 429 and 5xx as transient', () => {
    expect(isTransientGoogleError(new GoogleHttpError(429, 'x', ''))).toBe(true)
    expect(isTransientGoogleError(new GoogleHttpError(500, 'x', ''))).toBe(true)
    expect(isTransientGoogleError(new GoogleHttpError(503, 'x', ''))).toBe(true)
  })
  it('treats a Calendar-API cold-start 403 as transient, other 403s as permanent', () => {
    expect(
      isTransientGoogleError(
        new GoogleHttpError(403, 'x', '{"error":{"status":"SERVICE_DISABLED"}}'),
      ),
    ).toBe(true)
    expect(isTransientGoogleError(new GoogleHttpError(403, 'x', 'plain forbidden'))).toBe(false)
  })
  it('treats other 4xx and non-Google errors as permanent', () => {
    expect(isTransientGoogleError(new GoogleHttpError(400, 'x', ''))).toBe(false)
    expect(isTransientGoogleError(new GoogleHttpError(404, 'x', ''))).toBe(false)
    expect(isTransientGoogleError(new Error('boom'))).toBe(false)
    expect(isTransientGoogleError(null)).toBe(false)
  })
})

describe('withGoogleRetry', () => {
  const noSleep = (): Promise<void> => Promise.resolve()

  it('returns the value without retrying on success', async () => {
    let calls = 0
    const out = await withGoogleRetry(
      async () => {
        calls++
        return 'ok'
      },
      { retries: 3, delayMs: 1, sleep: noSleep },
    )
    expect(out).toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries a transient failure then succeeds', async () => {
    let calls = 0
    const out = await withGoogleRetry(
      async () => {
        calls++
        if (calls < 3) throw new GoogleHttpError(503, 'down', '')
        return 'recovered'
      },
      { retries: 3, delayMs: 1, sleep: noSleep },
    )
    expect(out).toBe('recovered')
    expect(calls).toBe(3)
  })

  it('does NOT retry a non-transient failure', async () => {
    let calls = 0
    await expect(
      withGoogleRetry(
        async () => {
          calls++
          throw new GoogleHttpError(400, 'bad', '')
        },
        { retries: 3, delayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('bad: 400')
    expect(calls).toBe(1)
  })

  it('rethrows the last error after exhausting retries', async () => {
    let calls = 0
    await expect(
      withGoogleRetry(
        async () => {
          calls++
          throw new GoogleHttpError(500, 'down', '')
        },
        { retries: 2, delayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('down: 500')
    expect(calls).toBe(3) // initial + 2 retries
  })
})

describe('revokeToken', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns true when Google responds 2xx', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }))
    expect(await revokeToken('tok')).toBe(true)
  })

  it('treats an already-invalid token as the desired idempotent state', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad', { status: 400 }))
    expect(await revokeToken('tok')).toBe(true)
  })

  it('returns false on a retryable server failure', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad', { status: 503 }))
    expect(await revokeToken('tok')).toBe(false)
  })

  it('returns false when the request throws', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network')
    })
    expect(await revokeToken('tok')).toBe(false)
  })
})
