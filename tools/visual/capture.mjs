// Visual-regression capture. Screenshots a running site at every
// device × colour-scheme × language combination into OUT.
//   BASE = url to capture (a served dev or preview build)
//   OUT  = output dir
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { installEmptyCmsPresentation } from '../e2e/public-first-paint.mjs'

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
        await installEmptyCmsPresentation(ctx)
        const page = await ctx.newPage()
        await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const switchToEnglish = page.getByRole('button', {
          name: 'Byt språk till engelska',
          exact: true,
        })
        await switchToEnglish.waitFor({ state: 'visible', timeout: 15000 })
        await page.evaluate(() => globalThis.document.fonts.ready)
        if (lang === 'en') {
          await switchToEnglish.click()
          await page
            .getByRole('button', { name: 'Switch language to Swedish', exact: true })
            .waitFor({ state: 'visible', timeout: 15000 })
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

  console.log('DONE')
} catch (e) {
  console.error('CAPTURE ERROR:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}
