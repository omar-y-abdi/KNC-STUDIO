import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'

// Operation counts make the regressions deterministic across CI runner speeds.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-interaction-latency'
await mkdir(out, { recursive: true })
const engine = process.env.CMS_ENGINE === 'webkit' ? webkit : chromium
const browser = await engine.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await nativeBackend(context)
const page = await context.newPage()
const results = []
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  const frame = page.frameLocator('.gjs-frame').first()
  await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    globalThis.cmsLayerRenders = new Map()
    editor.on('layer:render', ({ component }) => {
      const counts = globalThis.cmsLayerRenders
      counts.set(component.cid, (counts.get(component.cid) ?? 0) + 1)
    })
  })
  for (const name of ['Bokning', 'Startsida']) {
    await page.evaluate(() => globalThis.cmsLayerRenders.clear())
    const start = Date.now()
    await page.locator('.cms-page-list').getByRole('button', { name, exact: true }).click()
    await frame
      .locator(`[data-knc-surface="${name === 'Bokning' ? 'desktop-booking' : 'desktop-home'}"]`)
      .waitFor()
    const result = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      const counts = globalThis.cmsLayerRenders
      const components = editor.getWrapper().find('*')
      // Check current nodes, not the removed page's layer disposal events.
      return {
        maxRenders: Math.max(0, ...components.map((node) => counts.get(node.cid) ?? 0)),
        nodes: components.length,
        svgLayers: components.filter((node) => node.is('svg-in') && node.get('layerable')).length,
      }
    })
    results.push({ action: name, elapsedMs: Date.now() - start, ...result })
  }
  const normalization = await page.evaluate(async () => {
    const { exportNativeCanvas } = await import('/src/admin/cms/nativeCanvas.ts')
    const ids = Array.from({ length: 100 }, (_, index) => `latency-${index}`)
    const original = 'color:rgb(255,0,0);font-size:16px'
    const html = `<div data-knc-native="1">${ids
      .map(
        (id) => `<span id="${id}" data-knc-baseline="{}" data-knc-light="${original}">Text</span>`,
      )
      .join('')}</div>`
    const css = ids.map((id) => `#${id}{${original}}`).join('') + '#latency-99{width:20px}'
    const createElement = document.createElement
    let scratchElements = 0
    document.createElement = function (tag, ...args) {
      if (tag === 'span') scratchElements++
      return createElement.call(this, tag, ...args)
    }
    try {
      const output = exportNativeCanvas(html, css, 'light')
      return { scratchElements, css: output.css, textCount: output.html.match(/>Text</g)?.length }
    } finally {
      document.createElement = createElement
    }
  })
  results.push({ action: 'native-normalization', ...normalization })
  await writeFile(`${out}/interaction-results.json`, JSON.stringify(results, null, 2))
  for (const result of results.filter((item) => item.nodes)) {
    assert.ok(result.svgLayers > 0, 'Native SVG content remains available in Layers')
    assert.ok(
      result.maxRenders <= 2,
      `${result.action}: one import rendered a layer ${result.maxRenders} times`,
    )
  }
  assert.equal(normalization.textCount, 100)
  assert.equal(
    normalization.css,
    Array.from({ length: 100 }, (_, i) => `#latency-${i}{}`).join('') +
      '#latency-99{width:20px!important}',
  )
  assert.ok(
    normalization.scratchElements <= 3,
    `Repeated baseline styles allocated ${normalization.scratchElements} scratch elements`,
  )
  console.log('PASS CMS interaction cost: bounded layer rendering and native normalization')
} finally {
  await writeFile(`${out}/interaction-results.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
