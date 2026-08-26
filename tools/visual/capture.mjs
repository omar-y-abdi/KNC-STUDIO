// Visual-regression capture. Screenshots a running site at every
// device × colour-scheme × language combination into OUT.
//   BASE = url to capture (a served dev or preview build)
//   OUT  = output dir
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8011'
const OUT = process.env.OUT ?? '/tmp/shots'
mkdirSync(OUT, { recursive: true })

const viewports = [
  { device: 'desktop', w: 1280, h: 900 },
  { device: 'mobile', w: 390, h: 844 },
]
const schemes = ['light', 'dark']
const langs = ['sv', 'en']

const browser = await chromium.launch()
try {
  for (const v of viewports) {
    for (const scheme of schemes) {
      for (const lang of langs) {
        const ctx = await browser.newContext({
          viewport: { width: v.w, height: v.h },
          colorScheme: scheme,
          deviceScaleFactor: 2,
          reducedMotion: 'reduce',
        })
        // Homepage baselines represent a visitor who has already rejected optional storage.
        // The no-choice banner has its own baseline after the regular homepage variants.
        await ctx.addCookies([
          {
            name: 'bladeblend_storage_preferences',
            value: 'essential',
            url: BASE,
            sameSite: 'Lax',
          },
        ])
        const page = await ctx.newPage()
        await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForSelector('#root > :first-child', { timeout: 15000 })
        await page.evaluate(() => globalThis.document.fonts.ready)
        if (lang === 'en') {
          await page.getByRole('button', { name: 'EN', exact: true }).first().click()
          await page.waitForTimeout(500)
        }
        await page.waitForTimeout(700) // let fonts + entry transitions settle
        const name = `${v.device}-${scheme}-${lang}.png`
        await page.screenshot({ path: `${OUT}/${name}` })
        console.log('captured', name)
        await ctx.close()
      }
    }
  }

  const privacyContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  const privacyPage = await privacyContext.newPage()
  await privacyPage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await privacyPage.waitForSelector('#root > :first-child', { timeout: 15000 })
  await privacyPage.evaluate(() => globalThis.document.fonts.ready)
  await privacyPage.screenshot({ path: `${OUT}/privacy-banner-desktop-light-sv.png` })
  console.log('captured privacy-banner-desktop-light-sv.png')
  await privacyContext.close()
  console.log('DONE')
} catch (e) {
  console.error('CAPTURE ERROR:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}
