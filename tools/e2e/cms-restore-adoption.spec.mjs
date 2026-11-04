import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { emptyDocument, validateDocument } from '../../shared/cms.ts'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets.ts'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup.ts'
import { createSitePage } from '../../shared/site-page.ts'
import { nativeBackend } from './cms-backend.mjs'
import { expect, test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { routeApi } from './route-api.mjs'

test.use({ viewport: { width: 1440, height: 900 } })

const legacyDocument = async () => ({
  ...emptyDocument(),
  presentation: JSON.parse(
    gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
  ).presentation,
})

async function mountStudio(page) {
  await renderStudio(page)
  await page
    .frameLocator('.gjs-frame')
    .first()
    .locator('[data-knc-surface="desktop-home"]')
    .waitFor({ timeout: 90000 })
}

async function renderStudio(page) {
  await page.evaluate(async () => {
    const { CmsDraft } = await import('/src/admin/cms/draft.ts')
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { CmsStudio } = await import('/src/admin/cms/Studio.tsx')
    // A migration-only draft writes no backup, so the test reads the live draft that migrated.
    if (!CmsDraft.prototype.migrate.recordsDraft) {
      const migrate = CmsDraft.prototype.migrate
      CmsDraft.prototype.migrate = function (...args) {
        migrate.apply(this, args)
        globalThis.cmsMigratedDraft = this
      }
      CmsDraft.prototype.migrate.recordsDraft = true
    }
    globalThis.cmsMigratedDraft = undefined
    const root = globalThis.document.querySelector('#root')
    render(h(CmsStudio, { onExit: () => render(null, root) }), root)
  })
}

async function openStudio(page) {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await mountStudio(page)
}

// What identifies the page's current document and module lifetime: a token the first read in a
// document creates. A reload starts a new document without it; exit/reopen keeps it.
const lifetime = (page) =>
  page.evaluate(() => (globalThis.cmsLifetime ??= globalThis.crypto.randomUUID()))

async function reopenStudio(page) {
  const before = await lifetime(page)
  if (await page.getByRole('dialog', { name: 'Utkast & backup', exact: true }).count())
    await closeBackup(page)
  await page.getByTitle('Tillbaka till Admin', { exact: true }).click()
  await expect(page.locator('.knc-cms-studio')).toHaveCount(0)
  await mountStudio(page)
  assert.equal(
    await lifetime(page),
    before,
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
// The document and publication base of the Studio's live draft after its source upgrade.
const liveDraft = (page) =>
  page.evaluate(() => {
    const draft = globalThis.cmsMigratedDraft
    return draft && { document: draft.document, base: draft.base }
  })

async function closedDraft(context, name) {
  const tab = await context.newPage()
  await openStudio(tab)
  await nameField(tab).fill(name)
  await expect
    .poll(async () => (await ownBackup(tab))?.document.presentation.pages[0]?.name.sv)
    .toBe(name)
  // Let the donor finish its background source imports before closing its WebKit page.
  // The receiving Studio is still mounted only after this donor tab is closed.
  await waitForSourceUpgrade(tab)
  // The donor has owner edits, so the recipient's offer is this backup, not the live draft.
  await waitForSourceUpgrade(tab, ownBackup)
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
  await waitForSourceUpgrade(recipient)
  const migrated = await liveDraft(recipient)
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

// Only a draft with owner edits has a backup to read; see mountStudio.
async function waitForSourceUpgrade(page, read = liveDraft) {
  await page
    .locator('iframe[title="Läser den befintliga webbplatsen"]')
    .waitFor({ state: 'detached', timeout: 90000 })
  await expect
    .poll(
      async () =>
        (await read(page))?.document.presentation.pages
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
  // Load the harness before intercepting the Studio-only background source request.
  await recipient.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  const source = holdSource(recipient)
  await source.install()
  try {
    await mountStudio(recipient)
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
    await waitForSourceUpgrade(recipient, ownBackup)
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
  // Load the harness before intercepting the Studio-only background source request.
  await recipient.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  const source = holdSource(recipient)
  await source.install()
  try {
    await mountStudio(recipient)
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
      JSON.stringify((await liveDraft(recipient)).document).includes(text),
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
  // Isolate one automatic source upgrade. A migration-only draft keeps no backup, so each Studio
  // load repeats it on the stored head; after it this current native layout is complete.
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
      const { needsCorePageSource } = await import('/src/admin/cms/corePages.ts')
      return needsCorePageSource(globalThis.cmsMigratedDraft.document)
    }),
    false,
    'The live draft must hold the complete automatic source upgrade before reopening',
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

// WebKit has returned timeOrigin values 1 ms apart within one page. Drift on every read.
async function reopenStudioWhileClockDrifts(page) {
  await page.evaluate(() => {
    const origin = globalThis.performance.timeOrigin
    let reads = 0
    Object.defineProperty(globalThis.performance, 'timeOrigin', {
      configurable: true,
      get: () => origin + reads++,
    })
  })
  await reopenStudio(page)
}

for (const [method, reopen] of [
  ['reloading Studio', openStudio],
  ['exiting and reopening Studio in the same page', reopenStudio],
  ['exiting and reopening Studio while the page clock drifts', reopenStudioWhileClockDrifts],
]) {
  test(`cms-restore-adoption a migration-only autosave stays eligible after ${method}`, async ({
    context,
  }) => {
    await checkAutosaveRecovery(context, reopen)
  })
}

test('cms-restore-adoption reloading Studio starts a new lifetime', async ({ context }) => {
  await nativeBackend(context)
  const page = await context.newPage()
  await openStudio(page)
  const before = await lifetime(page)
  await openStudio(page)
  assert.notEqual(
    await lifetime(page),
    before,
    'A reload must start a new document and module lifetime',
  )
})

// The publication validators the fake cms-studio applies, for the heads these tests build.
const publicationPolicy = {
  siteOrigin: new URL(harnessOrigin).origin,
  storageOrigin: 'https://admin-harness.invalid',
  builtAssets: CMS_BUILT_ASSETS,
}
function accepted(document) {
  validateDocument(document)
  validateDocumentMarkupPlacements(document, publicationPolicy)
}

// Studio's own adoption of an empty site, published once: a complete current head, revision 2.
async function publishedHead(context) {
  const backend = await nativeBackend(context)
  const setup = await context.newPage()
  await openStudio(setup)
  await setup.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect(setup.locator('.cms-status')).toHaveText('Publicerad · rev 2', { timeout: 45000 })
  await setup.close()
  return backend
}

const needsSource = (page, document) =>
  page.evaluate(
    async (value) => (await import('/src/admin/cms/corePages.ts')).needsCorePageSource(value),
    document,
  )

// The background source upgrade has migrated the live draft once (see mountStudio).
const waitForMigration = (page) =>
  expect
    .poll(() => page.evaluate(() => Boolean(globalThis.cmsMigratedDraft)), { timeout: 90000 })
    .toBe(true)

// Publicera as the owner clicks it; the endpoint's answer names any rejection.
async function publishNow(page, revision) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/functions/v1/cms-studio') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.operation === 'publish',
      { timeout: 90000 },
    ),
    page.getByRole('button', { name: 'Publicera', exact: true }).click(),
  ])
  assert.equal(response.status(), 200, `Publication rejected: ${await response.text()}`)
  await expect(page.locator('.cms-status')).toHaveText(`Publicerad · rev ${revision}`, {
    timeout: 45000,
  })
}

// The Studio JSON import, from the backup dialog that holds it.
async function importDocument(page, document, name) {
  await page.getByRole('button', { name: /Utkast & backup/ }).click()
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  })
  await page
    .getByText('JSON-utkastet importerades och är ännu inte publicerat.', { exact: true })
    .waitFor()
  await closeBackup(page)
}

const contactOf = (document) => document.presentation.pages.find(({ path }) => path === '/contact')
const CONTACT_ID = '10000000-0000-4000-8000-000000000007'
// A Contact page an earlier Studio created at /contact under a random identity.
const HISTORICAL_CONTACT_ID = '20000000-0000-4000-8000-000000000099'
const createdPage = (index, id = `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`) =>
  createSitePage({ id, path: `/sida-${index}`, name: { sv: `Sida ${index}`, en: `Page ${index}` } })

// G06: adding the mandatory Contact page must respect the page budget and page identities.
for (const { label, count, reserved } of [
  { label: 'at the 50-page maximum', count: 50, reserved: false },
  {
    label: 'at the 50-page maximum beside a page on the reserved Contact identity',
    count: 50,
    reserved: true,
  },
  { label: 'beside a created page on the reserved Contact identity', count: 7, reserved: true },
]) {
  test(`cms-restore-adoption the Contact upgrade keeps a pre-Contact head publishable ${label}`, async ({
    context,
  }) => {
    const backend = await publishedHead(context)
    // The published head as it stood before Contact became a core page, with created pages.
    const head = backend.document
    head.presentation.pages = head.presentation.pages.filter(({ path }) => path !== '/contact')
    for (let index = 1; head.presentation.pages.length < count; index++)
      head.presentation.pages.push(
        createdPage(index, reserved && index === 1 ? CONTACT_ID : undefined),
      )
    accepted(head)
    const original = globalThis.structuredClone(head)
    const page = await context.newPage()
    await openStudio(page)
    assert.equal(await needsSource(page, original), true, 'Only Contact needs the source')
    await waitForMigration(page)
    const name = 'Startsida efter Kontakt-uppgraderingen'
    await nameField(page).fill(name)
    await publishNow(page, 3)
    const published = globalThis.structuredClone(backend.document)
    accepted(published)
    assert.ok(published.presentation.pages.filter((item) => item.path === '/contact').length <= 1)
    for (const before of original.presentation.pages) {
      const after = published.presentation.pages.find(({ id }) => id === before.id)
      assert.deepEqual(
        { path: after?.path, content: after?.content },
        { path: before.path, content: before.content },
        `${before.path} keeps its identity and content`,
      )
    }
    assert.equal(published.presentation.pages.find(({ path }) => path === '/')?.name.sv, name)
    // The next visit opens the published head as published.
    const reopened = await context.newPage()
    await openStudio(reopened)
    if (await needsSource(reopened, published)) await waitForMigration(reopened)
    await expect(reopened.locator('.cms-status')).toHaveText('Publicerad · rev 3')
  })
}

// G07: a revision from before Contact must not drop the current Contact, whatever its identity.
for (const path of ['history restore', 'JSON import']) {
  test(`cms-restore-adoption ${path} of a pre-Contact revision keeps a current Contact with a historical identity`, async ({
    context,
  }) => {
    const backend = await publishedHead(context)
    const head = backend.document
    contactOf(head).id = HISTORICAL_CONTACT_ID
    accepted(head)
    const current = globalThis.structuredClone(contactOf(head))
    const preContact = globalThis.structuredClone(head)
    preContact.presentation.pages = preContact.presentation.pages.filter(
      (page) => page.path !== '/contact',
    )
    preContact.presentation.pages[0].name.sv = 'Startsida före Kontakt'
    accepted(preContact)
    // History revision 1 holds the same site from before Contact existed.
    await routeApi(context, [
      [
        '**/functions/v1/cms-studio',
        (route, headers) => {
          const body = route.request().postDataJSON()
          return body?.operation === 'revision' && body.revision === 1
            ? route.fulfill({ headers, json: { document: preContact } })
            : route.fallback()
        },
      ],
    ])
    const page = await context.newPage()
    await openStudio(page)
    assert.equal(await needsSource(page, head), false, 'The complete head needs no source')
    await expect(page.locator('.cms-status')).toHaveText('Publicerad · rev 2')
    if (path === 'history restore') {
      await page.getByRole('button', { name: 'Historik', exact: true }).click()
      await page
        .locator('.cms-history-row')
        .filter({ has: page.getByText('v1', { exact: true }) })
        .getByRole('button', { name: 'Återställ till utkast', exact: true })
        .click()
    } else await importDocument(page, preContact, 'fore-kontakt.json')
    await expect(nameField(page)).toHaveValue('Startsida före Kontakt')
    await publishNow(page, 3)
    assert.deepEqual(
      contactOf(backend.document),
      current,
      `${path} of a revision from before Contact must keep the current Contact`,
    )
  })
}

// G08: an empty historical Contact variant is optional upgrade work, never a source dependency.
const OFFLINE_SOURCE =
  '<!doctype html><html data-knc-source-listening="1"><script>addEventListener("message",e=>{document.documentElement.dataset.kncSourceError=e.data.id;document.documentElement.dataset.kncSourceFailure="Offline source"})</script></html>'
const CONTACT_BODIES = {
  sv: '<main id="kontakt"><h1>Kontakta oss</h1><p>Ring salongen.</p></main>',
  en: '<main id="contact"><h1>Contact us</h1><p>Call the salon.</p></main>',
}
const historicalContact = (html) => ({
  id: HISTORICAL_CONTACT_ID,
  path: '/contact',
  kind: 'page',
  inMenu: false,
  name: { sv: 'Kontakt', en: 'Contact' },
  title: { sv: 'Kontakt', en: 'Contact' },
  description: { sv: '', en: '' },
  content: {
    sv: { html: html.sv, css: { light: '#kontakt{padding:8px}', dark: '#kontakt{padding:8px}' } },
    en: { html: html.en, css: { light: '#contact{padding:8px}', dark: '#contact{padding:8px}' } },
  },
})

for (const [label, html] of [
  ['an empty Swedish body', { sv: '', en: CONTACT_BODIES.en }],
  ['an empty English body', { sv: CONTACT_BODIES.sv, en: '' }],
  ['both bodies empty', { sv: '', en: '' }],
  ['a complete body', CONTACT_BODIES],
]) {
  test(`cms-restore-adoption stored pages open without the source beside a historical Contact with ${label}`, async ({
    context,
    page,
  }) => {
    const initial = await legacyWithoutBookingMarkers()
    const contact = historicalContact(html)
    initial.presentation.pages.push(contact)
    accepted(initial)
    const backend = await nativeBackend(context, initial)
    const source = '**/cms-public/source'
    const offline = (route) => route.fulfill({ contentType: 'text/html', body: OFFLINE_SOURCE })
    await context.route(source, offline)
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
    assert.equal(await needsSource(page, initial), true, 'Optional source upgrades remain')
    await renderStudio(page)
    const blocked = page.locator('.cms-loading [role="alert"]')
    await page.locator('.gjs-frame').or(blocked).first().waitFor({ timeout: 90000 })
    assert.equal(
      await blocked.count(),
      0,
      `Studio did not open: ${(await page.locator('.cms-loading').allTextContents()).join(' ')}`,
    )
    await page
      .frameLocator('.gjs-frame')
      .first()
      .locator('[data-knc-surface="desktop-home"]')
      .waitFor({ timeout: 90000 })
    await expect(page.getByRole('button', { name: 'Publicera', exact: true })).toBeEnabled()
    const failure = page
      .getByRole('alert')
      .filter({ hasText: 'Fler redigeringsvyer kunde inte förberedas.' })
    await expect(failure).toContainText('Offline source', { timeout: 90000 })
    // Recovery: the source answers again and the optional upgrade completes.
    await context.unroute(source, offline)
    await failure.getByRole('button', { name: 'Försök igen', exact: true }).click()
    await waitForSourceUpgrade(page)
    const authored = ['sv', 'en'].filter((lang) => html[lang])
    const migrated = contactOf((await liveDraft(page)).document)
    for (const lang of authored)
      assert.deepEqual(migrated?.content[lang], contact.content[lang], `${lang} Contact bytes`)
    await publishNow(page, 2)
    for (const lang of authored)
      assert.deepEqual(contactOf(backend.document)?.content[lang], contact.content[lang])
  })
}
