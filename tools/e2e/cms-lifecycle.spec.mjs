/* global Event, indexedDB */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { emptyDocument } from '../../shared/cms.ts'
import { createSitePage } from '../../shared/site-page.ts'
import { nativeBackend } from './cms-backend.mjs'
import { attachTabState } from './cms-tab-state.mjs'
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

// Whether a draft IndexedDB holds contains `text`.
const draftHolds = (page, text) =>
  page.evaluate(
    (needle) =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('knc-cms-drafts', 1)
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const request = opening.result.transaction('records').objectStore('records').getAll()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            opening.result.close()
            resolve(request.result.some((record) => record.document.includes(needle)))
          }
        }
      }),
    text,
  )

// Edits an authored source text of the canvas (not a resource slot, which a capture renders again)
// through the actual GrapesJS instance. The editor hands the edit to the draft 180 ms later.
const editCanvas = (page, text) =>
  page.evaluate(async (value) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    if (!editor) throw new Error('Actual GrapesJS instance missing')
    const element = [...editor.Canvas.getDocument().querySelectorAll('[data-knc-source]')].find(
      (node) =>
        node.children.length === 0 &&
        node.textContent.trim().length > 3 &&
        node.id &&
        !node.closest('svg, a, button, [data-knc-slot]'),
    )
    if (!element) throw new Error('No source text in the canvas')
    const component = editor.getWrapper().find(`#${globalThis.CSS.escape(element.id)}`)[0]
    if (!component) throw new Error('Source component missing')
    component.components(value)
  }, text)

// From here the page clock moves only when the test resumes it, so the editor's 180 ms and the
// backup's 500 ms timers cannot fire: only the lifecycle handlers can save the edit.
const pauseClock = async (page) => {
  await page
    .locator('.cms-editor-canvas[data-cms-about-preview-ready="true"]')
    .waitFor({ state: 'attached', timeout: 90000 })
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 2_000)
}

const nameField = (page) => page.getByRole('textbox', { name: 'Namn', exact: true })

// These lifecycle cases begin from an explicitly published head so later assertions isolate
// the owner edit or recovered draft from the initial migration.
const publishAdopted = async (page) => {
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/, { timeout: 45000 })
}

// The sanitised production presentation: its draft serializes to about 1.4 million characters.
const productionDocument = async () => ({
  ...emptyDocument(),
  presentation: JSON.parse(
    gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
  ).presentation,
})

// Exit must really unmount Studio. The ordinary editor harness deliberately keeps it mounted.
const mountExitableStudio = async (page) => {
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

test('cms-lifecycle retries a failed backup initialization without hiding its original draft', async ({
  page,
  context,
}) => {
  await nativeBackend(context)
  const setup = await context.newPage()
  await openStudio(setup)
  await publishAdopted(setup)
  await expect.poll(() => storedDrafts(setup)).toEqual([])
  await setup.close()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  const recoveredName = 'Utkast före misslyckad backupstart'
  await page.evaluate(async (name) => {
    const { cmsApi } = await import('/src/admin/cms/api.ts')
    const { openKeyedStore } = await import('/src/admin/cms/indexedDb.ts')
    const loaded = await cmsApi.state()
    const document = globalThis.structuredClone(loaded.document)
    document.presentation.pages[0].name.sv = name
    globalThis.sessionStorage.setItem('knc-cms-tab', 'failed-initialization')
    const records = await openKeyedStore('knc-cms-drafts', 'tab')
    await records.put({
      tab: 'failed-initialization',
      document: JSON.stringify(document),
      base: JSON.stringify(loaded.document),
      revision: loaded.revision,
      fingerprint: loaded.fingerprint,
      savedAt: new Date().toISOString(),
    })
    const getAll = globalThis.IDBObjectStore.prototype.getAll
    globalThis.IDBObjectStore.prototype.getAll = function (...args) {
      const request = getAll.apply(this, args)
      if (this.transaction.db.name === 'knc-cms-drafts') {
        // Abort the real read transaction asynchronously, after its request succeeds but before
        // commit. Restore immediately so the same store and Web Locks can serve the retry.
        globalThis.IDBObjectStore.prototype.getAll = getAll
        request.addEventListener('success', () => {
          this.transaction.abort()
          globalThis.__backupInitializationAborted = true
        })
      }
      return request
    }
  }, recoveredName)
  await mountExitableStudio(page)
  await expect(page.getByRole('alert')).toContainText('Lokal backup kunde inte sparas.')
  assert.equal(await page.evaluate(() => globalThis.__backupInitializationAborted), true)
  assert.deepEqual(
    await storedDrafts(page),
    [recoveredName],
    'the failed read must leave the original record intact',
  )
  await page.getByTitle('Tillbaka till Admin', { exact: true }).click()
  await expect(page.locator('.knc-cms-studio')).toHaveCount(0)
  await mountExitableStudio(page)
  await expect(nameField(page)).toHaveValue(recoveredName)
  const identity = await page.evaluate(async () => ({
    tab: globalThis.sessionStorage.getItem('knc-cms-tab'),
    locks: (await globalThis.navigator.locks.query()).held
      .map((lock) => lock.name)
      .filter((name) => name.startsWith('knc-cms-tab:')),
  }))
  assert.equal(identity.tab, 'failed-initialization')
  assert.deepEqual(identity.locks, ['knc-cms-tab:failed-initialization'])
  assert.deepEqual(await storedDrafts(page), [recoveredName])
})

test('cms-lifecycle an immediate Studio exit preserves a trusted pending canvas edit', async ({
  page,
  context,
}) => {
  await nativeBackend(context, await productionDocument())
  await page.clock.install()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await mountExitableStudio(page)
  await publishAdopted(page)
  await expect.poll(() => storedDrafts(page)).toEqual([])
  await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const element = [...editor.Canvas.getDocument().querySelectorAll('[data-knc-source]')].find(
      (node) =>
        node.children.length === 0 &&
        node.textContent.trim().length > 3 &&
        node.id &&
        !node.closest('svg, a, button, [data-knc-slot]'),
    )
    if (!element) throw new Error('Editable source text missing')
    const component = editor.getWrapper().find(`#${globalThis.CSS.escape(element.id)}`)[0]
    if (!component) throw new Error('Source component missing')
    editor.select(component)
    globalThis.__studioExitEvents = []
    globalThis.document.addEventListener(
      'input',
      (event) => {
        if (event.target.matches('.cms-inspector textarea'))
          globalThis.__studioExitEvents.push({
            type: 'input',
            trusted: event.isTrusted,
          })
      },
      { capture: true },
    )
    globalThis.document.querySelector('.cms-brand').addEventListener(
      'click',
      (event) => {
        globalThis.__studioExitEvents.push({
          type: 'exit',
          trusted: event.isTrusted,
          text: component.getEl()?.textContent,
        })
      },
      { capture: true },
    )
  })
  const text = 'Den sista canvasändringen före Studio-exit'
  // Hold the editor's 180 ms debounce, not the input or exit handler. Native trusted actions and
  // real IndexedDB still run; the regression does not depend on CI completing clicks in 180 ms.
  await pauseClock(page)
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill(text)
  await page.getByTitle('Tillbaka till Admin', { exact: true }).click({ force: true })
  const events = await page.evaluate(() => globalThis.__studioExitEvents)
  assert.equal(events.length, 2, 'record the input and actual exit click')
  assert.deepEqual(
    events.map(({ type, trusted }) => ({ type, trusted })),
    [
      { type: 'input', trusted: true },
      { type: 'exit', trusted: true },
    ],
  )
  assert.equal(events[1].text, text, 'the trusted input reached the actual canvas before exit')
  await expect(page.locator('.knc-cms-studio')).toHaveCount(0)
  await expect.poll(() => draftHolds(page, text)).toBe(true)
  await page.clock.resume()
  await mountExitableStudio(page)
  await page.frameLocator('.gjs-frame').first().getByText(text, { exact: true }).first().waitFor()
})

test('cms-lifecycle normalization is publishable but only owner edits prompt and become offers', async ({
  page,
  context,
}) => {
  const document = await productionDocument()
  const legacy = createSitePage({
    id: '10000000-0000-4000-8000-000000000099',
    path: '/pristine',
    name: { sv: 'Äldre sida', en: 'Legacy page' },
  })
  legacy.layout = 'independent'
  document.presentation.pages.push(legacy)
  await nativeBackend(context, document)
  await page.clock.install()
  await openStudio(page)
  await expect(page.locator('.cms-status')).toHaveText('Opublicerade ändringar')
  await expect(page.getByRole('button', { name: 'Publicera', exact: true })).toBeEnabled()
  await expect(page.locator('.cms-revert')).toBeDisabled()
  // Let the backup debounce elapse, then freeze it for the immediate owner edit below.
  await pauseClock(page)
  const asksToLeave = (tab) =>
    tab.evaluate(() => {
      const leaving = new Event('beforeunload', { cancelable: true })
      globalThis.dispatchEvent(leaving)
      return leaving.defaultPrevented
    })
  assert.equal(await asksToLeave(page), false)
  assert.deepEqual(await storedDrafts(page), [])
  await page.close()
  await context.clock.resume()

  const edited = await context.newPage()
  await openStudio(edited)
  await expect(edited.getByRole('button', { name: 'Visa utkast', exact: true })).toHaveCount(0)
  await expect(edited.getByText(/Ett lokalt utkast från .* återställdes\./)).toHaveCount(0)
  await pauseClock(edited)
  const name = 'Äkta ägarändring'
  await nameField(edited).fill(name)
  await expect(edited.locator('.cms-revert')).toBeEnabled()
  assert.equal(await asksToLeave(edited), true)
  // Asking to leave saves nothing; the edit reaches IndexedDB through the backup's 500 ms debounce.
  await edited.clock.runFor(600)
  await expect.poll(() => storedDrafts(edited)).toEqual([name])
  await edited.close()
  await context.clock.resume()

  // This head still needs normalization; its own migration must not block recovery.
  const recovery = await context.newPage()
  await openStudio(recovery)
  await recovery.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  const offers = recovery.getByRole('region', { name: 'Utkast från stängda flikar', exact: true })
  const blocked = recovery.getByText(
    'Publicera eller återställ ändringarna i den här fliken innan du fortsätter med ett annat utkast. Vill du behålla en kopia, välj Export och sedan Återställ.',
    { exact: true },
  )
  const resume = offers.getByRole('button', { name: 'Fortsätt här', exact: true })
  await expect(offers.getByRole('listitem')).toHaveCount(1)
  await expect(blocked).toHaveCount(0)
  await expect(resume).toBeEnabled()
  await expect(recovery.locator('.cms-mobile-revert')).toBeDisabled()
  const closeBackup = () =>
    recovery
      .getByRole('dialog', { name: 'Utkast & backup', exact: true })
      .getByRole('button', { name: 'Stäng panel', exact: true })
      .click()
  await closeBackup()
  await nameField(recovery).fill('Ändring i den här fliken')
  await recovery.getByRole('button', { name: /Utkast & backup/ }).click()
  await expect(blocked).toBeVisible()
  await expect(resume).toBeDisabled()
  await expect(recovery.locator('.cms-mobile-revert')).toBeEnabled()
  await closeBackup()
  await recovery.locator('.cms-revert').click()
  await expect(recovery.locator('.cms-status')).toHaveText('Opublicerade ändringar')
  await expect(recovery.locator('.cms-revert')).toBeDisabled()
  await recovery.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  await expect(resume).toBeEnabled()
  await resume.click()
  await expect(nameField(recovery)).toHaveValue(name)
})

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
  // Recovery replaces the receiving document. Keep it non-interactive while the server state
  // is in flight, so an edit accepted during that wait cannot disappear when recovery completes.
  const recoveryErrors = []
  third.on('pageerror', (error) => recoveryErrors.push(error.message))
  const started = gate()
  const done = gate()
  const holdState = async (route) => {
    if (route.request().postDataJSON()?.operation === 'state') {
      started.release()
      await done.promise
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Återställningens serverläsning avbröts.' }),
      })
      return
    }
    await route.fallback()
  }
  const studioRoute = '**/functions/v1/cms-studio'
  await context.route(studioRoute, holdState)
  try {
    await offers.getByRole('button', { name: 'Fortsätt här', exact: true }).click()
    await started.promise
    await expect(third.getByRole('heading', { name: 'Återställer utkast…' })).toBeVisible()
    await expect(nameField(third)).toHaveCount(0)
    await expect(third.getByRole('button', { name: 'Tillbaka till Admin' })).toBeDisabled()
  } finally {
    done.release()
    await context.unroute(studioRoute, holdState)
  }
  // Adoption already moved the offered record. A failed refresh must keep that record safe
  // behind the retry screen, instead of reopening the old editor which could overwrite it.
  await expect(third.getByRole('alert')).toContainText('Återställningens serverläsning avbröts.')
  await expect(nameField(third)).toHaveCount(0)
  assert.deepEqual(await storedDrafts(third), ['Utkast från flik ett'])
  await third.getByRole('button', { name: 'Försök igen', exact: true }).click()
  await expect(nameField(third)).toHaveValue('Utkast från flik ett')
  await expect(nameField(third)).toBeEditable()
  await expect(offers).toHaveCount(0)
  await expect.poll(() => storedDrafts(third)).toEqual(['Utkast från flik ett'])
  assert.deepEqual(recoveryErrors, [], 'restoring and retrying must not use a destroyed editor')
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

// A reload ends the page before an IndexedDB write started in pagehide commits; the
// synchronous sessionStorage journal carries the last edit across it.
test('cms-lifecycle an edit survives an immediate reload at production size', async ({
  page,
  context,
}) => {
  await nativeBackend(context, await productionDocument())
  await openStudio(page)
  await nameField(page).fill('Omladdad direkt')
  await page.reload()
  await openStudio(page)
  await expect(nameField(page)).toHaveValue('Omladdad direkt')
  await expect.poll(() => storedDrafts(page)).toEqual(['Omladdad direkt'])
})

test('cms-lifecycle a canvas edit survives an immediate reload at production size', async ({
  page,
  context,
}) => {
  await nativeBackend(context, await productionDocument())
  await page.clock.install()
  await openStudio(page)
  await pauseClock(page)
  const text = 'Ändrad i canvas precis före omladdning'
  await editCanvas(page, text)
  await page.reload()
  // The reloaded page starts with the clock paused too.
  await page.clock.resume()
  await openStudio(page)
  await page.frameLocator('.gjs-frame').first().getByText(text, { exact: true }).first().waitFor()
  await expect.poll(() => draftHolds(page, text)).toBe(true)
})

// A phone hides the page before its tab is closed, and a hidden page lives on until IndexedDB
// commits. (A desktop tab closed without being hidden first can lose the edits since the last
// 500 ms pause in editing.)
test('cms-lifecycle a canvas edit reaches IndexedDB when the tab is hidden, then closed', async ({
  page,
  context,
}) => {
  await nativeBackend(context, await productionDocument())
  await page.clock.install()
  await openStudio(page)
  await pauseClock(page)
  const text = 'Ändrad i canvas innan fliken doldes'
  await editCanvas(page, text)
  await page.evaluate(() => {
    Object.defineProperty(globalThis.document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    globalThis.document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => draftHolds(page, text)).toBe(true)
  await page.close()
  await context.clock.resume()

  const next = await context.newPage()
  await openStudio(next)
  await next.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  const offers = next.getByRole('region', { name: 'Utkast från stängda flikar', exact: true })
  await offers.getByRole('button', { name: 'Fortsätt här', exact: true }).click()
  await next.frameLocator('.gjs-frame').first().getByText(text, { exact: true }).first().waitFor()
})

test('cms-lifecycle a reload right after Publicera does not bring back the old backup', async ({
  page,
  context,
}) => {
  const backend = await nativeBackend(context, await productionDocument())
  await openStudio(page)
  await nameField(page).fill('Publicerat namn')
  // A backup from before the publication exists.
  await expect.poll(() => storedDrafts(page)).toEqual(['Publicerat namn'])
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/, { timeout: 45000 })
  // The server changes after the publication; a resurrected backup would overwrite this.
  backend.document.presentation.pages[0].name.sv = 'Serverns namn'
  await page.reload()
  await openStudio(page)
  await expect(nameField(page)).toHaveValue('Serverns namn')
  await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/)
  assert.deepEqual(await storedDrafts(page), [])
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

// The published layouts never showed the image, but the draft's do: an assignment whose capture
// worked, then a removal whose capture failed, leaves the data published and the layouts stale.
test('cms-lifecycle Publicera captures again after a removal whose capture failed', async ({
  page,
  context,
}) => {
  // Three captures wait for their 20 s deadline before the last one works.
  test.setTimeout(300_000)
  const backend = await nativeBackend(context, emptyDocument(), [salonImage])
  await openStudio(page)
  await page
    .locator('.cms-library-tabs')
    .getByRole('button', { name: 'Resurser', exact: true })
    .click()
  await page.locator('.cms-resource-card button').filter({ hasText: salonImage.name }).click()
  await page.getByRole('button', { name: 'Använd i utkastet', exact: true }).click()
  await page
    .getByText('Tilldelad i utkastet. Publicera för att visa ändringen.', { exact: true })
    .waitFor({ timeout: 45000 })
  // The first capture worked: the draft's layouts show the image.
  const failed = page.getByText(
    'Filen är tilldelad. Förhandsvisningen uppdateras när du publicerar.',
    { exact: true },
  )
  await expect(failed).toHaveCount(0)

  const source = '**/cms-public/source?preview=1'
  await context.route(source, (route) => route.abort())
  await page.getByRole('button', { name: 'Dölj från sidan', exact: true }).click()
  await page
    .getByText('Filen är borttagen från sidan. Förhandsvisningen uppdateras när du publicerar.', {
      exact: true,
    })
    .waitFor({ timeout: 45000 })

  const publish = page.getByRole('button', { name: 'Publicera', exact: true })
  const blocked = page.getByText(/^Inget publicerades: startsidan och Om oss kunde inte uppdateras/)
  await publish.click()
  await blocked.waitFor({ timeout: 45000 })
  assert.equal(backend.writes.filter((write) => write === 'publish').length, 0)

  // An exported copy of this draft, imported after Återställ, still shows the image in its
  // layouts while its data equals the published data: Publicera must capture first.
  const backupView = page.getByRole('button', { name: /Utkast & backup/ })
  // Export and Import share the dialog, so it stays open after either; the owner closes it.
  const closeBackupView = () =>
    page
      .getByRole('dialog', { name: 'Utkast & backup', exact: true })
      .getByRole('button', { name: 'Stäng panel', exact: true })
      .click()
  await backupView.click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ])
  const exported = await download.path()
  await closeBackupView()
  await page.getByRole('button', { name: 'Återställ', exact: true }).click()
  await backupView.click()
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(exported)
  await page
    .getByText('JSON-utkastet importerades och är ännu inte publicerat.', { exact: true })
    .waitFor()
  await closeBackupView()
  await publish.click()
  // Publicera clears the previous error first; only a failed capture shows it again.
  await expect(blocked).toHaveCount(0)
  await blocked.waitFor({ timeout: 45000 })
  assert.equal(backend.writes.filter((write) => write === 'publish').length, 0)

  await context.unroute(source)
  await publish.click()
  await expect(page.locator('.cms-status')).toHaveText(/^Publicerad/, { timeout: 45000 })
  assert.equal(backend.writes.filter((write) => write === 'publish').length, 1)
  assert.deepEqual(backend.document.gallery, [])
})

// The close decision must return before WebKit's deadline, even when a production-size canvas
// export is still pending. Cancel keeps the live edit; normal backup then makes a later close safe.
// Choosing Leave before that write is durable explicitly risks discarding the unsaved edit.
test('cms-lifecycle actual close warns, Cancel keeps the edit, and a saved draft closes quietly', async ({
  page,
  context,
}) => {
  await nativeBackend(context, await productionDocument())
  await page.clock.install()
  await openStudio(page)
  await publishAdopted(page)
  // Open the read-only probe before editing: opening it afterwards could hide the editor and
  // exercise the background handler instead of the immediate-close boundary.
  const probe = await context.newPage()
  await probe.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await page.bringToFront()
  // A real click: browsers show the leave prompt only after a user gesture on the page.
  await nameField(page).click()
  await pauseClock(page)
  const text = 'Ändrad i canvas precis före stängning'
  await editCanvas(page, text)
  const [dialog] = await Promise.all([
    page.waitForEvent('dialog'),
    page.close({ runBeforeUnload: true }),
  ])
  assert.equal(dialog.type(), 'beforeunload')
  await dialog.dismiss()
  assert.equal(page.isClosed(), false)
  await context.clock.resume()
  await expect.poll(() => draftHolds(probe, text)).toBe(true)

  // A durable local draft can close without another warning, even though it is unpublished.
  let warnedAgain = false
  page.on('dialog', async (unexpected) => {
    warnedAgain = true
    await unexpected.accept()
  })
  const closed = page.waitForEvent('close')
  await page.close({ runBeforeUnload: true })
  await closed
  assert.equal(warnedAgain, false)
  await probe.close()

  const next = await context.newPage()
  await openStudio(next)
  // The closed tab's draft is offered only once the browser released that tab's lock.
  await attachTabState(next, 'tab state of the next tab')
  await next.getByRole('button', { name: 'Visa utkast', exact: true }).click()
  const offers = next.getByRole('region', { name: 'Utkast från stängda flikar', exact: true })
  await offers.getByRole('button', { name: 'Fortsätt här', exact: true }).click()
  await next.frameLocator('.gjs-frame').first().getByText(text, { exact: true }).first().waitFor()
})

const gate = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

test('cms-lifecycle a pending source upgrade cannot overwrite a recovered draft', async ({
  context,
}) => {
  const backend = await nativeBackend(context)
  const first = await context.newPage()
  await openStudio(first)
  await publishAdopted(first)
  const recoveredName = 'Utkastet överlever en äldre källuppdatering'
  await nameField(first).fill(recoveredName)
  await expect.poll(() => storedDrafts(first)).toEqual([recoveredName])
  await first.close()

  // The receiving tab opens a valid older layout which needs an optional source upgrade.
  for (const page of backend.document.presentation.pages)
    if (page.path === '/booking')
      for (const lang of ['sv', 'en'])
        page.content[lang].html = page.content[lang].html.replaceAll(
          ' data-knc-fold="booking-flow"',
          '',
        )
  const started = gate()
  const source = gate()
  const recipient = await context.newPage()
  const sourceRoute = '**/cms-public/source'
  const holdSource = async (route) => {
    started.release()
    await source.promise
    await route.fallback()
  }
  await recipient.route(sourceRoute, holdSource)
  await recipient.goto(`${harnessOrigin}/tools/e2e/admin-harness.html?view=cms-studio`)
  await recipient.evaluate(async () => {
    const session = await (await import('/src/admin/cms/backup.ts')).cmsBackups()
    const adopt = session.adopt.bind(session)
    const ready = new Promise((resolve) => {
      globalThis.__releaseCmsAdoption = resolve
    })
    // Gate only completion: the actual lock, version check and IndexedDB record move all run.
    session.adopt = async (offer) => {
      const outcome = await adopt(offer)
      globalThis.__cmsAdopted = true
      await ready
      return outcome
    }
    ;(await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness()
  })
  try {
    await started.promise
    await expect(recipient.locator('.cms-status')).toHaveText(/^Publicerad/)
    await recipient.getByRole('button', { name: 'Visa utkast', exact: true }).click()
    await recipient.getByRole('button', { name: 'Fortsätt här', exact: true }).click()
    await recipient.waitForFunction(() => globalThis.__cmsAdopted)
    await expect(recipient.getByRole('heading', { name: 'Återställer utkast…' })).toBeVisible()
    source.release()
    await recipient
      .locator('iframe[title="Läser den befintliga webbplatsen"]')
      .waitFor({ state: 'detached', timeout: 90000 })
    // Complete any write the old source effect scheduled, without relying on a fixed delay.
    await recipient.evaluate(async () =>
      (await (await import('/src/admin/cms/backup.ts')).cmsBackups()).flush(),
    )
    assert.deepEqual(await storedDrafts(recipient), [recoveredName])
  } finally {
    source.release()
    await recipient.unroute(sourceRoute, holdSource)
    if (!recipient.isClosed()) await recipient.evaluate(() => globalThis.__releaseCmsAdoption?.())
  }
  await expect(nameField(recipient)).toHaveValue(recoveredName)
  await expect(recipient.getByText('Förbereder fler redigeringsvyer…')).toHaveCount(0)
  await expect.poll(() => storedDrafts(recipient)).toEqual([recoveredName])
})

// Publicera captured the layouts for a new display name; during the request the name goes back to
// the published one and the server moves on. The 409 merge keeps the captured layouts while its
// data equals the server's, so the next Publicera must capture again.
test('cms-lifecycle a 409 merge keeps layouts stale that an edit during publication left', async ({
  page,
  context,
}, testInfo) => {
  const delay = { operation: 'publish', started: gate(), done: gate() }
  const initial = await productionDocument()
  initial.settings.business_name = 'Salongen'
  // A site has every settings key: the server changes a value during the request, never adds a key
  // (publication requires every key the server holds).
  initial.settings.business_legal_name = 'Salongen AB'
  assert.equal(
    initial.presentation.pages.some((item) => item.path === '/contact'),
    false,
  )
  const backend = await nativeBackend(context, initial, [], undefined, { delay })
  await openStudio(page)
  // The stored Home is usable before optional capture adds Contact to the actual draft.
  await page.getByRole('button', { name: 'Kontakt', exact: true }).waitFor({
    timeout: testInfo.timeout,
  })
  await page.getByRole('button', { name: /Företag & SEO/ }).click()
  const name = page.getByLabel('Visningsnamn', { exact: true })
  await name.fill('Tillfälligt namn')
  const publish = page.getByRole('button', { name: 'Publicera', exact: true })
  const publication = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname.endsWith('/functions/v1/cms-studio') &&
      request.method() === 'POST' &&
      request.postDataJSON()?.operation === 'publish',
  )
  await publish.click()
  await delay.started.promise
  const submitted = (await publication).postDataJSON().document
  assert.equal(submitted.presentation.pages.filter((item) => item.path === '/contact').length, 1)
  await name.fill('Salongen')
  backend.document.settings.business_legal_name = 'Serverns AB'
  const source = '**/cms-public/source?preview=1'
  await context.route(source, (route) => route.abort())
  delay.done.release()
  await page
    .getByText(
      'Servern hade nya ändringar. De slogs ihop med ditt utkast; granska och publicera igen.',
      { exact: true },
    )
    .waitFor({ timeout: 45000 })
  await expect(page.getByLabel('Juridiskt namn', { exact: true })).toHaveValue('Serverns AB')
  await expect(page.getByRole('button', { name: 'Kontakt', exact: true })).toHaveCount(1)
  await publish.click()
  await page
    .getByText(/^Inget publicerades: startsidan och Om oss kunde inte uppdateras/)
    .waitFor({ timeout: 45000 })
  assert.equal(backend.writes.filter((write) => write === 'publish').length, 0)
})
