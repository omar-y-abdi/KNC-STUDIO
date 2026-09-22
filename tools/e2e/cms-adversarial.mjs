import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { emptyDocument } from '../../shared/cms.ts'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-adversarial'
await mkdir(out, { recursive: true })
const results = []
const first = {
  id: '22222222-2222-4222-8222-222222222222',
  bucket: 'cms-library',
  path: 'images/old.webp',
  name: 'First image',
  alt: '',
  mime: 'image/webp',
  width: 40,
  height: 40,
  bytes: 100,
  archived: false,
  version: 1,
}
const second = {
  ...first,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Second image',
  path: 'images/new.webp',
}
const gate = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const inspect = (page) =>
  page.evaluate(async () => (await import('/tools/e2e/cms-resources-harness.tsx')).snapshot())

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== engineName) continue
  const browser = await engine.launch()
  const run = async (name, test) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    context.setDefaultTimeout(10000)
    const page = await context.newPage()
    try {
      await test(page, context)
      results.push({ engine: engineName, name, passed: true })
    } catch (error) {
      results.push({ engine: engineName, name, passed: false, error: error.stack })
      await page.screenshot({ path: `${out}/${engineName}-${name}-failure.png` }).catch(() => {})
    } finally {
      await context.close()
    }
  }
  const mount = async (
    page,
    context,
    { assets = [first], document = emptyDocument(), delay, requests = [], usages = {} } = {},
  ) => {
    await context.route('https://admin-harness.invalid/**', async (route) => {
      const req = route.request()
      const headers = {
        'access-control-allow-origin': base,
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'content-type': 'application/json',
      }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (req.url().includes('/storage/')) return route.fulfill({ status: 404, body: '' })
      if (!req.url().includes('/functions/v1/'))
        return route.fulfill({ status: 200, headers, body: '[]' })
      if (req.url().endsWith('/upload-image')) {
        requests.push({ operation: 'upload' })
        if (delay?.operation === 'upload') {
          delay.started.release()
          await delay.done.promise
        }
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ asset: second }) })
      }
      const body = req.postDataJSON()
      requests.push(body)
      if (delay?.operation === body.operation) {
        delay.started.release()
        await delay.done.promise
      }
      const asset = assets.find((item) => item.id === body.id)
      let data
      if (body.operation === 'asset_usage')
        data = usages[body.id] ?? { currentReferences: 0, historyReferences: 0 }
      else if (body.operation === 'asset') {
        const allowed = new Set(['operation', 'id', 'version', 'name', 'alt', 'archived'])
        if (Object.keys(body).some((key) => !allowed.has(key)))
          return route.fulfill({
            status: 422,
            headers,
            body: JSON.stringify({
              error: 'invalid_content',
              message: 'request: Unsupported field',
            }),
          })
        data = {
          ...asset,
          name: body.name,
          alt: body.alt,
          archived: body.archived,
          version: body.version + 1,
        }
      } else if (body.operation === 'asset_lifecycle')
        data = {
          asset: { ...asset, archived: body.action === 'archive', version: body.version + 1 },
          usage: { currentReferences: 0, historyReferences: 0 },
        }
      else throw new Error(`Unexpected resource operation ${body.operation}`)
      return route.fulfill({ status: 200, headers, body: JSON.stringify(data) })
    })
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(
      async ({ assets, document }) =>
        (await import('/tools/e2e/cms-resources-harness.tsx')).mountResources(assets, document),
      { assets, document },
    )
    await page.locator('.cms-resource-surface').waitFor()
  }
  try {
    await run('metadata-wire', async (page, context) => {
      const requests = []
      await mount(page, context, { requests })
      await page.locator('.cms-resource-card button').click()
      await page.getByRole('textbox', { name: 'Namn', exact: true }).fill('Saved name')
      await page.getByRole('button', { name: 'Spara metadata', exact: true }).click()
      await page.waitForFunction(
        () =>
          document.querySelector('.cms-resource-surface')?.getAttribute('aria-busy') === 'false',
      )
      assert.equal((await inspect(page)).error, '', 'real API allowlist rejects full asset objects')
      assert.equal((await inspect(page)).assets[0].version, 2)
      assert.equal(requests.filter((item) => item.operation === 'asset').length, 1)
    })
    for (const state of ['archived', 'trash'])
      await run(`draft-${state}`, async (page, context) => {
        const document = emptyDocument()
        document.presentation.images.hero = {
          ref: { bucket: first.bucket, path: first.path },
          alt: { sv: '', en: '' },
        }
        const requests = []
        await mount(page, context, {
          document,
          requests,
          assets: [
            {
              ...first,
              archived: true,
              trashed_at: state === 'trash' ? '2026-09-22T00:00:00Z' : null,
            },
          ],
        })
        await page
          .getByRole('button', {
            name: state === 'trash' ? 'Papperskorg' : 'Arkiverade',
            exact: true,
          })
          .click()
        await page.locator('.cms-resource-card button').click()
        await page.getByText(/Utkast: 1 placeringar · Publicerat: 0/).waitFor()
        const action = page.getByRole('button', {
          name: state === 'trash' ? 'Radera permanent' : 'Flytta till papperskorg',
          exact: true,
        })
        assert.equal(
          await action.isDisabled(),
          true,
          'unpublished references must block destructive operations',
        )
        assert.equal(requests.filter((item) => item.operation === 'asset_lifecycle').length, 0)
      })
    await run('bulk-draft', async (page, context) => {
      const document = emptyDocument()
      document.presentation.images.hero = {
        ref: { bucket: first.bucket, path: first.path },
        alt: { sv: '', en: '' },
      }
      await mount(page, context, { document })
      await page.getByRole('checkbox', { name: `Markera ${first.name}` }).check()
      assert.equal(
        await page.getByRole('button', { name: 'Till papperskorg', exact: true }).isDisabled(),
        true,
        'bulk trash must protect local draft references too',
      )
    })
    await run('replacement-concurrent-edit', async (page, context) => {
      const document = emptyDocument()
      document.presentation.images.hero = {
        ref: { bucket: first.bucket, path: first.path },
        alt: { sv: '', en: '' },
      }
      const delay = { operation: 'upload', started: gate(), done: gate() }
      await mount(page, context, { document, delay })
      await page.locator('.cms-resource-card button').click()
      await page
        .locator('.cms-resource-detail input[type=file]')
        .setInputFiles({
          name: 'new.webp',
          mimeType: 'image/webp',
          buffer: Buffer.from('fixture-response-is-intercepted'),
        })
      await delay.started.promise
      await page.evaluate(async () =>
        (await import('/tools/e2e/cms-resources-harness.tsx')).changeBusinessName(
          'Concurrent owner edit',
        ),
      )
      delay.done.release()
      await page.waitForFunction(
        () =>
          document.querySelector('.cms-resource-surface')?.getAttribute('aria-busy') === 'false',
      )
      const state = await inspect(page)
      assert.equal(state.error, '')
      assert.equal(
        state.document.settings.business_name,
        'Concurrent owner edit',
        'upload acknowledgement must use the current draft',
      )
      assert.deepEqual(state.document.presentation.images.hero.ref, {
        bucket: second.bucket,
        path: second.path,
      })
    })
    await run('metadata-concurrent-edit', async (page, context) => {
      const delay = { operation: 'asset', started: gate(), done: gate() }
      await mount(page, context, { delay })
      await page.locator('.cms-resource-card button').click()
      const name = page.getByRole('textbox', { name: 'Namn', exact: true })
      await name.fill('Submitted name')
      await page.getByRole('button', { name: 'Spara metadata', exact: true }).click()
      await delay.started.promise
      await name.fill('Newer unsaved name')
      delay.done.release()
      await page.waitForFunction(
        () =>
          document.querySelector('.cms-resource-surface')?.getAttribute('aria-busy') === 'false',
      )
      const state = await inspect(page)
      assert.equal(state.error, '')
      assert.equal(
        state.assets[0].name,
        'Newer unsaved name',
        'acknowledgement must not erase newer typing',
      )
      assert.equal(state.assets[0].version, 2, 'retain the authoritative version for the next save')
    })
    await run('usage-selection-race', async (page, context) => {
      const delay = { operation: 'asset_lifecycle', started: gate(), done: gate() }
      await mount(page, context, {
        assets: [first, { ...second, archived: true }],
        delay,
        usages: { [second.id]: { currentReferences: 7, historyReferences: 2 } },
      })
      await page.locator('.cms-resource-card button').click()
      await page.getByText(/Publicerat: 0 · Historik: 0/).waitFor()
      await page.getByRole('button', { name: 'Arkivera', exact: true }).click()
      await delay.started.promise
      await page.getByRole('button', { name: 'Arkiverade', exact: true }).click()
      await page.locator('.cms-resource-card button').click()
      await page.getByText(/Publicerat: 7 · Historik: 2/).waitFor()
      delay.done.release()
      await page.waitForFunction(
        () =>
          document.querySelector('.cms-resource-surface')?.getAttribute('aria-busy') === 'false',
      )
      assert.match(
        await page.locator('.cms-resource-detail').innerText(),
        /Publicerat: 7 · Historik: 2/,
        'an operation on a different asset cannot supply the selected asset usage',
      )
      assert.equal(
        await page
          .getByRole('button', { name: 'Flytta till papperskorg', exact: true })
          .isDisabled(),
        true,
      )
    })
    await run('scene-css-precedence', async (page) => {
      await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
      const result = await page.evaluate(async () => {
        const { emptyDocument } = await import('/shared/cms.ts')
        const { ensureCorePages } = await import('/src/admin/cms/corePages.ts')
        const document = emptyDocument()
        const html = '<main data-knc-native="1"><p id="review-owner">Owner text</p></main>'
        const content = () => ({
          html,
          css: {
            light: '#review-owner{color:rgb(200, 0, 0)}',
            dark: '#review-owner{color:rgb(0, 0, 200)}',
          },
        })
        const page = {
          id: '10000000-0000-4000-8000-000000000003',
          path: '/booking',
          kind: 'page',
          name: { sv: 'Boka', en: 'Book' },
          title: { sv: '', en: '' },
          description: { sv: '', en: '' },
          inMenu: true,
          content: { sv: content(), en: content() },
        }
        document.presentation.pages.push(page)
        const source = structuredClone(page)
        for (const variant of Object.values(source.content)) {
          variant.html =
            '<main data-knc-native="1"><section data-knc-surface="booking-details"><p>Details</p></section></main>'
          variant.css = {
            light: '#review-owner{color:rgb(0, 0, 0)}',
            dark: '#review-owner{color:rgb(0, 0, 0)}',
          }
        }
        const before = JSON.stringify(document)
        const upgraded = ensureCorePages(document, [source])
        const colors = []
        const host = window.document.createElement('div')
        host.id = 'review-owner'
        window.document.body.appendChild(host)
        for (const lang of ['sv', 'en'])
          for (const mode of ['light', 'dark']) {
            const sheet = window.document.createElement('style')
            sheet.textContent = upgraded.presentation.pages[0].content[lang].css[mode]
            window.document.head.appendChild(sheet)
            colors.push(getComputedStyle(host).color)
            sheet.remove()
          }
        host.remove()
        return {
          colors,
          untouched: before === JSON.stringify(document),
          idempotent:
            JSON.stringify(upgraded) === JSON.stringify(ensureCorePages(upgraded, [source])),
        }
      })
      assert.deepEqual(
        result.colors,
        ['rgb(200, 0, 0)', 'rgb(0, 0, 200)', 'rgb(200, 0, 0)', 'rgb(0, 0, 200)'],
        'new scenes must not override owner CSS',
      )
      assert.equal(result.untouched, true)
      assert.equal(result.idempotent, true)
    })
  } finally {
    await browser.close()
  }
}
await writeFile(`${out}/adversarial.json`, JSON.stringify(results, null, 2))
for (const item of results)
  console.log(
    `${item.passed ? 'PASS' : 'FAIL'} ${item.engine}/${item.name}${item.error ? `\n${item.error}` : ''}`,
  )
assert.equal(results.filter((item) => !item.passed).length, 0, 'adversarial CMS contracts failed')
