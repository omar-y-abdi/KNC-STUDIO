// Local-only regression test for resource usage error reporting.
// Uses an isolated fixture, never production accounts or credentials.
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const browser = await (process.env.CMS_ENGINE === 'webkit' ? webkit : chromium).launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(5000)
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () => {
    const { cmsApi } = await import('/src/admin/cms/api.ts')
    const { emptyDocument } = await import('/shared/cms.ts')
    const { mountResources } = await import('/tools/e2e/cms-resources-harness.tsx')
    let attempts = 0
    cmsApi.assetUsage = async () => {
      if (++attempts === 1) throw new Error('usage-timeout-test')
      return { currentReferences: 0, historyReferences: 3 }
    }
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
} finally {
  await browser.close()
}
