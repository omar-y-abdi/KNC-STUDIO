import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium, webkit } from 'playwright'
import { emptyDocument, validateCompleteDocument } from '../../shared/cms.ts'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets.ts'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'

export async function nativeBackend(context) {
  let document = emptyDocument()
  let revision = 1
  const writes = []
  const fingerprint = () => createHash('md5').update(JSON.stringify(document)).digest('hex')
  await context.route('**/api/cms/presentation', (route) =>
    route.fulfill({
      json: { revision, presentation: document.presentation },
    }),
  )
  await context.route('https://admin-harness.invalid/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'Access-Control-Allow-Origin': new URL(base).origin,
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    }
    const reply = (value, status = 200) => route.fulfill({ status, headers, json: value })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/functions/v1/cms-studio') {
      const body = request.postDataJSON()
      if (body.operation === 'state')
        return reply({ revision, fingerprint: fingerprint(), assets: [], document })
      if (body.operation === 'history') return reply([])
      if (['validate', 'publish'].includes(body.operation)) {
        const candidate = globalThis.structuredClone(body.document)
        try {
          validateCompleteDocument(candidate, document)
          validateDocumentMarkupPlacements(candidate, {
            siteOrigin: new URL(base).origin,
            storageOrigin: 'https://admin-harness.invalid',
            builtAssets: CMS_BUILT_ASSETS,
          })
        } catch (error) {
          console.error('CMS_VALIDATION_ERROR', error)
          console.error(
            'CMS_PAGE_SIZES',
            candidate.presentation.pages.map((page) => ({
              path: page.path,
              sv: page.content.sv.html.length,
              en: page.content.en.html.length,
            })),
          )
          return reply({ message: error.message }, 422)
        }
        if (body.operation === 'validate') return reply({ document: candidate })
        assert.equal(body.baseRevision, revision)
        assert.equal(body.baseFingerprint, fingerprint())
        document = candidate
        revision++
        writes.push('publish')
        return reply({ document, revision, fingerprint: fingerprint(), requestId: body.requestId })
      }
      throw new Error(`Unexpected CMS request: ${body.operation}`)
    }
    if (path === '/rest/v1/rpc/public_business_discovery')
      return reply({ settings: {}, barbers: [], services: [], schedules: [] })
    if (path === '/rest/v1/rpc/public_booking_catalog') return reply({ barbers: [], services: [] })
    if (path === '/rest/v1/site_content') {
      const lang = new URL(request.url()).searchParams.get('lang')?.slice(3) ?? 'sv'
      return reply([{ key: 'kicker', lang, value: `KNC source ${lang}` }])
    }
    if (path.startsWith('/rest/v1/')) return reply([])
    writes.push(path)
    return reply({ error: 'not_available_in_preview' }, 403)
  })
  return {
    writes,
    get document() {
      return document
    },
  }
}

async function run(engine, name) {
  const browser = await engine.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const backend = await nativeBackend(context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('PAGE_ERROR', error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('BROWSER', message.text())
  })
  try {
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () => {
      const harness = await import('/tools/e2e/admin-harness.tsx')
      harness.mountCmsStudioHarness()
    })
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.getByText('KNC source sv', { exact: true }).first().waitFor({ timeout: 10000 })
    assert.equal(await frame.getByText('Klipp.').count(), 0)
    assert.equal(await frame.locator('[data-knc-surface="desktop-home"]').count(), 1)
    assert.equal((await frame.locator('svg').count()) > 0, true, 'The actual vector logo is absent')
    assert.deepEqual(backend.writes, [], 'Opening the editor issued a public write')
    await page.screenshot({ path: `/tmp/cms-native-${name}-desktop.png` })

    const edit = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      if (!editor) throw new Error('Actual GrapesJS instance missing')
      const elements = [...editor.Canvas.getDocument().querySelectorAll('[data-knc-source]')]
      const element = elements.find(
        (node) => node.children.length === 0 && node.textContent === 'KNC source sv',
      )
      if (!element) throw new Error('Actual source copy not found')
      const component = editor.getWrapper().find(`#${globalThis.CSS.escape(element.id)}`)[0]
      if (!component) throw new Error('Actual source component missing')
      component.components('Owner edited the actual KNC site')
      component.addStyle({ color: '#123456' })
      return { id: element.id }
    })
    await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
    await page.waitForFunction(() =>
      globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
    )
    assert.equal(backend.writes.includes('publish'), true, 'The editor did not publish')
    assert.equal(
      backend.document.presentation.pages.some((item) =>
        item.content.sv.html.includes('knc-cms-page'),
      ),
      false,
    )

    const live = await context.newPage()
    await live.goto(base)
    await live.getByText('Owner edited the actual KNC site', { exact: true }).waitFor()
    assert.equal(
      await live.locator(`#${edit.id}`).evaluate((node) => globalThis.getComputedStyle(node).color),
      'rgb(18, 52, 86)',
    )
    await live.reload()
    await live.getByText('Owner edited the actual KNC site', { exact: true }).waitFor()
    await live.getByRole('button', { name: 'Boka tid', exact: true }).click()
    await live.locator('[data-testid="fold-booking"]').waitFor({ state: 'visible' })
    await live.locator('[data-booking-step="barber"]').waitFor()
    assert.equal(
      await live.locator('[data-testid="fold-booking"]').getAttribute('aria-hidden'),
      null,
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '390', exact: true }).click()
    await frame.locator('[data-knc-surface="mobile-home"]').waitFor({ state: 'visible' })
    await page.screenshot({ path: `/tmp/cms-native-${name}-mobile.png` })
    await page.reload()
    await page.evaluate(async () => {
      const harness = await import('/tools/e2e/admin-harness.tsx')
      harness.mountCmsStudioHarness()
    })
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await page
      .frameLocator('.gjs-frame')
      .first()
      .getByText('Owner edited the actual KNC site', { exact: true })
      .waitFor()
    assert.deepEqual(errors, [])
    console.log(
      `PASS ${name}: actual layout, read-only source, real validation, edit, publish, reload, native booking, mobile canvas`,
    )
  } catch (error) {
    console.error('EDITOR_BODY', (await page.locator('body').innerText()).slice(0, 5000))
    console.error('PAGE_ERRORS', errors)
    await page.screenshot({ path: `/tmp/cms-native-${name}-failure.png` })
    for (const frame of page.frames())
      console.error(
        'FRAME',
        frame.url(),
        await frame
          .evaluate(() => ({
            status: { ...globalThis.document.documentElement.dataset },
            surfaces: [...globalThis.document.querySelectorAll('[data-knc-surface]')].map((node) =>
              node.getAttribute('data-knc-surface'),
            ),
          }))
          .catch(() => 'detached'),
      )
    throw error
  } finally {
    await browser.close()
  }
}

if (process.argv[1]?.endsWith('/cms-native.mjs')) {
  await run(chromium, 'chromium')
  await run(webkit, 'webkit')
}
