import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { extendedCmsScenarios } from './cms-extended.mjs'
import { prepareLocalCmsAssets } from './cms-local-assets.mjs'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { chromium, firefox, webkit, expect } from 'playwright/test'

const engine = process.env.CMS_BROWSER ?? 'chromium'
if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Unsupported CMS_BROWSER')
const base = 'http://127.0.0.1:4188'
const stack = JSON.parse(
  execFileSync('npx', ['supabase', 'status', '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
)
for (const value of [stack.API_URL, stack.DB_URL])
  if (!value || !['127.0.0.1', 'localhost'].includes(new URL(value).hostname))
    throw new Error(
      'CMS browser tests only run against the local Supabase stack, never production.',
    )
execFileSync(process.execPath, ['--test', 'tools/e2e/cms-local-assets.test.mjs'], {
  stdio: 'inherit',
})
const localAssets = prepareLocalCmsAssets(stack.API_URL)
const output = resolve(`artifacts/cms-browser/${engine}`)
mkdirSync(output, { recursive: true })
const config = resolve('artifacts/cms-browser/wrangler.test.json')
writeFileSync(
  config,
  JSON.stringify({
    name: 'knc-cms-local-test',
    main: resolve('src/worker.ts'),
    compatibility_date: '2026-08-09',
    assets: {
      directory: localAssets,
      binding: 'ASSETS',
      not_found_handling: 'none',
      html_handling: 'none',
      run_worker_first: true,
    },
    vars: {
      SUPABASE_URL: stack.API_URL,
      SUPABASE_ANON_KEY: stack.ANON_KEY,
      CUSTOMER_GATEWAY_SECRET: 'ci-customer-gateway-secret-not-for-production',
    },
  }),
)
const log = openSync(resolve(output, 'worker.log'), 'w')
const worker = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '4188',
    '--config',
    config,
  ],
  {
    stdio: ['ignore', log, log],
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  },
)
const service = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const db = new Client({ connectionString: stack.DB_URL })
await db.connect()
let browser, original, ownerToken
const identities = [],
  results = []
const failures = []
const report = () =>
  writeFileSync(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        browser: engine,
        mode: 'real local Auth + Edge + PostgreSQL + Storage + Worker + production build',
        results,
      },
      null,
      2,
    ),
  )
async function ready() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Local Worker exited ${worker.exitCode}`)
    try {
      if ((await fetch(`${base}/admin/cms`)).status === 200) return
    } catch {
      /* The local Worker may still be starting. */
    }
    await delay(200)
  }
  throw new Error('Local Worker was not ready; inspect worker.log')
}
async function identity(role) {
  const password = `CMS-local-${randomUUID()}`
  const email = `cms-${role}-${randomUUID()}@example.test`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw new Error(`Cannot seed ${role} identity`)
  const id = created.data.user.id
  identities.push(id)
  await db.query(
    'insert into public.profiles(id,role,barber_id,account_enabled,must_change_password) values($1,$2,$3,true,false) on conflict(id) do update set role=excluded.role,barber_id=excluded.barber_id,account_enabled=true,must_change_password=false',
    [id, role, role === 'barber' ? 'hassan' : null],
  )
  const client = createClient(stack.API_URL, stack.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error || !signed.data.session) throw new Error(`Cannot authenticate ${role} fixture`)
  return { id, session: signed.data.session }
}
async function publicProjection() {
  const response = await fetch(`${stack.API_URL}/rest/v1/rpc/public_cms_presentation`, {
    method: 'POST',
    headers: {
      apikey: stack.ANON_KEY,
      authorization: `Bearer ${stack.ANON_KEY}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  const value = await response.json()
  assert.equal(response.status, 200, `Public CMS projection: ${JSON.stringify(value)}`)
  return value
}
async function api(body) {
  const response = await fetch(`${stack.API_URL}/functions/v1/cms-studio`, {
    method: 'POST',
    headers: {
      origin: base,
      apikey: stack.ANON_KEY,
      authorization: `Bearer ${ownerToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const value = await response.json()
  assert.equal(response.status, 200, `CMS ${body.operation}: ${JSON.stringify(value)}`)
  return value
}
async function context(session, viewport = { width: 1600, height: 1000 }) {
  const value = await browser.newContext({
    viewport,
    reducedMotion: 'reduce',
    storageState: session
      ? {
          cookies: [],
          origins: [
            {
              origin: base,
              localStorage: [{ name: 'knc-admin-auth', value: JSON.stringify(session) }],
            },
          ],
        }
      : undefined,
  })
  if (session)
    await value.addInitScript(
      ({ origin, session }) => {
        if (
          globalThis.location.origin === origin &&
          !globalThis.navigator.locks &&
          !globalThis.sessionStorage.getItem('cms-test-auth-seeded')
        ) {
          globalThis.sessionStorage.setItem('knc-admin-auth', session)
          globalThis.sessionStorage.setItem('cms-test-auth-seeded', 'true')
        }
      },
      { origin: base, session: JSON.stringify(session) },
    )
  return value
}
async function test(name, session, action, viewport) {
  const current = await context(session, viewport),
    page = await current.newPage()
  const errors = [],
    network = [],
    consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await current.tracing.start({ screenshots: true, snapshots: true })
  const started = Date.now()
  try {
    await action(page, current)
    assert.deepEqual(errors, [], 'Unexpected browser exceptions')
    results.push({ name, status: 'PASS', milliseconds: Date.now() - started })
    console.log(`PASS ${engine}: ${name}`)
    await page.screenshot({ path: resolve(output, `${name}.png`) })
  } catch (error) {
    results.push({
      name,
      status: 'FAIL',
      error: error.message,
      pageErrors: errors,
      consoleErrors,
      network,
      milliseconds: Date.now() - started,
    })
    failures.push(name)
    console.error(`FAIL ${engine}: ${name}: ${error.message}`)
    console.error(
      'BROWSER_STATE',
      JSON.stringify({
        url: page.url(),
        body: (
          await page
            .locator('body')
            .innerText()
            .catch(() => 'No body')
        ).slice(0, 4000),
        pageErrors: errors,
        consoleErrors,
        network: network.slice(-20),
      }),
    )
    await page.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => undefined)
    writeFileSync(
      resolve(output, `${name}-failure.txt`),
      (await page
        .locator('body')
        .innerText()
        .catch(() => 'No body')) +
        '\n' +
        errors.join('\n'),
    )
  } finally {
    await current.tracing.stop({ path: resolve(output, `${name}.zip`) })
    await current.close()
    report()
  }
}
const studio = async (page) => {
  await page.goto(`${base}/admin/cms/`)
  await expect(page.locator('.cms-bottom')).toBeVisible({ timeout: 20000 })
}
const canvas = (page) => page.frameLocator('.cms-native-canvas iframe').first()
try {
  await ready()
  const owner = await identity('owner'),
    barber = await identity('barber')
  ownerToken = owner.session.access_token
  original = await api({ operation: 'state' })
  browser = await { chromium, firefox, webkit }[engine].launch({ headless: true })
  await test('owner-studio-native-preview', owner.session, async (page) => {
    await studio(page)
    await expect(canvas(page).locator('[data-cms-node]').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publicera', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Resurser', exact: true }).click()
    for (const name of [
      'Bilder och typsnitt',
      'Varumärke och kontakt',
      'Alla webbplatstexter',
      'Färger och typsnitt',
      'Misslyckade mejlleveranser',
    ])
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  })
  await test('legacy-admin-tabs-retained', owner.session, async (page) => {
    await page.goto(`${base}/admin`)
    const nav = page.locator('#admin-nav-tabs')
    await expect(nav.getByRole('button', { name: 'Redigering', exact: true })).toBeVisible()
    assert.equal(
      await nav.getByRole('button').count(),
      11,
      'Ten old tabs and the one additive Editing entry must remain',
    )
    await nav.getByRole('button', { name: 'Redigering', exact: true }).click()
    await expect(page.locator('.cms-bottom')).toBeVisible()
    await page.getByRole('button', { name: '← Admin', exact: true }).click()
    await expect(page.locator('#admin-nav-tabs')).toBeVisible()
    assert.equal(await page.locator('#admin-nav-tabs button').count(), 11)
  })
  await test('anonymous-cannot-open-studio', null, async (page) => {
    await page.goto(`${base}/admin/cms/`)
    await expect(page).toHaveURL(/\/login(?:[/?]|$)/)
    await expect(page.locator('.cms-bottom')).toHaveCount(0)
  })
  await test('barber-cannot-open-owner-studio', barber.session, async (page) => {
    await page.goto(`${base}/admin/cms/`)
    await expect(page.getByRole('alert')).toContainText('Endast ägaren')
    await expect(page.locator('.cms-bottom')).toHaveCount(0)
  })
  await test('native-language-theme-and-device', owner.session, async (page) => {
    await studio(page)
    await expect(canvas(page).locator('[data-cms-node]').first()).toBeVisible()
    await page
      .locator('[aria-label="Redigeringsspråk"]')
      .getByRole('button', { name: 'EN', exact: true })
      .click()
    await expect.poll(() => canvas(page).locator('html').getAttribute('lang')).toBe('en')
    await page.getByRole('button', { name: 'Mörkt', exact: true }).click()
    await expect
      .poll(() => canvas(page).locator('html').getAttribute('data-cms-theme'))
      .toBe('dark')
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    await expect
      .poll(() =>
        canvas(page)
          .locator('body')
          .evaluate(() => globalThis.innerWidth),
      )
      .toBe(390)
    await page
      .locator('[aria-label="Redigeringsspråk"]')
      .getByRole('button', { name: 'SV', exact: true })
      .click()
    await expect.poll(() => canvas(page).locator('html').getAttribute('lang')).toBe('sv')
    await expect(page.getByRole('button', { name: 'Publicera', exact: true })).toBeDisabled()
  })
  await test(
    'mobile-studio-shell-drawers',
    owner.session,
    async (page) => {
      await studio(page)
      assert.deepEqual(await page.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]), [
        390,
        844,
      ])
      const tools = page.getByRole('navigation', { name: 'Mobilverktyg' })
      const pages = tools.getByRole('button', { name: 'Sidor', exact: true })
      const properties = tools.getByRole('button', { name: 'Egenskaper', exact: true })
      await expect(tools).toBeVisible()
      await expect(page.locator('#cms-library')).toBeHidden()
      await expect(page.locator('#cms-inspector')).toBeHidden()

      await pages.click()
      await expect(page.locator('#cms-library')).toBeVisible()
      await expect(pages).toHaveAttribute('aria-expanded', 'true')
      await expect(properties).toHaveAttribute('aria-expanded', 'false')

      await properties.click()
      await expect(page.locator('#cms-library')).toBeHidden()
      await expect(page.locator('#cms-inspector')).toBeVisible()
      await expect(pages).toHaveAttribute('aria-expanded', 'false')
      await expect(properties).toHaveAttribute('aria-expanded', 'true')

      const inspectorTabs = page.getByRole('tablist', { name: 'Egenskapspanel' })
      for (const name of ['Design', 'Lager', 'Lägg till']) {
        const tab = inspectorTabs.getByRole('tab', { name, exact: true })
        await tab.click()
        await expect(tab).toHaveAttribute('aria-selected', 'true')
      }

      const commands = page.getByRole('toolbar', { name: 'Redigeringskommandon' })
      await expect(commands).toBeVisible()
      for (const name of [
        'Ångra',
        'Gör om',
        'Redigera',
        'Publicera',
        'Återställ',
        'Historik',
        'Återställ version',
        'Lås vy',
      ]) {
        const button = commands.getByRole('button', { name, exact: true })
        await button.scrollIntoViewIfNeeded()
        await expect(button).toBeInViewport()
      }
      const commandGeometry = await commands.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, viewport: globalThis.innerHeight }
      })
      assert(
        commandGeometry.top >= 0 && commandGeometry.bottom <= commandGeometry.viewport,
        `Mobile command bar escaped the viewport: ${JSON.stringify(commandGeometry)}`,
      )

      await page.keyboard.press('Escape')
      await expect(page.locator('#cms-inspector')).toBeHidden()
      await expect(properties).toHaveAttribute('aria-expanded', 'false')
    },
    { width: 390, height: 844 },
  )
  await test('inline-text-undo-save-reload-public', owner.session, async (page) => {
    await studio(page)
    const heading = canvas(page).locator('[data-cms-copy="site:kicker"]').first()
    await expect(heading).toBeVisible()
    const old = await heading.innerText(),
      value = `CMS ${engine} Åäö\nNy rad`
    await heading.dblclick()
    const input = page.locator('.cms-inline-editor')
    await expect(input).toBeVisible()
    await input.fill(value)
    await input.press('Escape')
    await expect(heading).toHaveText(value)
    await page.getByRole('button', { name: 'Ångra', exact: true }).click()
    await expect(heading).toHaveText(old)
    await page.getByRole('button', { name: 'Gör om', exact: true }).click()
    await expect(heading).toHaveText(value)
    await page.getByRole('button', { name: 'Publicera', exact: true }).click()
    await expect(page.locator('.cms-draft-status')).toHaveText('Alla ändringar publicerade', {
      timeout: 20000,
    })
    const saved = await api({ operation: 'state' })
    assert.equal(saved.document.site.kicker.sv, value)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(canvas(page).locator('[data-cms-copy="site:kicker"]').first()).toHaveText(value)
    await page.goto(base)
    await expect(page.locator('[data-cms-copy="site:kicker"]').first()).toHaveText(value)
  })
  await extendedCmsScenarios({
    test,
    owner,
    api,
    studio,
    canvas,
    service,
    db,
    engine,
    publicProjection,
  })
} finally {
  if (ownerToken && original) {
    try {
      const latest = await api({ operation: 'state' })
      await api({
        operation: 'publish',
        document: original.document,
        baseRevision: latest.revision,
        baseFingerprint: latest.fingerprint,
        requestId: randomUUID(),
      })
    } catch (error) {
      console.error(`CMS fixture restoration failed: ${error.message}`)
      failures.push('fixture-restoration')
    }
  }
  if (browser) await browser.close()
  for (const id of identities) await service.auth.admin.deleteUser(id)
  await db.end()
  worker.kill('SIGTERM')
  closeSync(log)
  report()
}
console.log(
  `SUMMARY ${engine} pass=${results.filter((result) => result.status === 'PASS').length} fail=${failures.length}`,
)
if (failures.length) process.exitCode = 1
