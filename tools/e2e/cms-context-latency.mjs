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
    globalThis.cmsCost = {
      snapshots: 0,
      styleReads: 0,
      creates: 0,
      exports: 0,
      parses: 0,
      cssParses: 0,
      ruleAdds: 0,
    }
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
  assert.equal(
    await frame.locator('#cms-canvas-behavior').count(),
    1,
    'Preview behavior must survive GrapesJS initial frame/head rendering',
  )
  await button('Publicera').click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
  // Normal-motion device changes must not keep moving the page's click targets.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  for (const [name, width, height] of [
    ['Mobil', 390, 844],
    ['Dator', 1440, 900],
  ]) {
    await page.evaluate(() => {
      const win = globalThis.document.querySelector('.gjs-frame').contentWindow
      globalThis.deviceSizes = []
      globalThis.recordDeviceSize = () =>
        globalThis.deviceSizes.push([win.innerWidth, win.innerHeight])
      win.addEventListener('resize', globalThis.recordDeviceSize)
    })
    await button(name).click()
    await page.waitForFunction(
      ([width, height]) => {
        const win = globalThis.document.querySelector('.gjs-frame').contentWindow
        return win.innerWidth === width && win.innerHeight === height
      },
      [width, height],
    )
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
        ),
    )
    const sizes = await page.evaluate(() => {
      globalThis.document
        .querySelector('.gjs-frame')
        .contentWindow.removeEventListener('resize', globalThis.recordDeviceSize)
      return globalThis.deviceSizes
    })
    assert.ok(sizes.length > 0, `${name}: the actual iframe viewport changed`)
    assert.deepEqual(
      [...new Set(sizes.map((size) => size.join('x')))],
      [`${width}x${height}`],
      `${name}: device change must not animate through transient page layouts`,
    )
  }
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    globalThis.cmsCost = {
      snapshots: 0,
      styleReads: 0,
      creates: 0,
      exports: 0,
      parses: 0,
      cssParses: 0,
      ruleAdds: 0,
    }
    const parse = globalThis.DOMParser.prototype.parseFromString
    globalThis.DOMParser.prototype.parseFromString = function (...args) {
      globalThis.cmsCost.parses++
      return parse.apply(this, args)
    }
    const parseCss = editor.Parser.parseCss
    editor.Parser.parseCss = function (...args) {
      globalThis.cmsCost.cssParses++
      return parseCss.apply(this, args)
    }
    editor.on('project:get', () => globalThis.cmsCost.snapshots++)
    editor.on('component:create', () => globalThis.cmsCost.creates++)
    editor.Css.getAll().on('add', () => globalThis.cmsCost.ruleAdds++)
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
  const patchContract = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { updateNativeCanvas } = await import('/src/admin/cms/updateCanvas.ts')
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const isolated = cmsGrapes.init({
      container: host,
      storageManager: false,
      avoidInlineStyle: true,
    })
    isolated.Storage.setAutosave(false)
    try {
      const original =
        '<div data-knc-native="1"><p id="copy" data-knc-source="copy" title="old" class="old">Original</p><small>Stable unlabelled text</small><img id="photo" data-knc-source="photo" src="/old.png"></div>'
      isolated.setComponents(original)
      const copy = isolated.Components.getById('copy')
      const next = original
        .replace(' title="old"', '')
        .replace('class="old"', 'class="new"')
        .replace('Original', 'Changed &amp; literal')
        .replace('/old.png', '/new.png')
      const css = isolated.Parser.parseCss(
        '#copy{color:blue}.unused{width:12px}@media(max-width:600px){#copy{font-size:18px}}',
      )
      const reused = updateNativeCanvas(isolated, next, css)
      const roundtrip =
        updateNativeCanvas(isolated, original, css) && updateNativeCanvas(isolated, next, css)
      const content = isolated.getHtml({ cleanId: false })
      const sameModel = copy === isolated.Components.getById('copy')
      const policyChange = updateNativeCanvas(
        isolated,
        next.replace('data-knc-source="copy"', 'data-knc-source="copy" data-knc-required="true"'),
        css,
      )
      const beforeUnsupported = content
      const structural = updateNativeCanvas(
        isolated,
        next.replace('<p ', '<section ').replace('</p>', '</section>'),
        css,
      )
      return {
        reused,
        roundtrip,
        policyChange,
        sameModel,
        structural,
        unchangedOnFallback: isolated.getHtml({ cleanId: false }) === beforeUnsupported,
        image: isolated.Components.getById('photo').get('src'),
        exportedImage: content.includes('src="/new.png"'),
        text: content.includes('Changed &amp; literal'),
        removedTitle: !content.includes('title="old"'),
        classes: copy.getClasses(),
        css: isolated.getCss({ keepUnusedStyles: true }),
      }
    } finally {
      isolated.destroy()
      host.remove()
    }
  })
  assert.equal(patchContract.reused, true)
  assert.equal(patchContract.roundtrip, true)
  assert.equal(patchContract.sameModel, true)
  assert.equal(patchContract.policyChange, false)
  assert.equal(patchContract.structural, false)
  assert.equal(patchContract.unchangedOnFallback, true)
  assert.equal(patchContract.image, '/new.png')
  assert.equal(patchContract.exportedImage, true)
  assert.equal(patchContract.text, true)
  assert.equal(patchContract.removedTitle, true)
  assert.deepEqual(patchContract.classes, ['new'])
  assert.match(patchContract.css, /unused/)
  assert.match(patchContract.css, /max-width:\s*600px/)
  await measure('unchanged-view', () => button('SV').click())
  for (const name of ['EN', 'SV', 'Mörk', 'Ljus', 'Mobil', 'Dator'])
    await measure(name, () => button(name).click())
  for (const name of ['EN', 'SV', 'Mörk', 'Ljus']) {
    const cost = await measure(`repeated:${name}`, () => button(name).click())
    assert.equal(cost.cssParses, 0, 'Unchanged contexts must not compile their stylesheet again')
  }
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
  await button('Lås vy').click()
  await page.locator('.cms-live-preview[aria-busy="false"]').waitFor()
  await measure('hidden-canvas:locked-EN', () => button('EN').click())
  await measure('hidden-canvas:locked-SV', () => button('SV').click())
  await button('Lås upp').click()
  await button('Historik').click()
  const restored = await measure('history:restore', () =>
    button('Återställ till utkast').first().click(),
  )
  assert.ok(restored.parses < 24, 'Complete history snapshots do not require legacy repairs')
  await button('Bokning').click()
  for (const scene of ['booking-options', 'booking-details', 'booking-confirmation', 'default']) {
    const cost = await measure(`scene:${scene}`, () =>
      page.getByLabel('Visa i editorn', { exact: true }).selectOption(scene),
    )
    assert.equal(cost.creates, 0, 'Scene changes must reuse the stored stage models')
    for (const stage of ['booking-options', 'booking-details', 'booking-confirmation'])
      assert.equal(await frame.locator(`[data-knc-surface="${stage}"]`).count(), 1)
  }
  await button('Skapa ny sida').click()
  const create = page.getByRole('dialog', { name: 'Ny sida', exact: true })
  await create.getByLabel('Sidnamn', { exact: true }).fill('Context test')
  await create.getByLabel('Adress', { exact: true }).fill('/context-test')
  await create.getByRole('button', { name: 'Skapa sida', exact: true }).click()
  await frame.getByRole('heading', { name: 'Context test', exact: true }).waitFor()
  for (const name of ['Mörk', 'Ljus', 'EN', 'SV']) {
    const cost = await measure(`authored:${name}`, () => button(name).click())
    assert.equal(
      cost.ruleAdds,
      0,
      'Compiled styles must load as one collection, not per-rule live DOM insertions',
    )
    await frame.getByRole('heading', { name: 'Context test', exact: true }).waitFor()
  }
  for (const name of ['Mörk', 'Ljus', 'EN', 'SV']) {
    const cost = await measure(`authored-repeat:${name}`, () => button(name).click())
    assert.equal(
      cost.cssParses,
      0,
      'Independent page contexts must reuse unchanged compiled styles',
    )
  }
  const metadata = await measure('authored:metadata', () =>
    page.locator('.cms-page-meta').getByLabel('Namn', { exact: true }).fill('New navigation label'),
  )
  assert.equal(metadata.creates, 0)
  assert.equal(
    metadata.cssParses,
    0,
    'Independent page metadata does not change its authored canvas',
  )
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
