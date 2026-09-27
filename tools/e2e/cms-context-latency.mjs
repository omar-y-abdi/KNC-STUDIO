import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-context-latency'
await mkdir(out, { recursive: true })
const browser = await (process.env.CMS_ENGINE === 'webkit' ? webkit : chromium).launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const backend = await nativeBackend(context)
const page = await context.newPage()
const results = []
page.setDefaultTimeout(15000)
const button = (name) => page.getByRole('button', { name, exact: true })
const measure = async (label, action) => {
  await page.evaluate(() => {
    globalThis.cmsCost = { snapshots: 0, styleReads: 0, creates: 0, exports: 0, parses: 0 }
  })
  const start = Date.now()
  await action()
  // Include deferred dirty-counter callbacks; assertions use counts, not wall time.
  await page.waitForTimeout(250)
  const result = {
    label,
    elapsedMs: Date.now() - start,
    ...(await page.evaluate(() => globalThis.cmsCost)),
  }
  const cssMatches = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { readCanvasCss } = await import('/src/admin/cms/nativeCanvas.ts')
    const editor = cmsGrapes.editors.at(-1)
    return readCanvasCss(editor) === editor.getCss({ keepUnusedStyles: true })
  })
  assert.equal(cssMatches, true, `${label}: complete exported CSS must remain byte-identical`)
  results.push(result)
  return result
}
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  const frame = page.frameLocator('.gjs-frame').first()
  await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
  await button('Publicera').click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    globalThis.cmsCost = { snapshots: 0, styleReads: 0, creates: 0, exports: 0, parses: 0 }
    const parse = globalThis.DOMParser.prototype.parseFromString
    globalThis.DOMParser.prototype.parseFromString = function (...args) {
      globalThis.cmsCost.parses++
      return parse.apply(this, args)
    }
    editor.on('project:get', () => globalThis.cmsCost.snapshots++)
    editor.on('component:create', () => globalThis.cmsCost.creates++)
    const generator = editor.CodeManager.getGenerator('css')
    const build = generator.buildFromModel
    generator.buildFromModel = function (...args) {
      globalThis.cmsCost.styleReads++
      return build.apply(this, args)
    }
    const html = editor.getHtml
    editor.getHtml = function (...args) {
      globalThis.cmsCost.exports++
      return html.apply(this, args)
    }
  })
  await measure('unchanged-view', () => button('SV').click())
  for (const name of ['EN', 'SV', 'Mörk', 'Ljus', 'Mobil', 'Dator'])
    await measure(name, () => button(name).click())
  await frame.getByText('KNC source sv', { exact: true }).first().click()
  await page
    .locator('#cms-inspector')
    .getByLabel('Text', { exact: true })
    .fill('Pending context edit')
  // A synchronous context switch must retain edits before the debounce fires.
  await button('EN').click()
  await button('SV').click()
  await frame.getByText('Pending context edit', { exact: true }).first().waitFor()
  await measure('revert', () => button('Återställ').click())
  await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
  await button('Företag & SEO').click()
  await measure('hidden-canvas:EN', () => button('EN').click())
  await measure('hidden-canvas:SV', () => button('SV').click())
  await button('Tillbaka till sidan').click()
  await frame.getByText('KNC source sv', { exact: true }).first().waitFor()
  await writeFile(`${out}/context-cost.json`, JSON.stringify(results, null, 2))
  for (const result of results) {
    assert.equal(
      result.snapshots,
      0,
      `${result.label}: CMS must not autosave a second GrapesJS project`,
    )
    assert.equal(
      result.styleReads,
      0,
      `${result.label}: full CSS export must not resolve every component style`,
    )
  }
  assert.equal(results.find((row) => row.label === 'unchanged-view').exports, 0)
  for (const row of results.filter((row) => ['Mörk', 'Ljus', 'revert'].includes(row.label)))
    assert.equal(row.creates, 0, `${row.label}: reuse unchanged native structure`)
  for (const row of results.filter((row) => ['Mobil', 'Dator'].includes(row.label)))
    assert.equal(row.creates, 0, `${row.label}: Home already has both device trees`)
  assert.ok(
    results.find((row) => row.label === 'revert').parses < 24,
    'Complete reset must not reparse both copies of every core page',
  )
  for (const result of results.filter((row) => row.label.startsWith('hidden-canvas:')))
    assert.equal(result.creates, 0, `${result.label}: a hidden canvas must not rebuild`)
  assert.equal(backend.writes.filter((operation) => operation === 'publish').length, 1)
  console.log(
    'PASS CMS context switching: no duplicate storage, style scans or hidden rebuilds; immediate edits survive',
  )
} finally {
  await writeFile(`${out}/context-cost.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
