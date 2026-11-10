/* global Request, Response */
// axe-core's WCAG 2.1 A/AA rules on the public surfaces a visitor reaches (checklist items 50, 82).
// Chromium only: the rules read the DOM and ARIA the app renders, the same in every engine.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { loadWorker } from './cms-render.mjs'
import { expect, test } from './fixtures.mjs'
import { publicOrigin } from './origins.mjs'
import { installStoredBackend } from './public-fixtures.mjs'

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)
const WCAG_21_A_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const DOCUMENT_RULES = {
  runOnly: { type: 'tag', values: WCAG_21_A_AA },
  resultTypes: ['violations'],
}
/** The homepage, its privacy notice, /booking and the My bookings dialog. */
const APP_RULES = {
  ...DOCUMENT_RULES,
  // the `color-contrast` rule is disabled on the homepage/booking surfaces because the owner ruled on 2026-11-10 that nothing may change visually; the known contrast failures are listed in the pull request as an open owner decision.
  // the `nested-interactive` rule is disabled on the same surfaces because each mobile stylist card is a `role="button"` holding the stylist's Instagram link (about/AboutSection.tsx), markup the owner froze; it is an open owner decision.
  rules: { 'color-contrast': { enabled: false }, 'nested-interactive': { enabled: false } },
}

const CONSENT_COOKIE = 'bladeblend_storage_preferences'
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]
const HOMEPAGES = [
  {
    lang: 'sv',
    path: '/',
    toggle: 'Byt språk till engelska',
    notice: 'Integritet och lagring',
    preferences: 'Inställningar',
    save: 'Spara val',
  },
  {
    lang: 'en',
    path: '/?lang=en',
    toggle: 'Switch language to Swedish',
    notice: 'Privacy and storage',
    preferences: 'Preferences',
    save: 'Save choices',
  },
]
const HARNESS_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
const PROOF = 'a'.repeat(64)
const HOUR_MS = 3_600_000

async function violationsOf(page, rules) {
  if (!(await page.evaluate(() => 'axe' in globalThis)))
    await page.evaluate(`${AXE_SOURCE}\n;undefined`)
  return page.evaluate(async (options) => {
    const oneLine = (text) => text.replace(/\s+/g, ' ').trim()
    const { violations } = await globalThis.axe.run(globalThis.document, options)
    return violations.flatMap((rule) =>
      rule.nodes.map((node) => ({
        rule: rule.id,
        impact: node.impact ?? rule.impact ?? 'unknown',
        help: rule.help,
        helpUrl: rule.helpUrl,
        // A part of the target is an array when the node sits in a shadow root.
        target: node.target
          .map((part) => (Array.isArray(part) ? part.join(' >>> ') : part))
          .join(' >> '),
        summary: oneLine(node.failureSummary ?? ''),
        html: oneLine(node.html).slice(0, 300),
      })),
    )
  }, rules)
}

/** Each violating node once, with the surfaces that showed it. `report` asserts softly, so a step
 * that threw keeps its own error and the violations found before it are still listed. */
function auditLog() {
  const found = new Map()
  return {
    async audit(page, surface, rules) {
      const nodes = await violationsOf(page, rules)
      test.info().annotations.push({
        type: 'axe',
        description: `${surface}: ${nodes.length} violating node(s)`,
      })
      for (const node of nodes) {
        const key = `${node.rule} ${node.target}`
        const entry = found.get(key) ?? { ...node, surfaces: [] }
        entry.surfaces.push(surface)
        found.set(key, entry)
      }
    },
    report() {
      const lines = [...found.values()].map(
        (node) =>
          `${node.rule} (${node.impact}) at ${node.target} | on: ${node.surfaces.join('; ')} | ` +
          `${node.help} | ${node.summary} | ${node.html} | ${node.helpUrl}`,
      )
      expect
        .soft(lines, 'WCAG 2.1 A/AA violations (axe-core): rule, element, surfaces, why')
        .toEqual([])
    },
  }
}

/** About loads its data once it scrolls into view: the four stored barber cards, a filled track in
 * each of the four gallery rows and no loading line (as visual-stored.spec.mjs waits for it). */
async function loadAbout(page) {
  await page.locator('#om-oss').scrollIntoViewIfNeeded()
  await page.waitForFunction(
    () => {
      const section = globalThis.document.getElementById('om-oss')
      if (section === null) return false
      const cards = section.querySelector('[data-knc-fold="barber-marquee"]')?.children.length
      const tracks = [...section.querySelectorAll('[data-testid="marquee-track"]')]
      return (
        cards === 4 &&
        tracks.length === 4 &&
        tracks.every((track) => track.children.length > 0) &&
        section.querySelector('p[aria-live]') === null
      )
    },
    undefined,
    { timeout: 15_000 },
  )
}

for (const viewport of VIEWPORTS)
  for (const home of HOMEPAGES)
    test(`homepage and privacy notice (${home.lang}, ${viewport.width})`, async ({
      page,
      context,
    }) => {
      const log = auditLog()
      const at = (state) => `${home.path} ${viewport.width}px: ${state}`
      try {
        await page.setViewportSize(viewport)
        // A first visit: no storage choice yet, so the privacy notice is open.
        await installStoredBackend(context)
        await page.goto(`${publicOrigin}${home.path}`)
        await page.getByRole('button', { name: home.toggle, exact: true }).waitFor()
        await page.evaluate(() => globalThis.document.fonts.ready)
        await loadAbout(page)
        const notice = page.getByRole('region', { name: home.notice, exact: true })
        await notice.waitFor()
        await log.audit(page, at('privacy notice'), APP_RULES)
        await notice.getByRole('button', { name: home.preferences, exact: true }).click()
        await page.locator('#functional-storage').waitFor()
        await log.audit(page, at('privacy preferences'), APP_RULES)
        await notice.getByRole('button', { name: home.save, exact: true }).click()
        await notice.waitFor({ state: 'detached' })
        await log.audit(page, at('after the storage choice'), APP_RULES)
      } finally {
        log.report()
      }
    })

for (const viewport of VIEWPORTS)
  test(`booking, every step (sv, ${viewport.width})`, async ({ page, context }) => {
    const log = auditLog()
    const at = (step) => `/booking ${viewport.width}px: ${step}`
    try {
      await page.setViewportSize(viewport)
      // Each step is shown at once instead of fading in, so every audit sees it complete.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      // Monday 14 September 2026, 09:00 in Stockholm: a working day of every stored barber.
      await page.clock.setFixedTime(new Date('2026-09-14T07:00:00Z'))
      await installStoredBackend(context)
      await context.addCookies([{ name: CONSENT_COOKIE, value: 'essential', url: publicOrigin }])
      await context.route('https://admin-harness.invalid/rest/v1/rpc/available_slots*', (route) =>
        route.fulfill({ json: ['10:00', '11:00'], headers: HARNESS_CORS }),
      )
      await context.route('**/api/bookings', (route) =>
        route.fulfill({
          json: { ok: true, booking: { id: '76000000-0000-4000-8000-000000000001' } },
        }),
      )
      await page.goto(`${publicOrigin}/booking`)
      const barber = page.getByTestId('booking-barber-option').first()
      await barber.waitFor()
      await page.evaluate(() => globalThis.document.fonts.ready)
      await log.audit(page, at('barbers'), APP_RULES)
      await barber.click()
      const day = page.getByRole('button', { name: /måndag 14 september 2026/i })
      await day.waitFor()
      await log.audit(page, at('calendar'), APP_RULES)
      await day.click()
      const service = page.getByTestId('booking-service-option').first()
      await service.waitFor()
      await log.audit(page, at('services'), APP_RULES)
      await service.click()
      const time = page.getByRole('button', { name: '10:00', exact: true })
      await time.waitFor()
      await log.audit(page, at('times'), APP_RULES)
      await time.click()
      const details = page.getByRole('dialog')
      await details.waitFor()
      await log.audit(page, at('details'), APP_RULES)
      await details.getByRole('textbox', { name: 'Namn', exact: true }).fill('Test Person')
      // A field's error note sits in its label, so the name grows by the note while it shows.
      const phone = details.getByRole('textbox', { name: /^Telefon/ })
      await phone.fill('123')
      await details.getByRole('textbox', { name: 'E-post', exact: true }).fill('test@example.test')
      const book = details.getByRole('button', { name: 'Boka tid', exact: true })
      await expect(book).toBeEnabled()
      await book.click()
      await expect(phone).toHaveAttribute('aria-invalid', 'true')
      await log.audit(page, at('details with a field error'), APP_RULES)
      await phone.fill('0701234567')
      await book.click()
      await page.getByRole('button', { name: 'Boka en ny tid', exact: true }).waitFor()
      await log.audit(page, at('confirmation'), APP_RULES)
    } finally {
      log.report()
    }
  })

const bookingRow = (id, startAt) => ({
  id,
  barber_id: 'hassan',
  barber_name: 'Hassan',
  service_name: 'Hårklippning',
  price: 350,
  duration_min: 45,
  start_at: startAt,
})

/** This device's bookings: one inside the 24-hour online cancellation window of the default
 * business settings, one far ahead and one past. Upcoming rows are listed soonest first. */
function deviceBookings() {
  const soon = new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + HOUR_MS)
  return {
    ok: true,
    authority: 'device',
    session_proof: PROOF,
    receipt_proof: PROOF,
    bookings: [
      bookingRow('76000000-0000-4000-8000-000000000011', soon.toISOString()),
      bookingRow('76000000-0000-4000-8000-000000000012', '2099-01-01T10:00:00Z'),
      bookingRow('76000000-0000-4000-8000-000000000013', '2020-01-01T10:00:00Z'),
    ],
  }
}

for (const viewport of VIEWPORTS)
  test(`my bookings dialog, every step (sv, ${viewport.width})`, async ({ page, context }) => {
    const log = auditLog()
    const at = (step) => `My bookings ${viewport.width}px: ${step}`
    try {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await installStoredBackend(context)
      await context.addCookies([{ name: CONSENT_COOKIE, value: 'functional', url: publicOrigin }])
      // No device receipt until the lookup is done: the list is refused and the dialog asks for an
      // address. Afterwards the device holds three bookings.
      const gateway = { remembered: false }
      await context.route('**/api/customer-bookings', (route) => {
        const action = route.request().postDataJSON()?.action
        if (action === 'list')
          return route.fulfill({
            json: gateway.remembered ? deviceBookings() : { ok: false, error: 'access_denied' },
          })
        if (action === 'request_access') return route.fulfill({ json: { ok: true } })
        return route.fallback()
      })
      await page.goto(`${publicOrigin}/`)
      await page.evaluate(() => globalThis.document.fonts.ready)
      const open = page.getByRole('button', { name: 'Mina bokningar', exact: true }).first()
      const dialog = page.getByRole('dialog', { name: 'Mina bokningar', exact: true })
      await open.click()
      // The address's error note sits in its label, so the name grows by the note while it shows.
      const email = dialog.getByRole('textbox', { name: /^E-post/ })
      await email.waitFor()
      await log.audit(page, at('lookup'), APP_RULES)
      const send = dialog.getByRole('button', { name: 'Skicka säker länk', exact: true })
      await email.fill('fel')
      await expect(send).toBeEnabled()
      await send.click()
      await expect(email).toHaveAttribute('aria-invalid', 'true')
      await log.audit(page, at('lookup with an invalid address'), APP_RULES)
      await email.fill('kund@example.test')
      await expect(send).toBeEnabled()
      await send.click()
      await dialog.getByText('Om e-postadressen matchar en bokning', { exact: false }).waitFor()
      await log.audit(page, at('link sent'), APP_RULES)
      await dialog.getByRole('button', { name: 'Stäng', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      gateway.remembered = true
      await open.click()
      const rows = dialog.getByRole('button', { name: /Visa detaljer$/ })
      await expect(rows).toHaveCount(2)
      await log.audit(page, at('upcoming bookings'), APP_RULES)
      await rows.nth(1).click()
      const cancel = dialog.getByRole('button', { name: 'Avboka tid', exact: true })
      await cancel.waitFor()
      await log.audit(page, at('booking details'), APP_RULES)
      await cancel.click()
      await dialog.getByRole('button', { name: 'Ja, avboka tid', exact: true }).waitFor()
      await log.audit(page, at('cancel question'), APP_RULES)
      await dialog.getByRole('button', { name: 'Avbryt', exact: true }).click()
      await rows.nth(0).click()
      await dialog.getByText('Tidsgränsen för avbokning online', { exact: false }).waitFor()
      await log.audit(page, at('past the online cancellation deadline'), APP_RULES)
      await dialog.getByRole('button', { name: 'Visa tidigare bokningar', exact: true }).click()
      await expect(rows).toHaveCount(3)
      await log.audit(page, at('earlier bookings'), APP_RULES)
    } finally {
      log.report()
    }
  })

const DOCUMENTS = [
  { path: '/no-such-page', label: 'not found (app)' },
  { path: '/404.html', label: 'public/404.html' },
  { path: '/500.html', label: 'public/500.html' },
  { path: '/maintenance.html', label: 'public/maintenance.html' },
  { path: '/contact', label: '/contact (Worker, static fallback)' },
]
const CONTACT_FILE = readFileSync(new URL('../../public/contact.html', import.meta.url), 'utf8')

/** The deployed files as the Worker reads them for /contact: public/contact.html, and nothing else. */
const contactAssets = (unexpected) => ({
  async fetch(input) {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input))
    if (pathname === '/contact.html')
      return new Response(CONTACT_FILE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    unexpected.push(pathname)
    return new Response('Not found', { status: 404 })
  },
})

test.describe('documents', () => {
  let rendering
  test.beforeAll(async () => {
    rendering = await loadWorker()
  })
  test.afterAll(async () => rendering?.close())

  test('status pages and contact, both colour schemes', async ({ page, context }) => {
    const log = auditLog()
    const unexpected = []
    try {
      await installStoredBackend(context)
      await context.addCookies([{ name: CONSENT_COOKIE, value: 'essential', url: publicOrigin }])
      // /contact as production answers it while the publication cannot be read: the real Worker
      // with no database configured renders public/contact.html. Nothing is fetched.
      await page.route(
        (url) => url.origin === publicOrigin && url.pathname === '/contact',
        async (route) => {
          const { pathname, search } = new URL(route.request().url())
          const env = { ASSETS: contactAssets(unexpected) }
          const response = await rendering.worker.default.fetch(
            new Request(`https://bladeblendstudio.se${pathname}${search}`, {
              headers: { Accept: route.request().headers()['accept'] ?? 'text/html' },
            }),
            env,
            {
              exports: {
                PublicContent: {
                  fetch: (request) => new rendering.worker.PublicContent({}, env).fetch(request),
                },
              },
            },
          )
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          })
        },
      )
      for (const scheme of ['light', 'dark'])
        for (const { path, label } of DOCUMENTS) {
          await page.emulateMedia({ colorScheme: scheme })
          const response = await page.goto(`${publicOrigin}${path}`)
          expect(response?.status(), `${label}: status`).toBe(200)
          await page.locator('h1').first().waitFor()
          await page.evaluate(() => globalThis.document.fonts.ready)
          await log.audit(page, `${label} (${scheme})`, DOCUMENT_RULES)
        }
      expect(unexpected, 'files the Worker read beyond public/contact.html').toEqual([])
    } finally {
      log.report()
    }
  })
})
