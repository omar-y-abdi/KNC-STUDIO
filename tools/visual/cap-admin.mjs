// Capture the admin panel for design review: login page, owner views (bookings/schedule/barbers/
// about) on desktop, barber views on mobile. Requires the app served WITH the live local-stack env
// (so sign-in works) and the seeded test users present.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const OUT = process.env.OUT ?? '/tmp/admin-shots'
mkdirSync(OUT, { recursive: true })

const OWNER = { email: 'owner.it@knc.test', pw: 'owner-it-pw-12345' }
const BARBER = { email: 'barber.it@knc.test', pw: 'barber-it-pw-12345' }

async function login(page, who) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.fill('#admin-email', who.email)
  await page.fill('#admin-password', who.pw)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForTimeout(2800) // sign-in + profile resolve + first view load
}
async function tab(page, name, file) {
  const b = page.getByRole('button', { name }).first()
  if (await b.count()) {
    await b.click()
    await page.waitForTimeout(1600)
    await page.screenshot({ path: `${OUT}/${file}` })
  }
}

const browser = await chromium.launch()
try {
  // 1. Login page (light + dark)
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: scheme, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/login-${scheme}.png` })
    await ctx.close()
  }

  // 2. Owner, desktop, dark
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await login(page, OWNER)
    await page.screenshot({ path: `${OUT}/owner-bookings.png` })
    await tab(page, 'Mitt schema', 'owner-schedule.png')
    await tab(page, 'Barberare', 'owner-barbers.png')
    await tab(page, 'Om oss', 'owner-about.png')
    await tab(page, 'Alla bokningar', 'owner-allbookings.png')
    await ctx.close()
  }

  // 3. Owner, desktop, light (schedule — the layered editor)
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await login(page, OWNER)
    await tab(page, 'Mitt schema', 'owner-schedule-light.png')
    await ctx.close()
  }

  // 4. Barber, mobile, dark
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await login(page, BARBER)
    await page.screenshot({ path: `${OUT}/barber-mobile-bookings.png` })
    await tab(page, 'Mitt schema', 'barber-mobile-schedule.png')
    await ctx.close()
  }
  console.log('DONE')
} catch (e) {
  console.error('ERR', e instanceof Error ? e.stack : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}
