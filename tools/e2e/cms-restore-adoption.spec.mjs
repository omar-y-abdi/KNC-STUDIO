import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-backend.mjs'
import { expect, test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

test.use({ viewport: { width: 1440, height: 900 } })

const legacyDocument = async () => ({
  ...emptyDocument(),
  presentation: JSON.parse(
    gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
  ).presentation,
})

async function mountStudio(page) {
  await page.evaluate(async () => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { CmsStudio } = await import('/src/admin/cms/Studio.tsx')
    const root = globalThis.document.querySelector('#root')
    render(h(CmsStudio, { onExit: () => render(null, root) }), root)
  })
  await page
    .frameLocator('.gjs-frame')
    .first()
    .locator('[data-knc-surface="desktop-home"]')
    .waitFor({ timeout: 90000 })
}

async function openStudio(page) {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await mountStudio(page)
}

async function reopenStudio(page) {
  const timeOrigin = await page.evaluate(() => globalThis.performance.timeOrigin)
  if (await page.getByRole('dialog', { name: 'Utkast & backup', exact: true }).count())
    await closeBackup(page)
  await page.getByTitle('Tillbaka till Admin', { exact: true }).click()
  await expect(page.locator('.knc-cms-studio')).toHaveCount(0)
  await mountStudio(page)
  assert.equal(
    await page.evaluate(() => globalThis.performance.timeOrigin),
    timeOrigin,
    'Exit/reopen must retain the same document and module lifetime',
  )
}

const nameField = (page) => page.getByRole('textbox', { name: 'Namn', exact: true })
const offers = (page) =>
  page.getByRole('region', { name: 'Utkast från stängda flikar', exact: true })
const continueHere = (page) =>
  offers(page).getByRole('button', { name: 'Fortsätt här', exact: true })
const ownBackup = (page) =>
  page.evaluate(async () => {
    const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
    await session.flush()
    return session.own()
  })

async function closedDraft(context, name) {
  const tab = await context.newPage()
  await openStudio(tab)
  await nameField(tab).fill(name)
  await expect
    .poll(async () => (await ownBackup(tab))?.document.presentation.pages[0]?.name.sv)
    .toBe(name)
  await tab.close()
}

test('cms-restore-adoption untouched legacy publication can adopt without publishing migrations', async ({
  context,
}) => {
  const initial = await legacyDocument()
  const backend = await nativeBackend(context, initial)
  const recoveredName = 'Återställt från stängd flik före migreringspublicering'
  await closedDraft(context, recoveredName)
  const recipient = await context.newPage()
  await openStudio(recipient)
  await expect(recipient.locator('.cms-status')).toHaveText('Opublicerade ändringar')
  const migrated = await ownBackup(recipient)
  assert.deepEqual(migrated.base, initial, 'The raw server snapshot remains the publication base')
  const changedLegalPages = initial.presentation.pages
    .filter((page) => ['/privacy', '/terms'].includes(page.path))
    .filter(
      (page) =>
        JSON.stringify(page) !==
        JSON.stringify(migrated.document.presentation.pages.find((next) => next.id === page.id)),
    )
    .map((page) => page.path)
  assert.deepEqual(changedLegalPages.sort(), ['/privacy', '/terms'])
  await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  await test.info().attach('legacy-adoption-before-click', {
    contentType: 'application/json',
    body: JSON.stringify({
      changedLegalPages,
      publicationStatus: await recipient.locator('.cms-status').textContent(),
      adoptionDisabled: await continueHere(recipient).isDisabled(),
      publicationRequests: backend.requests.filter((request) => request.operation === 'publish')
        .length,
    }),
  })
  await expect(continueHere(recipient)).toBeEnabled()
  await continueHere(recipient).click()
  await expect(nameField(recipient)).toHaveValue(recoveredName)
  await expect(recipient.locator('.cms-status')).toHaveText('Opublicerade ändringar')
  await expect(recipient.getByRole('button', { name: 'Visa utkast', exact: true })).toHaveCount(0)
  assert.equal((await ownBackup(recipient)).document.presentation.pages[0].name.sv, recoveredName)
  assert.deepEqual(backend.document, initial, 'Recovery must not publish the migrated document')
  assert.equal(backend.requests.filter((request) => request.operation === 'publish').length, 0)
})

async function waitForSourceUpgrade(page) {
  await page
    .locator('iframe[title="Läser den befintliga webbplatsen"]')
    .waitFor({ state: 'detached', timeout: 90000 })
  await expect
    .poll(
      async () =>
        (await ownBackup(page))?.document.presentation.pages
          .find((item) => item.path === '/booking')
          ?.content.sv.html.includes('data-knc-fold="booking-flow"'),
      { timeout: 90000 },
    )
    .toBe(true)
}

const closeBackup = (page) =>
  page
    .getByRole('dialog', { name: 'Utkast & backup', exact: true })
    .getByRole('button', { name: 'Stäng panel', exact: true })
    .click()

function gate() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

// A valid older stored layout opens immediately while optional source scenes load in the background.
async function legacyWithoutBookingMarkers() {
  const initial = await legacyDocument()
  let removed = false
  for (const page of initial.presentation.pages)
    if (page.path === '/booking')
      for (const variant of Object.values(page.content)) {
        const original = variant.html
        variant.html = original.replaceAll(' data-knc-fold="booking-flow"', '')
        removed ||= original !== variant.html
      }
  assert.equal(removed, true, 'The fixture must exercise the actual optional source upgrade')
  return initial
}

function holdSource(page) {
  const started = gate()
  const done = gate()
  const pattern = '**/cms-public/source'
  const handler = async (route) => {
    started.release()
    await done.promise
    await route.fallback()
  }
  return { started, done, pattern, handler, install: () => page.route(pattern, handler) }
}

test('cms-restore-adoption preserves owner edits across source migration, export, undo and reset', async ({
  context,
}) => {
  const initial = await legacyWithoutBookingMarkers()
  const backend = await nativeBackend(context, initial)
  const recoveredName = 'Stängda flikens bevarade utkast'
  await closedDraft(context, recoveredName)
  const recipient = await context.newPage()
  const source = holdSource(recipient)
  await source.install()
  try {
    await openStudio(recipient)
    await source.started.promise
    const editedName = 'Egen ändring under källuppdateringen'
    await nameField(recipient).fill(editedName)
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeDisabled()
    await expect(offers(recipient)).toContainText('välj Export och sedan Återställ')
    const [download] = await Promise.all([
      recipient.waitForEvent('download'),
      recipient.getByRole('button', { name: 'Export', exact: true }).click(),
    ])
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
    assert.equal(exported.presentation.pages[0].name.sv, editedName)
    await expect(continueHere(recipient)).toBeDisabled()

    source.done.release()
    await waitForSourceUpgrade(recipient)
    await expect(continueHere(recipient)).toBeDisabled()
    assert.equal((await ownBackup(recipient)).document.presentation.pages[0].name.sv, editedName)
    await closeBackup(recipient)
    await recipient.getByRole('button', { name: 'Ångra', exact: true }).click()
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeEnabled()
    await expect(recipient.locator('.cms-status')).toHaveText('Opublicerade ändringar')
    await closeBackup(recipient)
    await recipient.getByRole('button', { name: 'Gör om', exact: true }).click()
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeDisabled()
    await closeBackup(recipient)
    await recipient.locator('button.cms-revert').click()
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeEnabled()
    await expect(recipient.locator('.cms-status')).toHaveText('Opublicerade ändringar')
    await closeBackup(recipient)
    await recipient.getByRole('button', { name: 'Ångra', exact: true }).click()
    await expect(nameField(recipient)).toHaveValue(editedName)
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeDisabled()
    await closeBackup(recipient)
    await recipient.getByRole('button', { name: 'Gör om', exact: true }).click()
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeEnabled()
    await expect(recipient.locator('.cms-status')).toHaveText('Opublicerade ändringar')
    await continueHere(recipient).click()
    await expect(nameField(recipient)).toHaveValue(recoveredName)
    assert.deepEqual(backend.document, initial)
    assert.equal(backend.requests.filter((request) => request.operation === 'publish').length, 0)
  } finally {
    source.done.release()
    await recipient.unroute(source.pattern, source.handler)
  }
})

test('cms-restore-adoption reset remains eligible when a pending source upgrade completes', async ({
  context,
}) => {
  const initial = await legacyWithoutBookingMarkers()
  const backend = await nativeBackend(context, initial)
  const recoveredName = 'Återställning efter väntande källuppdatering'
  await closedDraft(context, recoveredName)
  const recipient = await context.newPage()
  const source = holdSource(recipient)
  await source.install()
  try {
    await openStudio(recipient)
    await source.started.promise
    await nameField(recipient).fill('Den här ändringen återställs')
    await recipient.locator('button.cms-revert').click()
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeEnabled()
    source.done.release()
    await waitForSourceUpgrade(recipient)
    await expect(continueHere(recipient)).toBeEnabled()
    await expect(recipient.locator('.cms-status')).toHaveText('Opublicerade ändringar')
    await continueHere(recipient).click()
    await expect(nameField(recipient)).toHaveValue(recoveredName)
    assert.deepEqual(backend.document, initial)
    assert.equal(backend.requests.filter((request) => request.operation === 'publish').length, 0)
  } finally {
    source.done.release()
    await recipient.unroute(source.pattern, source.handler)
  }
})

test('cms-restore-adoption flushes a trusted pending canvas edit when opening the offers', async ({
  context,
}) => {
  const initial = await legacyDocument()
  const backend = await nativeBackend(context, initial)
  await closedDraft(context, 'Stängd flik väntar medan canvas sparas')
  const recipient = await context.newPage()
  await recipient.clock.install()
  await openStudio(recipient)
  await waitForSourceUpgrade(recipient)
  // Select an actual authored component; the content edit below comes from trusted inspector input.
  await recipient.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const element = [...editor.Canvas.getDocument().querySelectorAll('[data-knc-source]')].find(
      (node) =>
        node.children.length === 0 &&
        node.textContent.trim().length > 3 &&
        node.id &&
        !node.closest('svg, a, button, [data-knc-slot]'),
    )
    if (!element) throw new Error('No authored source text in the actual canvas')
    const component = editor.getWrapper().find(`#${globalThis.CSS.escape(element.id)}`)[0]
    if (!component) throw new Error('Actual source component missing')
    editor.select(component)
  })
  const inspector = recipient.getByRole('textbox', { name: 'Text', exact: true })
  await inspector.waitFor()
  await recipient.clock.pauseAt((await recipient.evaluate(() => Date.now())) + 2_000)
  const text = 'Canvasändringen måste bevaras före adoption'
  try {
    await inspector.fill(text)
    assert.equal(
      JSON.stringify((await ownBackup(recipient)).document).includes(text),
      false,
      'The trusted edit must still be waiting for the frozen capture timer',
    )
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await expect(continueHere(recipient)).toBeDisabled()
    await expect(offers(recipient).getByRole('listitem')).toHaveCount(1)
    assert.ok(JSON.stringify((await ownBackup(recipient)).document).includes(text))
    assert.equal(backend.requests.filter((request) => request.operation === 'publish').length, 0)
    assert.deepEqual(backend.document, initial)
    await closeBackup(recipient)
    await expect(
      recipient.frameLocator('.gjs-frame').first().getByText(text, { exact: true }).first(),
    ).toBeVisible()
  } finally {
    await recipient.clock.resume()
  }
})

async function checkAutosaveRecovery(context, reopen) {
  const backend = await nativeBackend(context)
  const setup = await context.newPage()
  await openStudio(setup)
  await setup.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect(setup.locator('.cms-status')).toHaveText(/^Publicerad/)
  assert.equal(await ownBackup(setup), null)
  await setup.close()
  // Isolate one automatic source upgrade. After migration this current native layout is complete,
  // so the recovered document itself no longer requests source on the next Studio load.
  for (const page of backend.document.presentation.pages)
    if (page.path === '/booking')
      for (const variant of Object.values(page.content))
        variant.html = variant.html.replaceAll(' data-knc-fold="booking-flow"', '')
  const initial = globalThis.structuredClone(backend.document)
  const recoveredName = 'Stängt utkast efter mottagarens omladdning'
  await closedDraft(context, recoveredName)
  const recipient = await context.newPage()
  await openStudio(recipient)
  await waitForSourceUpgrade(recipient)
  assert.equal(
    await recipient.evaluate(async () => {
      const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
      const { needsCorePageSource } = await import('/src/admin/cms/corePages.ts')
      return needsCorePageSource((await session.own()).document)
    }),
    false,
    'The persisted automatic source upgrade must be complete before reopening',
  )
  await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  await expect(continueHere(recipient)).toBeEnabled()
  await reopen(recipient)
  await waitForSourceUpgrade(recipient)
  await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  await expect(continueHere(recipient)).toBeEnabled()
  // The same rehydration must keep an actual author edit protected even when its source is ready.
  await closeBackup(recipient)
  const editedName = 'Egen ändring som överlever omladdning'
  await nameField(recipient).fill(editedName)
  assert.equal((await ownBackup(recipient)).document.presentation.pages[0].name.sv, editedName)
  await reopen(recipient)
  await waitForSourceUpgrade(recipient)
  await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  await expect(continueHere(recipient)).toBeDisabled()
  await closeBackup(recipient)
  await expect(nameField(recipient)).toHaveValue(editedName)
  await recipient.locator('button.cms-revert').click()
  await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  await expect(continueHere(recipient)).toBeEnabled()
  await continueHere(recipient).click()
  await expect(nameField(recipient)).toHaveValue(recoveredName)
  await expect(recipient.locator('.cms-status')).toHaveText('Opublicerade ändringar')
  assert.deepEqual(backend.document, initial)
  assert.equal(backend.requests.filter((request) => request.operation === 'publish').length, 1)
}

for (const [method, reopen] of [
  ['reloading Studio', openStudio],
  ['exiting and reopening Studio in the same page', reopenStudio],
]) {
  test(`cms-restore-adoption a migration-only autosave stays eligible after ${method}`, async ({
    context,
  }) => {
    await checkAutosaveRecovery(context, reopen)
  })
}
