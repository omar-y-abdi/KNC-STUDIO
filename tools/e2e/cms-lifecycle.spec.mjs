/* global Event, indexedDB, MessageChannel, performance, setTimeout */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-backend.mjs'
import { expect, test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

// The owner's draft lifecycle: drafts of closed tabs, a failed layout capture, production size.
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

// Home page names of the drafts IndexedDB holds, by tab. Read only after the studio created it.
const storedDrafts = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('knc-cms-drafts', 1)
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const request = opening.result.transaction('records').objectStore('records').getAll()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            opening.result.close()
            resolve(
              request.result
                .map((record) => JSON.parse(record.document).presentation.pages[0]?.name.sv)
                .sort(),
            )
          }
        }
      }),
  )

const nameField = (page) => page.getByRole('textbox', { name: 'Namn', exact: true })

test('cms-lifecycle closed tabs keep their drafts until the owner acts', async ({ context }) => {
  await nativeBackend(context)
  // Publish the seeded site first, so every tab starts from a clean draft.
  const setup = await context.newPage()
  await openStudio(setup)
  await setup.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect(setup.locator('.cms-status')).toHaveText(/^Publicerad/)
  await expect.poll(() => storedDrafts(setup)).toEqual([])
  await setup.close()
  for (const name of ['Utkast från flik ett', 'Utkast från flik två']) {
    const tab = await context.newPage()
    await openStudio(tab)
    await nameField(tab).fill(name)
    await expect.poll(() => storedDrafts(tab)).toContain(name)
    await tab.close()
  }

  const third = await context.newPage()
  await openStudio(third)
  const offers = third.getByRole('region', { name: 'Utkast från stängda flikar', exact: true })
  await third.getByText('2 opublicerade utkast från stängda flikar finns kvar.').waitFor()
  await third.reload()
  await openStudio(third)
  await third.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  await expect(offers.getByRole('listitem')).toHaveCount(2)
  assert.deepEqual(await storedDrafts(third), ['Utkast från flik ett', 'Utkast från flik två'])

  // Newest first: tab two wrote last.
  await offers.getByRole('listitem').first().getByRole('button', { name: 'Kasta' }).click()
  await expect(offers.getByRole('listitem')).toHaveCount(1)
  assert.deepEqual(await storedDrafts(third), ['Utkast från flik ett'])
  await offers.getByRole('button', { name: 'Fortsätt här', exact: true }).click()
  await expect(nameField(third)).toHaveValue('Utkast från flik ett')
  await expect(offers).toHaveCount(0)
  await expect.poll(() => storedDrafts(third)).toEqual(['Utkast från flik ett'])
  await third.reload()
  await openStudio(third)
  await expect(nameField(third)).toHaveValue('Utkast från flik ett')
  await expect(third.getByRole('button', { name: 'Visa utkast', exact: true })).toHaveCount(0)
})

test('cms-lifecycle flushes the draft when the tab is hidden or closed', async ({
  page,
  context,
}) => {
  await nativeBackend(context)
  await openStudio(page)
  await nameField(page).fill('Precis innan stängning')
  await page.evaluate(() =>
    globalThis.dispatchEvent(new globalThis.PageTransitionEvent('pagehide')),
  )
  // Well inside the 500 ms debounce: only the flush can have written it.
  await expect.poll(() => storedDrafts(page), { timeout: 400 }).toEqual(['Precis innan stängning'])
})

const salonImage = {
  id: '7c000000-0000-4000-8000-000000000001',
  bucket: 'gallery',
  path: 'salon/7c000000-0000-4000-8000-000000000001.webp',
  name: 'Salongsbild.webp',
  alt: '',
  mime: 'image/webp',
  width: 1,
  height: 1,
  bytes: 1,
  archived: false,
  version: 0,
}

test('cms-lifecycle a failed capture keeps the assignment and guards Publicera', async ({
  page,
  context,
}) => {
  const backend = await nativeBackend(context, emptyDocument(), [salonImage])
  await openStudio(page)
  const source = '**/cms-public/source?preview=1'
  await context.route(source, (route) => route.abort())
  await page
    .locator('.cms-library-tabs')
    .getByRole('button', { name: 'Resurser', exact: true })
    .click()
  await page.locator('.cms-resource-card button').filter({ hasText: salonImage.name }).click()
  await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
  await page
    .getByText('Filen är tilldelad. Förhandsvisningen uppdateras när du publicerar.', {
      exact: true,
    })
    .waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: 'Dölj från sidan', exact: true }).waitFor()
  await expect(page.locator('.cms-status')).toHaveText('Opublicerade ändringar')

  const publish = page.getByRole('button', { name: 'Publicera', exact: true })
  await publish.click()
  await page
    .getByText(/^Inget publicerades: startsidan och Om oss kunde inte uppdateras/)
    .waitFor({ timeout: 45000 })
  assert.equal(backend.writes.filter((write) => write === 'publish').length, 0)
  await expect(page.locator('.cms-status')).toHaveText('Opublicerade ändringar')

  await context.unroute(source)
  await publish.click()
  await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/, { timeout: 45000 })
  assert.equal(backend.writes.filter((write) => write === 'publish').length, 1)
  assert.deepEqual(
    backend.document.gallery.map((row) => row.storage_path),
    [salonImage.path],
  )
})

test('cms-lifecycle a page-name edit stays a short task at production size', async ({
  page,
  context,
}) => {
  const fixture = JSON.parse(
    gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
  )
  await nativeBackend(context, { ...emptyDocument(), presentation: fixture.presentation })
  await openStudio(page)
  const durations = await nameField(page).evaluate(async (input) => {
    // The longest gap between back-to-back tasks is the longest task the edit caused,
    // including its render and effects, in every engine (WebKit has no Long Tasks API).
    const longestTask = async (value) => {
      const channel = new MessageChannel()
      let running = true
      let last = performance.now()
      let longest = 0
      channel.port1.onmessage = () => {
        const now = performance.now()
        longest = Math.max(longest, now - last)
        last = now
        if (running) channel.port2.postMessage(null)
      }
      channel.port2.postMessage(null)
      await new Promise((resolve) => setTimeout(resolve, 100))
      longest = 0
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 400))
      running = false
      return longest
    }
    const samples = []
    for (const value of ['Startsida A', 'Startsida AB', 'Startsida ABC'])
      samples.push(await longestTask(value))
    return samples
  })
  const median = [...durations].sort((a, b) => a - b)[1]
  console.log(`page-name edit longest task ms: ${durations.map((ms) => ms.toFixed(1)).join(', ')}`)
  assert.ok(median < 30, `median longest task ${median.toFixed(1)} ms (${durations.join(', ')})`)
})
