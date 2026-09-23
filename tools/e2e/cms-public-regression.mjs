import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
import { emptyDocument } from '../../shared/cms.ts'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
    })
    context.setDefaultTimeout(15000)
    const seed = emptyDocument()
    if (process.env.CMS_PRESENTATION_FILE)
      seed.presentation = JSON.parse(
        fs
          .readFileSync(process.env.CMS_PRESENTATION_FILE, 'utf8')
          .replaceAll('https://soktgawvexeumqvtyhda.supabase.co', 'https://admin-harness.invalid'),
      ).presentation
    const backend = await nativeBackend(context, seed)
    const page = await context.newPage()
    const check = async (mode) => {
      await page.waitForFunction(
        (mode) => globalThis.document.documentElement.style.colorScheme === mode,
        mode,
      )
      return page.evaluate(() => ({
        scheme: globalThis.getComputedStyle(globalThis.document.documentElement).colorScheme,
        body: globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
        html: globalThis.getComputedStyle(globalThis.document.documentElement).backgroundColor,
        meta: globalThis.document.querySelector('meta[name="theme-color"]').content,
      }))
    }
    await page.goto(base + '/?mode=dark')
    assert.equal((await check('dark')).body, 'rgb(36, 36, 39)')
    await page.getByRole('button', { name: 'Växla ljust/mörkt' }).click()
    assert.equal((await check('light')).body, 'rgb(244, 243, 240)')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(base + '/tools/e2e/admin-harness.html?view=cms-studio')
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    // Exercise actual native export/composition repeatedly, including the already-published shape.
    const result = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { stripComposedCanvas } = await import('/src/admin/cms/composedCanvas.ts')
      const { exportNativeCanvas } = await import('/src/admin/cms/nativeCanvas.ts')
      const editor = cmsGrapes.editors.at(-1)
      const first = exportNativeCanvas(
        editor.getHtml({ cleanId: false }),
        editor.getCss({ keepUnusedStyles: true }),
        'light',
      )
      const clean = stripComposedCanvas(first.html, first.css)
      const repeated = stripComposedCanvas(clean.html, clean.css)
      return {
        bytes: first.html.length + first.css.length,
        cleanBytes: clean.html.length + clean.css.length,
        stable: JSON.stringify(clean) === JSON.stringify(repeated),
        html: clean.html,
        css: clean.css,
      }
    })
    assert.ok(
      result.cleanBytes < result.bytes,
      'Derived About trees must not be persisted into Home',
    )
    assert.ok(result.stable, 'Repeated export must not accumulate preview CSS')
    assert.ok(!result.css.includes('#preview-shared-'))
    let firstPublishedBytes
    for (let round = 1; round <= 3; round++) {
      if (round > 1) {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(base + '/tools/e2e/admin-harness.html?view=cms-studio')
        await page.evaluate(async () =>
          (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
        )
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
      }
      await page.getByRole('button', { name: 'Mobil', exact: true }).click()
      const frame = page.frameLocator('.gjs-frame').first()
      const surface = frame.locator('[data-knc-surface="mobile-home"]')
      await surface.waitFor({ state: 'visible' })
      const id = await surface.evaluate(
        (root) =>
          [...root.querySelectorAll('[data-knc-source]')].find(
            (node) =>
              ['DIV', 'P', 'SPAN'].includes(node.tagName) &&
              !node.closest('[data-knc-slot]') &&
              !node.hasAttribute('data-knc-required') &&
              [...node.childNodes].some(
                (child) => child.nodeType === 3 && child.textContent.trim(),
              ) &&
              node.getBoundingClientRect().height > 0,
          )?.id,
      )
      assert.ok(id, 'Editable homepage copy must exist')
      await frame.locator(`[id="${id}"]`).click()
      const copy = `Regression publication ${round}`
      await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(copy)
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
      )
      const home = backend.document.presentation.pages.find((p) => p.path === '/')
      const bytes = JSON.stringify(home.content.sv).length
      fs.writeFileSync(
        `/tmp/cms-public-${name}-${round}.json`,
        JSON.stringify(home.content.sv, null, 2),
      )
      firstPublishedBytes ??= bytes
      assert.ok(
        bytes <= firstPublishedBytes + 1000,
        `Home grew after publication ${round}: ${firstPublishedBytes} -> ${bytes}`,
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(base + '/?mode=dark')
      await page.getByText(copy, { exact: true }).waitFor()
      assert.equal(
        (await check('dark')).body,
        'rgb(36, 36, 39)',
        'Copy edits must preserve viewport color',
      )
    }
    // New site themes must paint viewport edges too, independently of the component tree.
    backend.document.presentation.themes.dark = { surface: '#123456' }
    await page.goto(base + '/?mode=dark')
    await page.waitForFunction(
      () =>
        globalThis.getComputedStyle(globalThis.document.body).backgroundColor === 'rgb(18, 52, 86)',
    )
    const themed = await check('dark')
    assert.equal(themed.html, themed.body)
    assert.equal(themed.meta, 'rgb(18, 52, 86)')
    console.log(
      `PASS ${name}: dark/light viewport, CMS edge color, three bounded publications and public reloads`,
    )
  } finally {
    await browser.close()
  }
}
