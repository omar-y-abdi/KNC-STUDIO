import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { nativeBackend } from './cms-native.mjs'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-workspace'
await mkdir(out, { recursive: true })
const failures = [], records = []
const browser = await chromium.launch()
try {
  for (const width of [1440, 390]) {
    const compact = width < 900
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: compact, isMobile: compact, reducedMotion: 'reduce' })
    await nativeBackend(context)
    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4188/tools/e2e/admin-harness.html?view=cms-studio')
    await page.evaluate(async () => (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    const frame = page.frameLocator('.gjs-frame').first()
    if (compact) {
      await frame.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
      await page.locator('.cms-mobile-tools').getByRole('button', { name: 'Egenskaper', exact: true }).tap()
    } else await frame.getByText('KNC source sv', { exact: true }).first().click()
    const styles = await page.locator('#cms-styles').evaluate(root => ({
      fields: [...root.querySelectorAll('input,select')].filter(n => n.getClientRects().length && !n.disabled).map(n => { const s=getComputedStyle(n);return {label:n.getAttribute('aria-label'),weight:s.fontWeight,color:s.color,background:s.backgroundColor,placeholder:n.getAttribute('placeholder')} }),
      labels: [...root.querySelectorAll('.gjs-sm-label')].filter(n => n.getClientRects().length).map(n => ({text:n.textContent,color:getComputedStyle(n).color})),
      html:root.innerHTML,
    }))
    if (styles.fields.some(n => Number.parseFloat(n.weight) < 400)) failures.push(`${width}: property values inherit illegible thin type`)
    if (styles.labels.some(n => n.color === 'rgb(255, 202, 111)')) failures.push(`${width}: inherited property labels retain dark-theme yellow on paper`)
    await page.getByRole('tab', { name: 'Lägg till', exact: true }).click()
    const blocks = await page.locator('#cms-blocks').evaluate(root => ({
      html: root.outerHTML,
      boxes: [...root.querySelectorAll('.gjs-block')].map(n => ({ ...n.getBoundingClientRect().toJSON(), role:n.getAttribute('role'),tabIndex:n.tabIndex,name:n.getAttribute('aria-label')})),
      display:getComputedStyle(root).display,
    }))
    if (blocks.boxes.length < 2 || Math.abs(blocks.boxes[0].y-blocks.boxes[1].y)>2) failures.push(`${width}: block catalogue wastes half of the inspector`)
    records.push({width,styles,blocks})
    await page.screenshot({ path:`${out}/chrome-${width}-blocks.png` })
    await context.close()
  }
} finally { await browser.close(); await writeFile(`${out}/chrome-contracts.json`,JSON.stringify({failures,records},null,2)) }
assert.deepEqual(failures,[])
