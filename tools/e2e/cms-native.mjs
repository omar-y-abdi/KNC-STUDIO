import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium, webkit } from 'playwright'
import { emptyDocument, validateCompleteDocument } from '../../shared/cms.ts'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets.ts'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'

export async function nativeBackend(context, initialDocument = emptyDocument()) {
  // The CMS fixture uses local APIs, not a real third-party challenge on HTTP localhost.
  await context.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.turnstile={render:()=>"test",remove:()=>{},reset:()=>{}}',
    }),
  )
  let document = globalThis.structuredClone(initialDocument)
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
  context.setDefaultTimeout(15000)
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
  const appearance = (locator) =>
    locator.evaluate((node) => {
      const style = globalThis.getComputedStyle(node)
      return {
        ...Object.fromEntries(
          [
            'width',
            'color',
            'font-family',
            'font-size',
            'font-weight',
            'letter-spacing',
            'text-transform',
          ].map((key) => [key, style.getPropertyValue(key)]),
        ),
        parentPadding: globalThis.getComputedStyle(node.parentElement).padding,
      }
    })
  const scrollbarWidth = (locator) =>
    locator.evaluate((node) => globalThis.getComputedStyle(node, '::-webkit-scrollbar').width)
  const fitCanvas = async () => {
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    await page.waitForFunction(
      () => {
        const host = globalThis.document
          .querySelector('.cms-editor-canvas')
          ?.getBoundingClientRect()
        const frame = globalThis.document.querySelector('.gjs-frame')?.getBoundingClientRect()
        return host && frame && frame.left >= host.left - 1 && frame.right <= host.right + 1
      },
      null,
      { timeout: 3000 },
    )
  }
  try {
    await page.goto(base)
    const sourceCopy = page.getByText('KNC source sv', { exact: true }).first()
    await sourceCopy.waitFor()
    assert.equal(
      await page.locator('[data-knc-source],[data-knc-slot]').count(),
      0,
      'An unpublished CMS must leave the original component tree untouched',
    )
    const desktopAppearance = await appearance(sourceCopy)
    await page.screenshot({ path: `/tmp/cms-native-${name}-original-desktop.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('mobile-site-scroll').waitFor()
    const mobileScrollbarWidth = await scrollbarWidth(page.getByTestId('mobile-site-scroll'))
    const mobileAppearance = await appearance(
      page.getByRole('button', { name: 'Boka tid', exact: true }),
    )
    await page.screenshot({ path: `/tmp/cms-native-${name}-original-mobile.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () => {
      const harness = await import('/tools/e2e/admin-harness.tsx')
      harness.mountCmsStudioHarness()
    })
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    const sourceContract = await page.evaluate(async () => {
      const { snapshotNative } = await import('/src/admin/cms/nativePages.ts')
      const fixture = new globalThis.DOMParser().parseFromString(
        '<section><a href="#privacy-preferences">Privacy</a><div data-knc-slot="outer"><div id="nested" data-knc-slot="nested"><span id="caption">Name</span><input aria-labelledby="caption"></div></div></section>',
        'text/html',
      ).body.firstElementChild
      const desktop = snapshotNative(fixture, 'desktop-test')
      const mobile = snapshotNative(fixture, 'mobile-test')
      const doc = new globalThis.DOMParser().parseFromString(desktop + mobile, 'text/html')
      return {
        html: desktop + mobile,
        nestedSlots: doc.querySelectorAll('[data-knc-slot="nested"]').length,
        privacy: doc.querySelector('a').getAttribute('href'),
        labels: [...doc.querySelectorAll('input')].map(
          (input) => doc.getElementById(input.getAttribute('aria-labelledby'))?.textContent,
        ),
      }
    })
    assert.equal(sourceContract.nestedSlots, 0, 'Nested runtime identities leaked into snapshots')
    assert.equal(sourceContract.privacy, '/#privacy-preferences')
    assert.deepEqual(sourceContract.labels, ['Name', 'Name'])
    const { validateMarkup } = await import('../../shared/cms-markup.ts')
    validateMarkup(
      sourceContract.html,
      '',
      { siteOrigin: new URL(base).origin, storageOrigin: 'https://admin-harness.invalid' },
      { native: true },
    )
    const frame = page.frameLocator('.gjs-frame').first()
    await frame.getByText('KNC source sv', { exact: true }).first().waitFor({ timeout: 10000 })
    assert.deepEqual(
      await appearance(frame.getByText('KNC source sv', { exact: true }).first()),
      desktopAppearance,
      'The desktop canvas must retain the actual site layout and typography',
    )
    assert.equal(await frame.getByText('Klipp.').count(), 0)
    assert.equal(await frame.locator('[data-knc-surface="desktop-home"]').count(), 1)
    assert.equal((await frame.locator('svg').count()) > 0, true, 'The actual vector logo is absent')
    assert.equal(
      await frame
        .locator('[data-knc-surface="desktop-home"]')
        .evaluate((node) => globalThis.getComputedStyle(node).display),
      'flex',
      'The actual site layout styles were lost while loading GrapesJS',
    )
    assert.deepEqual(backend.writes, [], 'Opening the editor issued a public write')
    await fitCanvas()
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
      globalThis.document.querySelector('[aria-label="Språk"] button:last-child').click()
      return { id: element.id }
    })
    await frame.getByText('KNC source en', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'SV', exact: true }).click()
    await frame.getByText('Owner edited the actual KNC site', { exact: true }).waitFor()
    await page.evaluate(async (id) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const editor = cmsGrapes.editors.at(-1)
      editor
        .getWrapper()
        .find(`#${globalThis.CSS.escape(id)}`)[0]
        .addStyle({
          'letter-spacing': '3px',
        })
      globalThis.document.querySelector('[aria-label="Tema"] button:last-child').click()
    }, edit.id)
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('.knc-cms-studio')?.getAttribute('data-mode') === 'dark',
    )
    await page.getByRole('button', { name: 'Ljus', exact: true }).click()
    await frame.locator(`#${edit.id}`).evaluate((node) => {
      if (globalThis.getComputedStyle(node).letterSpacing !== '3px')
        throw new Error('An immediate theme switch lost the pending style edit')
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

    await page.bringToFront()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '390', exact: true }).click()
    // The mobile surface appears before GrapesJS finishes animating the device width.
    await page.waitForFunction(() => {
      const canvas = globalThis.document.querySelector('.gjs-frame')
      return canvas && globalThis.getComputedStyle(canvas).width === '390px'
    })
    await frame.locator('[data-knc-surface="mobile-home"]').waitFor({ state: 'visible' })
    assert.equal(
      await scrollbarWidth(frame.locator('[data-knc-surface="mobile-home"]')),
      mobileScrollbarWidth,
      'The canvas must retain the original mobile scrolling style',
    )
    assert.deepEqual(
      await appearance(
        frame
          .locator('[data-knc-surface="mobile-home"]')
          .getByRole('button', { name: 'Boka tid', exact: true }),
      ),
      mobileAppearance,
      'The mobile canvas must retain the actual site layout and typography',
    )
    await fitCanvas()
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
