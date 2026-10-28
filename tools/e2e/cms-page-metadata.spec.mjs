import { nativeBackend } from './cms-backend.mjs'
import { expect, test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

test.use({ viewport: { width: 1440, height: 1000 } })

test('page metadata preserves trusted pending body edits when a menu change rebuilds the header', async ({
  page,
  context,
}) => {
  const backend = await nativeBackend(context)
  await page.clock.install()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
  await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Ny sida', exact: true })
    .getByRole('button', { name: 'Skapa sida', exact: true })
    .click()
  const frame = page.frameLocator('.gjs-frame').first()
  const heading = frame.locator('main[id^="cms-body-"] h1')
  const metadata = page.locator('.cms-page-meta')
  const changes = [
    ['name', 'Namn', 'Ägarens sida'],
    ['title', 'Titel / SEO', 'Ägarens söktitel'],
    ['description', 'Beskrivning', 'Ägarens sökbeskrivning'],
    ['menu', 'Visa i meny', false],
  ]
  let latestText = ''
  for (const [key, label, value] of changes) {
    await heading.click()
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 2000)
    latestText = `Betrodd text före ${key}`
    await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(latestText)
    await expect(heading).toHaveText(latestText)
    // Opening page settings does not wait out the editor's 180 ms export debounce. These are
    // real input/click actions while that timer is held, so the metadata boundary must flush it.
    await page.getByRole('button', { name: 'Sidinställningar', exact: true }).click({ force: true })
    if (key === 'menu') await metadata.getByLabel(label, { exact: true }).uncheck({ force: true })
    else await metadata.getByLabel(label, { exact: true }).fill(value)
    await page.clock.resume()
    await expect(heading, `the canvas body survives ${key}`).toHaveText(latestText)
  }
  await expect(frame.locator('#cms-site-menu a[href^="/hemsida?"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.getByText('Publicerad · rev 2', { exact: true }).waitFor()
  const saved = backend.document.presentation.pages.find((item) => item.path === '/hemsida')
  expect(saved.inMenu).toBe(false)
  expect(saved.name.sv).toBe('Ägarens sida')
  expect(saved.title.sv).toBe('Ägarens söktitel')
  expect(saved.description.sv).toBe('Ägarens sökbeskrivning')
  expect(saved.content.sv.html).toContain(latestText)
  expect(saved.content.sv.html).not.toContain('cms-site-header')
  await page.reload()
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  await page.getByRole('button', { name: 'Ägarens sida', exact: true }).click()
  await expect(heading).toHaveText(latestText)
  await expect(frame.locator('#cms-site-menu a[href^="/hemsida?"]')).toHaveCount(0)
})
