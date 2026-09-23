import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { emptyDocument, EMAIL_NAMES } from '../../shared/cms.ts'
import { defaultEmailTemplate } from '../../supabase/functions/_shared/email.ts'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-reported'
await mkdir(out, { recursive: true })
const results = []
const seed = emptyDocument()
seed.emails = EMAIL_NAMES.flatMap(template => ['sv', 'en'].map(lang => {
  const copy = defaultEmailTemplate(template, lang)
  return { template, lang, subject: copy.subject, preheader: copy.preheader, title: copy.title, intro: copy.intro, section_title: copy.sectionTitle, note: copy.note, cta_label: copy.ctaLabel, contact_lead: copy.contactLead, design: null }
}))

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== engineName) continue
  const browser = await engine.launch()
  let captured
  const check = async (id, run) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' })
    context.setDefaultTimeout(15000)
    const backend = await nativeBackend(context, captured ?? seed)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const shot = async suffix => page.screenshot({ path: `${out}/${engineName}-${id}-${suffix}.png`, animations: 'disabled' })
    try {
      await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
      await page.evaluate(async () => (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
      await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
      const frame = page.frameLocator('.gjs-frame').first()
      await frame.locator('[data-knc-surface="desktop-home"]').waitFor()
      if (!captured) captured = await page.evaluate(async () => (await import('/src/admin/cms/backup.ts')).loadBackup().document)
      const details = await run({ page, frame, shot, backend })
      assert.deepEqual(errors, [], 'no unhandled browser errors')
      results.push({ engine: engineName, id, passed: true, details })
    } catch (error) {
      results.push({ engine: engineName, id, passed: false, error: error.stack, browserErrors: errors })
      await shot('failure').catch(() => { /* Preserve the original failure if the page closed. */ })
    } finally { await context.close() }
  }
  const select = (page, selector) => page.evaluate(async selector => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const component = selector === 'body' ? editor.getWrapper() : editor.getWrapper().find(selector)[0]
    if (!component) throw new Error(`Missing component ${selector}`)
    editor.select(component)
  }, selector)
  const create = async page => {
    await page.getByRole('button', { name: 'Mörk', exact: true }).click()
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Ny sida', exact: true })
    await dialog.getByLabel('Sidnamn', { exact: true }).fill('Reported page')
    await dialog.getByLabel('Adress', { exact: true }).fill('/reported-page')
    await dialog.getByRole('button', { name: 'Skapa sida', exact: true }).click()
    await page.frameLocator('.gjs-frame').getByRole('heading', { name: 'Reported page', exact: true }).waitFor()
  }
  try {
    await check('1-legal-background', async ({ page, frame, shot }) => {
      await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.getByRole('button', { name: 'Mobil', exact: true }).click()
      await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
      await select(page, 'body')
      const colors = await frame.locator('body').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, root: getComputedStyle(node.ownerDocument.documentElement).backgroundColor }))
      await shot('dark')
      assert.notEqual(colors.background, 'rgb(255, 255, 255)', 'dark legal page must not have a white body over its dark root')
      assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)', 'page background is explicit and editable')
      await page.getByRole('button', { name: 'Ljus', exact: true }).click()
      await shot('light')
      return colors
    })
    await check('2-new-page-editability', async ({ page, frame, shot }) => {
      await create(page)
      const controls = await page.evaluate(async () => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const editor = cmsGrapes.editors.at(-1)
        return editor.getWrapper().find('#cms-site-header a, #cms-site-content h1').map(node => ({ tag: node.get('tagName'), id: node.getId(), stylable: node.get('stylable'), draggable: node.get('draggable') }))
      })
      await shot('created')
      assert.ok(controls.length >= 2, 'new page contains real site chrome and authored content')
      assert.ok(controls.every(node => node.stylable !== false && node.draggable !== false), JSON.stringify(controls))
      await select(page, '#cms-site-content h1')
      await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill('Owner edited heading')
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() => globalThis.document.querySelector('.cms-status')?.textContent.includes('Publicerad'))
      await frame.getByRole('heading', { name: 'Owner edited heading', exact: true }).waitFor()
      await shot('edited')
      return controls
    })
    await check('2-device-switch-styles', async ({ page, frame, shot }) => {
      await create(page)
      const snapshots = []
      for (const device of ['Dator', 'Mobil', 'Dator', 'Mobil']) {
        await page.getByRole('button', { name: device, exact: true }).click()
        await page.waitForFunction(width => globalThis.document.querySelector('.gjs-frame').clientWidth === width, device === 'Dator' ? 1440 : 390)
        await frame.getByRole('heading', { name: 'Reported page', exact: true }).waitFor()
        snapshots.push(await frame.locator('#cms-site-shell').evaluate(node => {
          const rect = node.getBoundingClientRect()
          const svg = node.querySelector('svg')
          return { background: getComputedStyle(node).backgroundColor, width: rect.width, svgWidth: svg?.getBoundingClientRect().width, brandColor: getComputedStyle(node.querySelector('#cms-site-header a')).color }
        }))
        await shot(`${snapshots.length}-${device}`)
      }
      assert.ok(snapshots.every(s => s.svgWidth < 240 && s.brandColor !== 'rgb(0, 0, 238)' && s.background !== 'rgba(0, 0, 0, 0)'), JSON.stringify(snapshots))
      return snapshots
    })
    await check('3-activate-email-design', async ({ page, shot }) => {
      await page.getByRole('button', { name: 'Mejl', exact: true }).click()
      const email = page.locator('iframe[title="Mejl som skickas"]')
      await email.waitFor()
      const before = await email.getAttribute('srcdoc')
      await shot('before')
      await page.getByRole('button', { name: 'Aktivera design', exact: true }).click()
      await page.locator('.cms-email-design').waitFor()
      const after = await email.getAttribute('srcdoc')
      await shot('after')
      assert.equal(after, before, 'enabling design controls must preserve the delivered email markup exactly')
    })
    await check('4-booking-scene-insets', async ({ page, frame, shot }) => {
      await page.getByRole('button', { name: 'Bokning', exact: true }).click()
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.getByLabel('Visa i editorn', { exact: true }).selectOption('booking-options')
      const metrics = []
      for (const device of ['Mobil', 'Dator']) {
        await page.getByRole('button', { name: device, exact: true }).click()
        await page.waitForFunction(width => globalThis.document.querySelector('.gjs-frame').clientWidth === width, device === 'Dator' ? 1440 : 390)
        await frame.getByText('Välj en dag', { exact: true }).waitFor()
        const measured = await frame.locator('[data-knc-surface="booking-options"]').evaluate(node => {
          const first = node.firstElementChild.getBoundingClientRect()
          const win = node.ownerDocument.defaultView
          return { left: first.left, top: first.top, right: first.right, width: win.innerWidth, scrollWidth: node.ownerDocument.documentElement.scrollWidth }
        })
        metrics.push({ device, ...measured })
        await shot(device)
      }
      assert.ok(metrics.every(m => m.left >= 16 && m.top >= 16 && m.right <= m.width - 16 && m.scrollWidth <= m.width), JSON.stringify(metrics))
      return metrics
    })
    await check('5-comparison-font-parity', async ({ page, frame, shot }) => {
      await page.getByRole('button', { name: 'Om oss', exact: true }).click()
      await page.getByRole('button', { name: 'Mörk', exact: true }).click()
      await page.getByRole('button', { name: 'Mobil', exact: true }).click()
      const appearance = locator => locator.evaluate(async node => {
        await node.ownerDocument.fonts.ready
        const css = getComputedStyle(node)
        return { family: css.fontFamily, weight: css.fontWeight, size: css.fontSize, loaded: node.ownerDocument.fonts.check(`${css.fontSize} ${css.fontFamily}`), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }
      })
      const expected = await appearance(frame.locator('[data-knc-surface="about"] h2').first())
      await page.getByRole('button', { name: 'Dator', exact: true }).click()
      await page.getByRole('button', { name: 'Jämför', exact: true }).click()
      const comparison = page.frameLocator('iframe[title="Jämförelsevy"]')
      await comparison.locator('[data-knc-surface="about"] h2').first().waitFor()
      const actual = await appearance(comparison.locator('[data-knc-surface="about"] h2').first())
      await shot('comparison')
      assert.deepEqual(actual, expected, 'same viewport must use the same font and text geometry')
      return { expected, actual }
    })
  } finally { await browser.close() }
}
await writeFile(`${out}/reported-results.json`, JSON.stringify(results, null, 2))
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.engine}/${result.id}${result.error ? `\n${result.error}` : ''}`)
assert.equal(results.filter(r => !r.passed).length, 0, 'owner-reported CMS defects remain')
