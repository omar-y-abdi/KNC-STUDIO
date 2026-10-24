/* global Event, PerformanceObserver, setTimeout */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-backend.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

// The draft lifecycle cases that need an API only Chromium has. The cms-webkit project never
// discovers a *.chromium.spec.mjs file (playwright.config.ts), so no WebKit report holds a skip.
test.use({ viewport: { width: 1440, height: 900 } })

async function openStudio(page) {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page
    .frameLocator('.gjs-frame')
    .first()
    .locator('[data-knc-surface="desktop-home"]')
    .waitFor({ timeout: 90000 })
}

const nameField = (page) => page.getByRole('textbox', { name: 'Namn', exact: true })

// The sanitised production presentation: its draft serializes to about 1.4 million characters.
const productionDocument = async () => ({
  ...emptyDocument(),
  presentation: JSON.parse(
    gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
  ).presentation,
})

// TST-15: the median of 3 in-page samples. Only Chromium has the Long Tasks API, which reports
// tasks of 50 ms or more. The budget sits between today's edit and the 77-87 ms one before LIFE-16;
// a 120 ms stall in CmsDraft.change fails it.
test('cms-lifecycle a page-name edit stays a short task at production size', async ({
  page,
  context,
}) => {
  await nativeBackend(context, await productionDocument())
  await openStudio(page)
  const durations = await nameField(page).evaluate(async (input) => {
    const longestTask = async (value) => {
      const tasks = []
      const observer = new PerformanceObserver((list) => tasks.push(...list.getEntries()))
      observer.observe({ type: 'longtask' })
      await new Promise((resolve) => setTimeout(resolve, 100))
      tasks.length = 0
      // The edit runs in a task of its own, as typing does.
      setTimeout(() => {
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      // Shorter than the 500 ms backup debounce: the sample is the edit and its render.
      await new Promise((resolve) => setTimeout(resolve, 400))
      tasks.push(...observer.takeRecords())
      observer.disconnect()
      return Math.max(0, ...tasks.map((task) => task.duration))
    }
    const samples = []
    for (const value of ['Startsida A', 'Startsida AB', 'Startsida ABC'])
      samples.push(await longestTask(value))
    return samples
  })
  const median = [...durations].sort((a, b) => a - b)[1]
  console.log(`page-name edit longest task ms: ${durations.map((ms) => ms.toFixed(1)).join(', ')}`)
  assert.ok(median < 60, `median longest task ${median.toFixed(1)} ms (${durations.join(', ')})`)
})
