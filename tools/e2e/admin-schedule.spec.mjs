// Admin schedule regressions on the REAL AdminApp: every backend request is intercepted, nothing
// leaves the machine. Covers what the unit tests cannot see — keyboard operation of the day grid,
// the aria-live report of a failed write, the week autosave debounce, and the booking-conflict
// pre-check agreeing with the database (an in-progress booking warns BEFORE any write is sent).
import assert from 'node:assert/strict'
import { test, expect } from './fixtures.mjs'

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4188').replace(/\/$/, '')
const origin = new URL(baseUrl).origin
const BACKEND = 'admin-harness.invalid'

// Monday 08:00 salon-local (CET). Fixed so the day grid has no past quarters and "now" is exact.
const NOW = new Date('2026-10-26T08:00:00+01:00')
const TODAY = '2026-10-26'
const USER = 'cccccccc-0000-4000-8000-000000000001'
const BARBER = 'schedule-barber'
const ROW_ID = 'dddddddd-0000-4000-8000-000000000001'
const OFF_ID = 'dddddddd-0000-4000-8000-000000000002'
const BOOKING_ID = 'eeeeeeee-0000-4000-8000-000000000001'

test.use({ viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/Stockholm' })

function session() {
  const iat = Math.floor(NOW.getTime() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: USER,
      exp: iat + 3600,
      iat,
      role: 'authenticated',
      aud: 'authenticated',
    }),
  ).toString('base64url')
  return {
    access_token: `${header}.${payload}.synthetic-signature`,
    refresh_token: `synthetic-refresh-${USER}`,
    expires_at: iat + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: USER,
      email: 'owner@schedule.invalid',
      aud: 'authenticated',
      role: 'authenticated',
    },
  }
}

const iso = (offsetMin) => new Date(NOW.getTime() + offsetMin * 60_000).toISOString()

/** A confirmed 45-minute booking today that starts `startOffsetMin` minutes from NOW. */
function booking(startOffsetMin) {
  return {
    id: BOOKING_ID,
    barber_id: BARBER,
    service_name: 'Klippning',
    price: 350,
    duration_min: 45,
    start_at: iso(startOffsetMin),
    end_at: iso(startOffsetMin + 45),
    customer_name: 'Åsa Test',
    method: 'phone',
    phone: '0700000001',
    email: null,
    lang: 'sv',
    status: 'confirmed',
  }
}

const weekRows = () =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    barber_id: BARBER,
    weekday,
    working: true,
    start_min: 540,
    end_min: 1080,
  }))

/**
 * Intercepts the whole context: same-origin requests continue, the backend host is answered here,
 * everything else is aborted and recorded (a test fails if anything leaked or was unexpected).
 */
async function installBackend(page, options = {}) {
  const calls = []
  const external = []
  const unexpected = []
  const rpc = (name) => calls.filter((call) => call.path === `/rest/v1/rpc/${name}`)
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(
    (stored) => globalThis.localStorage.setItem('knc-admin-auth', JSON.stringify(stored)),
    session(),
  )
  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin) return route.continue()
    if (url.hostname !== BACKEND) {
      external.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort()
    }
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
      'Content-Type': 'application/json',
    }
    const reply = (body, status = 200) =>
      route.fulfill({ status, headers, body: status === 204 ? undefined : JSON.stringify(body) })
    if (request.method() === 'OPTIONS') return reply(null, 204)
    let body = null
    try {
      body = request.postDataJSON()
    } catch {
      /* GET/DELETE carry no JSON body. */
    }
    const call = { path: url.pathname, method: request.method(), body }
    calls.push(call)
    const get = request.method() === 'GET'
    switch (url.pathname) {
      case '/auth/v1/user':
        return reply(session().user)
      case '/auth/v1/token':
        return reply(session())
      case '/auth/v1/logout':
        return reply(null, 204)
      case '/rest/v1/profiles':
        return reply({
          role: 'owner',
          barber_id: null,
          must_change_password: false,
          account_enabled: true,
        })
      case '/rest/v1/barbers':
        return reply([
          {
            id: BARBER,
            name: 'Schedule Barber',
            ig: '',
            role_sv: 'Barberare',
            role_en: 'Barber',
            bio_sv: '',
            bio_en: '',
            active: true,
            sort_order: 0,
          },
        ])
      case '/rest/v1/barber_schedules':
        return reply(weekRows())
      case '/rest/v1/bookings':
        return reply(options.bookings ?? [])
      case '/rest/v1/barber_time_off':
      case '/rest/v1/barber_recurring_breaks':
      case '/rest/v1/barber_slot_blocks':
      case '/rest/v1/services':
        if (get) return reply([])
        if (request.method() === 'DELETE') return reply(null, 204)
        break
      case '/rest/v1/rpc/admin_save_barber_week':
        return reply({ ok: true })
      case '/rest/v1/rpc/admin_add_slot_block':
        if (options.failSlotBlock) return reply({ message: 'boom', code: 'XX000' }, 500)
        return reply({
          ok: true,
          row: {
            id: ROW_ID,
            barber_id: BARBER,
            block_date: body.p_block_date,
            start_min: body.p_start_min,
            end_min: body.p_end_min,
          },
        })
      case '/rest/v1/rpc/admin_add_time_off':
        // What the database answers: a conflict unless the caller explicitly overrides it.
        if (options.timeOffConflicts && body.p_allow_existing_bookings !== true)
          return reply({ ok: false, error: 'booking_conflict', booking_ids: [BOOKING_ID] })
        return reply({
          ok: true,
          row: {
            id: OFF_ID,
            barber_id: BARBER,
            start_date: body.p_start_date,
            end_date: body.p_end_date,
            reason: body.p_reason,
          },
        })
      default:
        break
    }
    unexpected.push(`${request.method()} ${url.pathname}`)
    return reply({ message: 'Unexpected request in schedule spec' }, 500)
  })
  return { calls, external, unexpected, rpc }
}

async function openSchedule(page) {
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'networkidle' })
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountAdminAppHarness('schedule'),
  )
  await expect(page.getByRole('heading', { name: 'Dagsöversikt' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Blockera hela dagen' })).toBeVisible()
}

/** Press Tab until `isTarget` (evaluated in the page) holds for the focused element. */
async function tabTo(page, isTarget, label, maxPresses = 80) {
  for (let pressed = 1; pressed <= maxPresses; pressed++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate(isTarget)) return pressed
  }
  throw new Error(`Tab never reached ${label} within ${maxPresses} presses`)
}

const focusedIsHourChip = () => {
  const el = globalThis.document.activeElement
  return (
    el instanceof globalThis.HTMLButtonElement &&
    el.hasAttribute('aria-expanded') &&
    el.closest('[aria-labelledby="daygrid-heading"]') !== null
  )
}
const focusedIsOpenQuarterChip = () => {
  const el = globalThis.document.activeElement
  return (
    el instanceof globalThis.HTMLButtonElement &&
    el.getAttribute('aria-pressed') === 'false' &&
    /^Blockera \d{2}:\d{2} \(Ledig\)$/.test(el.getAttribute('aria-label') ?? '')
  )
}

/** Keyboard only: Tab to the first hour chip, Enter to expand it, Tab to its first quarter chip. */
async function reachFirstQuarterChip(page) {
  await tabTo(page, focusedIsHourChip, 'an hour chip')
  await page.keyboard.press('Enter')
  assert.equal(
    await page.evaluate(() => globalThis.document.activeElement?.getAttribute('aria-expanded')),
    'true',
    'Enter did not expand the focused hour chip',
  )
  const presses = await tabTo(page, focusedIsOpenQuarterChip, 'a quarter chip', 3)
  assert.equal(presses, 1, 'the first quarter chip must be the next tab stop after its hour chip')
  return page.getByRole('button', { name: 'Blockera 09:00 (Ledig)', exact: true })
}

const assertClean = (backend) => {
  expect(backend.external, 'requests that left the harness').toEqual([])
  expect(backend.unexpected, 'requests the spec did not expect').toEqual([])
}

test('quarter chip: Tab reaches it and Space toggles aria-pressed', async ({ page }) => {
  const backend = await installBackend(page)
  await openSchedule(page)
  const chip = await reachFirstQuarterChip(page)
  await expect(chip).toHaveAttribute('aria-pressed', 'false')

  await page.keyboard.press('Space')
  const blocked = page.getByRole('button', { name: 'Öppna 09:00', exact: true })
  await expect(blocked).toHaveAttribute('aria-pressed', 'true')
  const [write] = backend.rpc('admin_add_slot_block')
  expect(write.body).toEqual({
    p_barber_id: BARBER,
    p_block_date: TODAY,
    p_start_min: 540,
    p_end_min: 555,
    p_allow_existing_bookings: false,
  })

  await blocked.press('Space')
  await expect(
    page.getByRole('button', { name: 'Blockera 09:00 (Ledig)', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect(
    backend.calls.filter((c) => c.path === '/rest/v1/barber_slot_blocks' && c.method === 'DELETE'),
  ).toHaveLength(1)
  assertClean(backend)
})

test('a failed write is reported in the assertive aria-live region and the chip stays unpressed', async ({
  page,
}) => {
  const backend = await installBackend(page, { failSlotBlock: true })
  await openSchedule(page)
  const chip = await reachFirstQuarterChip(page)

  await page.keyboard.press('Space')
  const live = page.locator('[aria-labelledby="daygrid-heading"] [aria-live="assertive"]')
  await expect(live).toHaveText('Kunde inte spara. Försök igen.')
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  expect(backend.rpc('admin_add_slot_block')).toHaveLength(1)
  assertClean(backend)
})

test('week autosave: a burst of edits is debounced into one save of the final week', async ({
  page,
}) => {
  const backend = await installBackend(page)
  await openSchedule(page)
  const barberSelect = page.getByLabel('Välj barberare att hantera')
  await expect(barberSelect).toBeEnabled()

  await page.getByRole('switch', { name: 'Jobbar Lördag' }).click()
  // Saving state is entered at once and locks the owner's barber switch until the save settles.
  await expect(barberSelect).toBeDisabled()
  await page.waitForTimeout(250)
  expect(backend.rpc('admin_save_barber_week'), 'saved before the debounce elapsed').toHaveLength(0)
  await page.getByRole('switch', { name: 'Jobbar Söndag' }).click()

  await expect.poll(() => backend.rpc('admin_save_barber_week').length).toBe(1)
  await expect(page.getByText('Sparat ✓', { exact: true })).toBeVisible()
  await expect(barberSelect).toBeEnabled()
  await page.waitForTimeout(900)
  const saves = backend.rpc('admin_save_barber_week')
  expect(saves, 'the burst must coalesce into a single save').toHaveLength(1)
  expect(saves[0].body.p_barber_id).toBe(BARBER)
  expect(saves[0].body.p_allow_existing_bookings).toBe(false)
  expect(saves[0].body.p_week.map((day) => [day.weekday, day.working])).toEqual([
    [0, false],
    [1, true],
    [2, true],
    [3, true],
    [4, true],
    [5, true],
    [6, false],
  ])
  assertClean(backend)
})

test('block whole day warns for an in-progress booking before anything is written', async ({
  page,
}) => {
  // Started 10 minutes ago, ends in 35: the database counts it (end_at > now()), so must the client.
  const backend = await installBackend(page, { bookings: [booking(-10)], timeOffConflicts: true })
  await openSchedule(page)

  await page.getByRole('button', { name: 'Blockera hela dagen' }).click()
  await expect(page.getByText('Kunder är bokade', { exact: true })).toBeVisible()
  expect(
    backend.rpc('admin_add_time_off'),
    'the dialog must open from the pre-check, before any write is sent',
  ).toHaveLength(0)

  await page.getByRole('button', { name: 'Ha kvar kunder, blockera resten' }).click()
  await expect(page.getByText('Kunder är bokade', { exact: true })).toBeHidden()
  const writes = backend.rpc('admin_add_time_off')
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toMatchObject({
    p_start_date: TODAY,
    p_end_date: TODAY,
    p_allow_existing_bookings: true,
  })
  assertClean(backend)
})

test('block whole day does not warn for a booking that has already ended', async ({ page }) => {
  // Ended at 07:15, before the 08:00 "now": the database ignores it, so the pre-check must too.
  const backend = await installBackend(page, { bookings: [booking(-90)], timeOffConflicts: true })
  await openSchedule(page)

  await page.getByRole('button', { name: 'Blockera hela dagen' }).click()
  await expect.poll(() => backend.rpc('admin_add_time_off').length).toBe(1)
  await expect(page.getByText('Kunder är bokade', { exact: true })).toBeHidden()
  expect(backend.rpc('admin_add_time_off')[0].body.p_allow_existing_bookings).toBe(false)
  assertClean(backend)
})
