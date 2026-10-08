import assert from 'node:assert/strict'
import { test } from './fixtures.mjs'
test.use({ viewport: { width: 1440, height: 900 } })
test('cms-resource-usage', async ({ page }) => {
  const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
  assert.equal(new URL(base).hostname, '127.0.0.1')
  page.setDefaultTimeout(5000)
  let attempts = 0
  let testFailure = true
  await page.route('https://admin-harness.invalid/functions/v1/cms-studio', async (route) => {
    const headers = {
      'access-control-allow-origin': new URL(base).origin,
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    assert.equal(route.request().postDataJSON().operation, 'asset_usage')
    if (testFailure && ++attempts === 1)
      return route.fulfill({ status: 503, headers, json: { message: 'usage-timeout-test' } })
    return route.fulfill({
      headers,
      json: { currentReferences: 0, historyReferences: testFailure ? 3 : 0 },
    })
  })
  await page.route('https://admin-harness.invalid/storage/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>',
    }),
  )
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () => {
    const { emptyDocument } = await import('/shared/cms.ts')
    const { mountResources } = await import('/tools/e2e/cms-resources-harness.tsx')
    mountResources(
      [
        {
          id: '22222222-2222-4222-8222-222222222222',
          bucket: 'cms-library',
          path: 'images/uploaded.webp',
          name: 'Uploaded image',
          alt: '',
          mime: 'image/webp',
          width: 40,
          height: 40,
          bytes: 100,
          archived: false,
          version: 1,
        },
      ],
      emptyDocument(),
    )
  })
  await page.locator('.cms-resource-card button').click()
  await page.getByRole('button', { name: 'Försök läsa användning igen', exact: true }).waitFor()
  assert.equal(await page.locator('[data-review-error]').textContent(), '')
  assert.equal(await page.locator('.cms-resource-card').count(), 1)
  await page.getByRole('button', { name: 'Försök läsa användning igen', exact: true }).click()
  await page.getByText(/Publicerat: 0 · Historik: 3/).waitFor()
  assert.equal(await page.locator('[data-review-error]').textContent(), '')
  console.log('PASS usage failure: retained asset, local diagnostic, retry, no global upload error')
  testFailure = false
  await page.reload()
  await page.evaluate(async () => {
    const OriginalWorker = globalThis.Worker
    globalThis.usageRequests = 0
    globalThis.holdUsage = true
    const pending = []
    globalThis.releaseUsage = () => {
      globalThis.holdUsage = false
      pending.splice(0).forEach((send) => send())
    }
    globalThis.Worker = class extends OriginalWorker {
      postMessage(value, ...args) {
        globalThis.usageRequests++
        if (globalThis.holdUsage) pending.push(() => super.postMessage(value, ...args))
        else super.postMessage(value, ...args)
      }
    }
    const { emptyDocument } = await import('/shared/cms.ts')
    const { mountResources } = await import('/tools/e2e/cms-resources-harness.tsx')
    const document = emptyDocument()
    const html =
      '<main data-knc-native="1"><p>' +
      'x'.repeat(130000) +
      '</p><img src="https://admin-harness.invalid/storage/v1/object/public/cms-library/images/first.webp"></main>'
    document.presentation.pages.push({
      id: '10000000-0000-4000-8000-000000000001',
      path: '/',
      kind: 'page',
      name: { sv: 'Hem', en: 'Home' },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: Object.fromEntries(
        ['sv', 'en'].map((lang) => [lang, { html, css: { light: '', dark: '' } }]),
      ),
    })
    const assets = ['first', 'second'].map((name, i) => ({
      id: `22222222-2222-4222-8222-22222222222${i}`,
      bucket: 'cms-library',
      path: `images/${name}.webp`,
      name,
      alt: '',
      mime: 'image/webp',
      width: 40,
      height: 40,
      bytes: 100,
      archived: true,
      version: 1,
    }))
    mountResources(assets, document)
  })
  await page.getByRole('button', { name: 'Arkiverade', exact: true }).click()
  const select = (name) =>
    page.locator('.cms-resource-card button').filter({ hasText: name }).click()
  const trash = page.getByRole('button', { name: 'Flytta till papperskorg', exact: true })
  await select('first')
  await page.waitForFunction(() => globalThis.usageRequests === 1)
  await page.getByText(/Utkast: ej kontrollerat/).waitFor()
  assert.equal(await trash.isDisabled(), true, 'Pending draft checks must fail closed')
  await page.evaluate(() => globalThis.releaseUsage())
  await page.getByText(/Utkast: 4 placeringar/).waitFor()
  assert.equal(await trash.isDisabled(), true)
  await select('second')
  await page.getByText(/Utkast: 0 placeringar/).waitFor()
  await page.waitForFunction(() =>
    [...globalThis.document.querySelectorAll('button')].some(
      (button) => button.textContent === 'Flytta till papperskorg' && !button.disabled,
    ),
  )
  await select('first')
  assert.equal(
    await page.evaluate(() => globalThis.usageRequests),
    1,
    'Resource selection reuses one document scan',
  )
  await page.evaluate(async () => {
    globalThis.holdUsage = true
    const { mountResources, snapshot } = await import('/tools/e2e/cms-resources-harness.tsx')
    const state = snapshot()
    for (const variant of Object.values(state.document.presentation.pages[0].content))
      variant.html = variant.html.replace('first.webp', 'second.webp')
    mountResources(state.assets, state.document)
  })
  await select('second')
  await page.getByText(/Utkast: ej kontrollerat/).waitFor()
  assert.equal(
    await trash.isDisabled(),
    true,
    'An older unused result must not authorize the edited draft',
  )
  await page.waitForFunction(() => globalThis.usageRequests === 2)
  await page.evaluate(() => globalThis.releaseUsage())
  await page.getByText(/Utkast: 4 placeringar/).waitFor()
  await page.evaluate(async () => {
    const { mountResources, snapshot } = await import('/tools/e2e/cms-resources-harness.tsx')
    const state = snapshot()
    state.document.presentation.pages[0].content.en.css.dark =
      'p{background:url(https://outside.invalid/invalid.webp)}'
    mountResources(state.assets, state.document)
  })
  await page.getByText(/Utkastets referenser kunde inte kontrolleras/).waitFor()
  assert.equal(
    await trash.isDisabled(),
    true,
    'Invalid markup cannot return a partial unused index',
  )
  console.log(
    'PASS resource index: off-thread scan reused, pending/stale/invalid references fail closed',
  )
})
