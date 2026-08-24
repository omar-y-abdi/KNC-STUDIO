// Task 2 customer-facing capture. Walks the live-mock preview through the states that changed
// (or ship) with Task 2 §1–§3 + Task 1, at desktop + mobile, and writes PNGs into OUT.
//   BASE = served preview url   OUT = output dir   ONLY = optional comma-filter of shot ids
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8011'
const OUT = process.env.OUT ?? '/tmp/t2shots'
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean)
mkdirSync(OUT, { recursive: true })

const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }

const settle = (page, ms = 600) => page.waitForTimeout(ms)

async function fresh(browser, viewport, scheme) {
  const ctx = await browser.newContext({
    viewport,
    colorScheme: scheme,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('#root > *', { timeout: 15000 })
  await page.evaluate(() => globalThis.document.fonts.ready)
  await settle(page, 500)
  return { ctx, page }
}

/** Drive booking barber→day→service until the §1 service menu paints. */
async function reachServiceMenu(page) {
  await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
  await settle(page, 400)
  await page.getByTestId('booking-barber-option').first().click()
  await settle(page, 400)
  const menuVisible = () =>
    page
      .getByTestId('booking-service-option')
      .first()
      .isVisible()
      .catch(() => false)
  const dayCells = page.locator('button', { hasText: /^\d{1,2}$/ })
  for (let attempt = 0; attempt < 2; attempt++) {
    const n = await dayCells.count()
    for (let i = 0; i < n; i++) {
      try {
        await dayCells.nth(i).click({ timeout: 700 })
      } catch {
        continue
      }
      await page.waitForTimeout(120)
      if (await menuVisible()) return
    }
    // nothing bookable this month → advance a month and retry
    const next = page.locator('button', { has: page.locator('img[alt="next"]') })
    if (await next.count()) {
      await next
        .first()
        .click({ timeout: 700 })
        .catch(() => undefined)
      await settle(page, 300)
    }
  }
  await page.getByTestId('booking-service-option').first().waitFor({ timeout: 5000 })
}

async function openMyBookings(page) {
  await page.getByRole('button', { name: 'Mina bokningar', exact: true }).first().click()
  await settle(page, 500)
}

async function fillMyBookings(page) {
  // Scope to the OPEN dialog: on desktop the About review form also uses this placeholder, so an
  // unscoped `.first()` fills the wrong field and the submit stays disabled.
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('07X XXX XX XX').first().fill('0701234567')
  await dialog.getByRole('button', { name: 'Visa mina bokningar' }).click()
  await page.getByText('Kommande', { exact: true }).first().waitFor({ timeout: 6000 })
  await settle(page, 500)
}

async function openAbout(page) {
  const link = page.getByRole('button', { name: 'Om oss', exact: true }).first()
  if (await link.count()) await link.click()
  else await page.getByText('Om oss', { exact: true }).first().click()
  await settle(page, 600)
}

async function gotoAbout(page) {
  await openAbout(page)
  await page
    .getByText('Barberarna', { exact: true })
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => undefined)
  await settle(page, 400)
}

/** The About HEADING/intro — where §2's font-scale is visible (the stylist cards are further down). */
async function gotoAboutHeading(page) {
  await openAbout(page)
  await page
    .getByText('Hantverk, inte bara en klippning', { exact: false })
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => undefined)
  await settle(page, 400)
}

// shot id -> { devices, schemes, run(page) }
const shots = {
  hero: {
    devices: ['desktop', 'mobile'],
    schemes: ['light', 'dark'],
    run: async () => undefined, // just the landing hero
  },
  'booking-services': {
    devices: ['desktop', 'mobile'],
    schemes: ['light'],
    run: reachServiceMenu,
  },
  'mybookings-lookup': {
    devices: ['desktop'],
    schemes: ['light'],
    run: openMyBookings,
  },
  'mybookings-list': {
    devices: ['desktop', 'mobile'],
    schemes: ['light'],
    run: async (page) => {
      await openMyBookings(page)
      await fillMyBookings(page)
    },
  },
  about: {
    devices: ['desktop'],
    schemes: ['light'],
    run: gotoAbout,
  },
  // Injected states — captured against a bundle rebuilt with a temporarily-patched mock adapter
  // (§2 xl scale / §3 photo), then reverted. Driven via ONLY after each rebuild.
  'home-xl': {
    devices: ['desktop', 'mobile'],
    schemes: ['light'],
    run: async () => undefined,
  },
  'about-xl': {
    devices: ['desktop'],
    schemes: ['light'],
    run: gotoAboutHeading,
  },
  'about-photo': {
    devices: ['desktop', 'mobile'],
    schemes: ['light'],
    run: gotoAbout,
  },
}

const browser = await chromium.launch()
const results = []
try {
  for (const [id, spec] of Object.entries(shots)) {
    if (ONLY.length && !ONLY.includes(id)) continue
    for (const device of spec.devices) {
      for (const scheme of spec.schemes) {
        const viewport = device === 'desktop' ? DESKTOP : MOBILE
        const { ctx, page } = await fresh(browser, viewport, scheme)
        try {
          await spec.run(page)
          const name = `${id}__${device}-${scheme}.png`
          await page.screenshot({ path: `${OUT}/${name}` })
          results.push(name)
          console.log('OK', name)
        } catch (e) {
          console.log('FAIL', `${id}__${device}-${scheme}`, e instanceof Error ? e.message : e)
        } finally {
          await ctx.close()
        }
      }
    }
  }
  console.log('DONE', results.length, 'shots')
} finally {
  await browser.close()
}
