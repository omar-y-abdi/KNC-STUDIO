/* global window, document, location */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, webkit, devices } from 'playwright'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-startup'
await mkdir(out, { recursive: true })
const results = []

function storedDocument() {
  const doc = emptyDocument()
  doc.presentation.pages = ['/', '/about', '/booking', '/my-bookings', '/privacy', '/terms'].map(
    (path, index) => {
      const html =
        '<div data-knc-native="1"><main data-knc-surface="mobile-home"><h1 id="owner-heading">Stored owner heading</h1></main></div>'
      return {
        id: `10000000-0000-4000-8000-00000000000${index + 1}`,
        path,
        kind: 'page',
        inMenu: true,
        name: { sv: path, en: path },
        title: { sv: '', en: '' },
        description: { sv: '', en: '' },
        content: {
          sv: { html, css: { light: '', dark: '' } },
          en: { html, css: { light: '', dark: '' } },
        },
      }
    },
  )
  return doc
}

async function ownerSession(context) {
  const user = {
    id: '20000000-0000-4000-8000-000000000001',
    email: 'cms-test@example.invalid',
    aud: 'authenticated',
    role: 'authenticated',
  }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const jwt = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, exp, role: 'authenticated' })).toString('base64url'),
    'fixture',
  ].join('.')
  await context.addInitScript(
    (session) => localStorage.setItem('knc-admin-auth', JSON.stringify(session)),
    {
      user,
      access_token: jwt,
      refresh_token: 'fixture',
      expires_at: exp,
      expires_in: 3600,
      token_type: 'bearer',
    },
  )
  await context.route('https://admin-harness.invalid/rest/v1/profiles*', (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': new URL(base).origin,
        'access-control-allow-headers': '*',
      },
      json: { role: 'owner', barber_id: null, must_change_password: false, account_enabled: true },
    }),
  )
}

// The built route inherits the same script policy as production. Only the HTTPS
// upgrade directive is omitted for the loopback HTTP test transport.
const headerFile = await readFile(new URL('../../public/_headers', import.meta.url), 'utf8')
const policy = headerFile.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1]
assert.ok(policy, 'production CSP must be present')
async function csp(context) {
  await context.route(`${base}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    const value = policy
      .replace(/;?\s*upgrade-insecure-requests/g, '')
      .replace("connect-src 'self'", "connect-src 'self' https://admin-harness.invalid")
      .replace(
        'frame-src https://challenges.cloudflare.com',
        "frame-src 'self' https://challenges.cloudflare.com",
      )
      .replace(/frame-ancestors [^;]+/, "frame-ancestors 'self'")
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': value },
    })
  })
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== name) continue
  const browser = await engine.launch()
  const check = async (scenario, test) => {
    const context = await browser.newContext({ ...devices['iPhone 15'], reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const start = Date.now()
    try {
      if (process.env.CMS_STARTUP_BUILT === '1') await csp(context)
      const metrics = await test(page, context)
      assert.deepEqual(errors, [], 'no unhandled errors')
      results.push({
        engine: name,
        scenario,
        passed: true,
        elapsed: Date.now() - start,
        ...metrics,
      })
    } catch (error) {
      results.push({ engine: name, scenario, passed: false, error: error.stack, errors })
    } finally {
      await page.screenshot({ path: `${out}/${name}-${scenario}.png` }).catch(() => {
        /* Preserve the assertion if the browser itself closed. */
      })
      await context.close()
      await writeFile(`${out}/startup-results.json`, JSON.stringify(results, null, 2))
    }
  }
  try {
    await check('stored-page-independent-of-source', async (page, context) => {
      const doc = storedDocument()
      if (process.env.CMS_STARTUP_PRESENTATION)
        doc.presentation = JSON.parse(
          await readFile(process.env.CMS_STARTUP_PRESENTATION, 'utf8'),
        ).presentation
      const backend = await nativeBackend(context, doc)
      await ownerSession(context)
      // A failed optional source has the real protocol but no usable snapshot.
      await context.route('**/cms-public/source', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html data-knc-source-listening="1"><script>addEventListener("message",e=>{document.documentElement.dataset.kncSourceError=e.data.id;document.documentElement.dataset.kncSourceFailure="Offline source"})</script></html>',
        }),
      )
      const start = Date.now()
      await page.goto(`${base}/admin/cms/`)
      await page.locator('.gjs-frame').first().waitFor({ timeout: 2000 })
      await page
        .frameLocator('.gjs-frame')
        .first()
        .locator('[data-knc-surface="mobile-home"]')
        .waitFor({ timeout: 1000 })
      const readyMs = Date.now() - start
      await page
        .getByRole('alert')
        .filter({ hasText: 'Dina befintliga sidor går fortfarande att redigera' })
        .waitFor()
      await page
        .locator('.cms-mobile-tools')
        .getByRole('button', { name: 'Egenskaper', exact: true })
        .click()
      await page.getByLabel('Namn', { exact: true }).fill('Owner edit after source failure')
      await page.getByRole('button', { name: 'Stäng panel', exact: true }).click()
      assert.equal(
        await page.locator('.cms-canvas-breadcrumb strong').innerText(),
        'Owner edit after source failure',
      )
      assert.deepEqual(backend.writes, [])
      return { readyMs }
    })
    await check('page-import-failure-keeps-workspace', async (page, context) => {
      const doc = storedDocument()
      for (const variant of Object.values(doc.presentation.pages[0].content))
        variant.html = variant.html.replace(
          'id="owner-heading"',
          'id="owner-heading" data-knc-baseline="broken-json"',
        )
      await nativeBackend(context, doc)
      await ownerSession(context)
      await context.route('**/cms-public/source', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><body>Source unavailable</body></html>',
        }),
      )
      await page.goto(`${base}/admin/cms/`)
      await page.getByRole('heading', { name: 'Sidan kunde inte öppnas i editorn' }).waitFor()
      assert.equal(await page.locator('.cms-topbar').isVisible(), true)
      await page.getByText('Teknisk felinformation', { exact: true }).click()
      assert.ok(
        (await page.locator('details').innerText()).length > 'Teknisk felinformation'.length,
      )
      await page
        .locator('.cms-mobile-tools')
        .getByRole('button', { name: 'Sidor', exact: true })
        .click()
      await page.locator('.cms-page-list button').filter({ hasText: '/terms' }).click()
      await page.locator('.gjs-frame').first().waitFor()
      assert.equal(
        await page.getByRole('heading', { name: 'Sidan kunde inte öppnas i editorn' }).count(),
        0,
      )
    })
    await check('capture-without-animation-frames', async (page, context) => {
      const backend = await nativeBackend(context)
      const reads = [],
        challenges = []
      context.on('request', (request) => {
        if (request.url().includes('/rest/v1/site_content')) reads.push(request.url())
        if (request.url().includes('challenges.cloudflare.com')) challenges.push(request.url())
      })
      await context.addInitScript(() => {
        window.requestAnimationFrame = () => 0
      })
      await page.goto(`${base}/cms-public/source`)
      await page.waitForFunction(
        () => document.documentElement.dataset.kncSourceListening === '1',
        null,
        { polling: 20 },
      )
      for (const [index, scene] of ['home', 'my-bookings', 'home'].entries()) {
        const id = `capture-${index}`
        await page.evaluate(
          ({ id, scene, index }) =>
            window.postMessage(
              {
                type: 'knc-source-context',
                id,
                scene,
                lang: 'sv',
                mode: index === 2 ? 'dark' : 'light',
                device: 'Desktop',
              },
              location.origin,
            ),
          { id, scene, index },
        )
        await page.waitForFunction(
          (id) => document.documentElement.dataset.kncSourceReady === id,
          id,
          { polling: 20 },
        )
      }
      assert.equal(reads.length, 1, 'source copy is loaded once, not once per scene/theme')
      assert.deepEqual(challenges, [], 'read-only previews never mount a Turnstile challenge')
      assert.deepEqual(backend.writes, [])
      return { copyReads: reads.length }
    })
  } finally {
    await browser.close()
  }
}
console.log(JSON.stringify(results, null, 2))
assert.ok(
  results.every((result) => result.passed),
  'CMS startup regressions',
)
