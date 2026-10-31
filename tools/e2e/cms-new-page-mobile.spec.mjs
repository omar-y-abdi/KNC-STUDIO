import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { nativeBackend } from './cms-backend.mjs'
import { expect, test } from './fixtures.mjs'
import { generate, parse, walk } from 'css-tree'
import { harnessOrigin } from './origins.mjs'
test.describe('new page', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('cms-new-page-mobile', async ({ page, context, evidenceDir }) => {
    const base = harnessOrigin
    assert.equal(new URL(base).hostname, '127.0.0.1')
    const out = evidenceDir
    await mkdir(out, { recursive: true })
    const name = process.env.CMS_ENGINE === 'webkit' ? 'webkit' : 'chromium'
    context.setDefaultTimeout(10000)
    const backend = await nativeBackend(context)
    await page.goto(`${base}/tools/e2e/admin-harness.html`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Ny sida' })
      .getByRole('button', { name: 'Skapa sida', exact: true })
      .click()
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.locator('#cms-site-header').waitFor()
    const measure = () =>
      frame.locator('#cms-site-header').evaluate((node) => {
        const rect = (element) => {
          const r = element.getBoundingClientRect()
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          }
        }
        const phone = node.querySelector('a[href^="tel:"]')
        const brand = node.querySelector('svg')
        return {
          header: rect(node),
          phone: phone ? rect(phone) : null,
          brand: brand ? rect(brand) : null,
          overflow: node.scrollWidth > node.clientWidth + 1,
          phoneWhiteSpace: phone ? globalThis.getComputedStyle(phone).whiteSpace : null,
        }
      })
    await page.waitForFunction(
      () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
    )
    const mobile = await measure()
    await writeFile(`${out}/${name}-geometry.json`, JSON.stringify(mobile, null, 2))
    await page.screenshot({ path: `${out}/${name}-new-page.png` })
    assert.equal(mobile.overflow, false, 'Mobile header must not overflow')
    assert.equal(mobile.phoneWhiteSpace, 'nowrap', 'The phone number must not wrap across lines')
    assert.ok(
      mobile.brand && mobile.brand.width <= 240 && mobile.brand.height <= 44,
      'Brand must have a bounded phone size',
    )
    assert.ok(
      mobile.header.height <= 160,
      'Header must not consume a disproportionate phone height',
    )
    await page.getByRole('button', { name: 'Dator', exact: true }).click()
    await frame.locator('#cms-site-header').waitFor()
    await page.waitForFunction(
      () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 1440,
    )
    const desktop = await measure()
    assert.equal(desktop.overflow, false)
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
    const saved = backend.document.presentation.pages.find((item) => item.path === '/hemsida')
    assert.equal(saved.layout, undefined, 'A created page is no longer a frozen independent copy')
    assert.ok(!saved.content.sv.html.includes('cms-site-header'), 'Only the body is saved')
    await page.reload()
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page
      .locator('.cms-page-list')
      .getByRole('button', { name: 'Ny sida', exact: true })
      .click()
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await page.waitForFunction(
      () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
    )
    assert.equal((await measure()).phoneWhiteSpace, 'nowrap')
    console.log('PASS new-page mobile chrome: bounded logo, contact, viewport fit and saved layout')
  })
  test('cms-new-page-mobile: geometry mirrors both languages and themes while text stays independent', async ({
    page,
    context,
  }) => {
    const backend = await nativeBackend(context)
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Ny sida' })
      .getByRole('button', { name: 'Skapa sida', exact: true })
      .click()
    const frame = page.frameLocator('.gjs-frame').first()
    const heading = () => frame.locator('main[id^="cms-body-"] h1')
    const language = (lang) =>
      page
        .getByRole('group', { name: 'Språk', exact: true })
        .getByRole('button', { name: lang.toUpperCase(), exact: true })
        .click()
    const theme = (mode) =>
      page
        .getByRole('group', { name: 'Tema', exact: true })
        .getByRole('button', { name: mode === 'light' ? 'Ljus' : 'Mörk', exact: true })
        .click()
    const dimension = async (property, value) => {
      const input = page.locator(`#cms-inspector .gjs-sm-property__${property} input`).first()
      await input.fill(String(value))
      await input.press('Enter')
      await input.press('Tab')
    }
    const texts = { sv: 'Ny sida', en: 'Ny sida' }
    const moves = { Desktop: 0, Mobile: 0 }
    for (const device of ['Desktop', 'Mobile']) {
      await page
        .getByRole('button', { name: device === 'Desktop' ? 'Dator' : 'Mobil', exact: true })
        .click()
      await page.waitForFunction(
        (width) =>
          globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === width,
        device === 'Desktop' ? 1440 : 390,
      )
      for (const mode of ['light', 'dark'])
        for (const lang of ['sv', 'en']) {
          await theme(mode)
          await language(lang)
          await heading().click()
          texts[lang] =
            `${lang} ${device} ${mode}: En lång rubrik med flera ord som behöver få växa på höjden.`
          await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(texts[lang])
          await dimension('width', device === 'Desktop' ? 220 : 170)
          await dimension('height', 12)
          // Height stays auto in the editing frame too, before any context reload can hide clipping.
          await expect
            .poll(() => heading().evaluate((node) => node.scrollHeight <= node.clientHeight + 1))
            .toBe(true)
          await page.getByRole('button', { name: 'Flytta åt höger', exact: true }).click()
          moves[device]++
          for (const targetLang of ['sv', 'en']) {
            await language(targetLang)
            for (const targetMode of ['light', 'dark']) {
              await theme(targetMode)
              await expect(heading()).toHaveText(texts[targetLang])
              await expect
                .poll(() =>
                  heading().evaluate((node) => {
                    const style = globalThis.getComputedStyle(node)
                    return {
                      x: parseFloat(style.translate) || 0,
                      width: Math.round(node.getBoundingClientRect().width),
                      fits: node.scrollHeight <= node.clientHeight + 1,
                    }
                  }),
                )
                .toEqual({ x: moves[device], width: device === 'Desktop' ? 220 : 170, fits: true })
            }
          }
        }
    }
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.getByText('Publicerad · rev 2', { exact: true }).waitFor({ timeout: 15000 })
    const saved = backend.document.presentation.pages.find((item) => item.path === '/hemsida')
    assert.ok(saved)
    for (const lang of ['sv', 'en']) {
      assert.ok(saved.content[lang].html.includes(texts[lang]))
      assert.ok(!saved.content[lang].html.includes(texts[lang === 'sv' ? 'en' : 'sv']))
      for (const mode of ['light', 'dark']) {
        const scoped = new Map()
        walk(parse(saved.content[lang].css[mode]), {
          visit: 'Rule',
          enter(rule) {
            if (!generate(rule.prelude).endsWith(`-${lang}-title`)) return
            for (const declaration of rule.block.children)
              if (declaration.type === 'Declaration' && declaration.property === 'translate')
                scoped.set(generate(this.atrule.prelude), generate(declaration.value))
          },
        })
        assert.equal(scoped.get('(min-width:769px)'), `${moves.Desktop}px 0px`)
        assert.equal(scoped.get('(max-width:768px)'), `${moves.Mobile}px 0px`)
      }
    }
  })
})
test.describe('canonical Home', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('cms-unified-home', async ({ page, context }) => {
    const base = harnessOrigin
    assert.equal(new URL(base).hostname, '127.0.0.1')
    const backend = await nativeBackend(context)
    context.setDefaultTimeout(15000)
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
    const about = frame.locator('[data-knc-surface="desktop-home"] [data-knc-surface="about"]')
    assert.equal(await about.count(), 1, 'Home must contain the editable canonical About surface')
    assert.equal(
      await page
        .locator('.cms-page-list')
        .getByRole('button', { name: 'Om oss', exact: true })
        .count(),
      0,
      'No duplicate editor destination',
    )
    const heading = about.locator('h2').first()
    const originalHeading = (await heading.textContent()) ?? ''
    await heading.click()
    await page.waitForFunction(
      async (expected) => {
        const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
        const selected = cmsGrapes.editors.at(-1)?.getSelected()?.getEl()
        return selected?.textContent?.trim() === expected
      },
      originalHeading.trim(),
      { timeout: 5000 },
    )
    await page
      .locator('#cms-inspector')
      .getByRole('textbox', { name: 'Text', exact: true })
      .fill('Sammanhängande redigering')
    await page.getByRole('button', { name: 'Ångra', exact: true }).click()
    await about.locator('h2').first().getByText(originalHeading, { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Gör om', exact: true }).click()
    await about.getByText('Sammanhängande redigering', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    assert.equal(
      await frame
        .locator('[data-knc-surface="desktop-home"] [data-knc-surface="about"]')
        .getByText('Sammanhängande redigering', { exact: true })
        .count(),
      0,
      'Swedish About edits must not overwrite the English variant',
    )
    await page.getByRole('button', { name: 'SV', exact: true }).click()
    await about.getByText('Sammanhängande redigering', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await frame
      .locator('[data-knc-surface="mobile-home"] [data-knc-surface="about"]')
      .getByText('Sammanhängande redigering', { exact: true })
      .waitFor()
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
    assert.match(
      backend.document.presentation.pages.find((item) => item.path === '/about').content.sv.html,
      /Sammanhängande redigering/,
    )
    assert.ok(
      !JSON.stringify(backend.document).includes('data-editor-about-slot'),
      'Composition markers never enter saved content',
    )
    await page.reload()
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await frame
      .getByText('Sammanhängande redigering', { exact: true })
      .first()
      .waitFor({ timeout: 30000 })
    console.log(
      'PASS unified Home: canonical ownership, inline edit, device switch, validation, save and reload',
    )
  })
})
