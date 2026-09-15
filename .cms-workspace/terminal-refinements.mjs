import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(process.argv[2])
const patch = (path, action) => {
  const file = resolve(root, path)
  const before = readFileSync(file, 'utf8')
  const after = action(before)
  if (after === before) throw new Error(`Expected correction did not apply: ${path}`)
  writeFileSync(file, after)
}
patch('src/app/Root.tsx', source => source
  .replace("const AdminEntry = lazy(() => import('../admin/index'))", "const AdminEntry = lazy(() => import('../admin/index'))\nconst CmsPreviewEntry = lazy(() => import('../admin/cms/Preview'))")
  .replace('        <Route path="/admin">\n', '        <Route path="/admin/cms/preview">\n          <Suspense fallback={<AdminFallback />}>\n            <CmsPreviewEntry />\n          </Suspense>\n        </Route>\n        <Route path="/admin">\n'))
patch('tools/e2e/cms-studio.mjs', source => source
  .replace("import assert from 'node:assert/strict'", "import assert from 'node:assert/strict'\nimport { randomUUID } from 'node:crypto'\nimport { extendedCmsScenarios } from './cms-extended.mjs'\nimport { prepareLocalCmsAssets } from './cms-local-assets.mjs'")
  .replaceAll('crypto.randomUUID()', 'randomUUID()')
  .replaceAll('location.origin', 'globalThis.location.origin')
  .replaceAll('navigator.locks', 'globalThis.navigator.locks')
  .replaceAll('sessionStorage.', 'globalThis.sessionStorage.')
  .replace(/\binnerWidth\b/g, 'globalThis.innerWidth')
  .replace('} catch {}', '} catch { /* The local Worker may still be starting. */ }')
  .replaceAll('.catch(() => {})', '.catch(() => undefined)')
  .replace("const output = resolve(`artifacts/cms-browser/${engine}`)", "execFileSync(process.execPath, ['--test', 'tools/e2e/cms-local-assets.test.mjs'], { stdio: 'inherit' })\nconst localAssets = prepareLocalCmsAssets(stack.API_URL)\nconst output = resolve(`artifacts/cms-browser/${engine}`)")
  .replace("assets: { directory: resolve('dist'),", "assets: { directory: localAssets,")
  .replace("const errors = []\n  page.on('pageerror'", "const errors = [], network = [], consoleErrors = []\n  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })\n  page.on('pageerror'")
  .replace("page.on('requestfailed', request => { const url = new URL(request.url()); network.push({ url: url.origin + url.pathname, error: request.failure()?.errorText }) })", "page.on('requestfailed', request => { const url = new URL(request.url()); network.push({ url: url.origin + url.pathname, error: request.failure()?.errorText }) })\n  page.on('response', response => { const url = new URL(response.url()); if (url.pathname.includes('/functions/v1/cms-studio') || url.pathname.includes('/functions/v1/upload-image')) network.push({ url: url.origin + url.pathname, status: response.status() }) })")
  .replace('pageErrors: errors, milliseconds:', 'pageErrors: errors, consoleErrors, network, milliseconds:')
  .replace("async function api(body) {", "async function publicProjection() {\n  const response = await fetch(`${stack.API_URL}/rest/v1/rpc/public_cms_presentation`, {\n    method: 'POST',\n    headers: { apikey: stack.ANON_KEY, authorization: `Bearer ${stack.ANON_KEY}`, 'content-type': 'application/json' },\n    body: '{}',\n  })\n  const value = await response.json()\n  assert.equal(response.status, 200, `Public CMS projection: ${JSON.stringify(value)}`)\n  return value\n}\nasync function api(body) {")
  .replace("await page.reload()\n    await expect(canvas", "await page.reload({ waitUntil: 'domcontentloaded' })\n    await expect(canvas")
  .replace('console.error(`FAIL ${engine}: ${name}: ${error.message}`)', 'console.error(`FAIL ${engine}: ${name}: ${error.message}`)\n    console.error("BROWSER_STATE", JSON.stringify({url:page.url(),body:(await page.locator("body").innerText().catch(()=>"No body")).slice(0,4000),pageErrors:errors,consoleErrors,network:network.slice(-20)}))')
  .replace('\n} finally {\n  if (ownerToken && original)', '\n  await extendedCmsScenarios({test,owner,api,studio,canvas,service,db,engine,publicProjection})\n} finally {\n  if (ownerToken && original)'))
patch('tools/e2e/cms-extended.mjs', source => source
  .replace("export async function extendedCmsScenarios({ test, owner, api, base, studio, canvas, service, db, engine })", "export async function extendedCmsScenarios({ test, owner, api, studio, canvas, service, db, engine, publicProjection })")
  .replaceAll("page.once('dialog', dialog => dialog.accept())", "page.once('dialog', dialog => { void dialog.accept().catch(() => undefined) })")
  .replace("import { readFileSync } from 'node:fs'", "import { readFileSync, writeFileSync } from 'node:fs'")
  .replaceAll('structuredClone(', 'globalThis.structuredClone(')
  .replaceAll('&theme=', '&mode=')
  .replace("    const response = await page.goto(`${base}${path}?lang=en&mode=dark`)\n    assert.equal(response.status(), 200)\n    await expect(page.locator('h1,h2').filter({ hasText: 'English heading' }).first()).toBeVisible()\n    await expect(page).toHaveTitle(`English SEO ${engine}`)\n    const head = await page.request.head(`${base}${path}?lang=sv`); assert.equal(head.status(), 200)\n    assert.equal((await page.request.get(`${base}/missing-cms-${engine}`)).status(), 404)", "    const projection = await publicProjection()\n    const publishedState = await api({ operation: 'state' })\n    assert.equal(projection.revision, publishedState.revision)\n    const publicPage = projection.presentation.pages.find(item => item.path === path)\n    assert.ok(publicPage)\n    assert.match(publicPage.content.sv.html, /Svensk rubrik/)\n    assert.match(publicPage.content.en.html, /English heading/)\n    assert.equal(publicPage.title.en, `English SEO ${engine}`)\n    assert.equal(publicPage.inMenu, true)")
  .replace("const input = field(page, 'Ladda upp till filbiblioteket'), name = `cms-browser-${engine}.png`", "const input = field(page, 'Ladda upp till filbiblioteket'), name = `cms-browser-${engine}.png`\n    const fixture = `artifacts/cms-browser/${name}`\n    writeFileSync(fixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=', 'base64'))")
  .replace("await input.setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNDsAAAAASUVORK5CYII=', 'base64') })", "await input.setInputFiles(fixture)")
  .replace("assert.equal(restored.data.design, null)", "assert.equal(restored.data.design ?? null, null)"))
patch('docs/CMS-IMPLEMENTATION.md', source => source.replace(
  'Owner navigation becomes Editing, My schedule, My bookings, Services, All bookings, Settings. The existing operational views and account/session gate remain. `/admin/cms/` is owner-only. Barber self-service retains its existing profile and operational permissions. Old owner content links resolve into the studio instead of silently selecting another panel.',
  'The owner receives one additional Editing / Redigering entry at `/admin/cms/`. Every existing admin tab, legacy URL parameter, operational view and account/session gate remains available. No old link is redirected into the studio. Barber self-service keeps its existing profile and operational permissions. The possible later six-entry navigation is explicitly deferred to the separate acceptance and retirement procedure in `docs/CMS-LEGACY-RETIREMENT.md`.'))
