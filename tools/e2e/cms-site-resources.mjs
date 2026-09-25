import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/knc-resource-workflow'
await mkdir(out, { recursive: true })
const engine = process.env.CMS_ENGINE === 'webkit' ? 'webkit' : 'chromium'
const browser = await { chromium, webkit }[engine].launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(5000)
const snapshot = () =>
  page.evaluate(async () => (await import('/tools/e2e/cms-resources-harness.tsx')).snapshot())
// No test request may escape to production if local environment configuration drifts.
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.origin === new URL(base).origin) return route.fallback()
  if (url.hostname === 'admin-harness.invalid' && url.pathname.startsWith('/storage/'))
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#dce5d4"/><text x="20" y="100">Test image</text></svg>',
    })
  if (url.hostname === 'admin-harness.invalid') return route.fallback()
  console.error('Blocked unexpected test destination:', url.origin, url.pathname)
  return route.abort()
})
page.on('requestfailed', (request) =>
  console.error('Request failure:', new URL(request.url()).pathname, request.failure()?.errorText),
)
await page.route('https://admin-harness.invalid/functions/v1/**', async (route) => {
  const request = route.request()
  const headers = {
    'access-control-allow-origin': new URL(base).origin,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST,OPTIONS',
  }
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const body = request.postData() ?? ''
  const asset = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'New cut.webp',
    bucket: 'gallery',
    path: 'cuts/uploaded.webp',
    alt: '',
    mime: 'image/webp',
    width: 200,
    height: 200,
    bytes: 100,
    archived: false,
    version: 0,
  }
  if (request.url().endsWith('/upload-image')) {
    assert.match(body, /name="purpose"\r\n\r\ncuts/)
    return route.fulfill({ headers, json: { ok: true, asset } })
  }
  const operation = JSON.parse(body)
  if (operation.operation === 'asset_usage')
    return route.fulfill({ headers, json: { currentReferences: 0, historyReferences: 0 } })
  assert.equal(operation.operation, 'asset_copy')
  assert.equal(operation.id, '22222222-2222-4222-8222-222222222222')
  return route.fulfill({
    headers,
    json: {
      ...asset,
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Bank',
      path: `${operation.purpose}/copy.webp`,
    },
  })
})
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () => {
    const { emptyDocument } = await import('/shared/cms.ts')
    const { mountResources } = await import('/tools/e2e/cms-resources-harness.tsx')
    const doc = emptyDocument()
    doc.settings.business_phone_display = '079-000 00 00'
    doc.settings.business_phone_tel = '+46790000000'
    doc.settings.business_maps_href = 'https://maps.google.com/?q=Studio'
    const html =
      '<div data-knc-native="1"><header><svg id="brand" data-knc-source="brand" role="img" aria-label="Hörnlogotyp" viewBox="0 0 100 30"><text x="5" y="20">BNB</text></svg><button id="language" data-knc-source="language" data-knc-required="true" aria-label="Byt språk till engelska"><span>SV</span><span>EN</span></button><a href="tel:+46790000000"><img id="phone-icon" data-knc-source="phone-icon" src="/icons/phone.svg" alt="Telefon" /></a></header></div>'
    doc.presentation.pages = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        path: '/',
        kind: 'page',
        name: { sv: 'Startsida', en: 'Home' },
        title: { sv: '', en: '' },
        description: { sv: '', en: '' },
        inMenu: true,
        content: {
          sv: { html, css: { light: '', dark: '' } },
          en: { html, css: { light: '', dark: '' } },
        },
      },
    ]
    mountResources(
      [
        {
          id: '22222222-2222-4222-8222-222222222222',
          bucket: 'cms-library',
          path: 'images/new.webp',
          name: 'Replacement',
          alt: 'New icon',
          mime: 'image/webp',
          width: 100,
          height: 100,
          bytes: 100,
          archived: false,
          version: 0,
        },
      ],
      doc,
    )
  })
  await page.getByRole('button', { name: 'Webbplatsens resurser', exact: true }).click()
  await page.getByRole('button', { name: 'Hörnlogotyp · Startsida', exact: true }).click()
  await page.getByRole('textbox', { name: 'Logotyptext 1', exact: true }).fill('OWN')
  await page.getByRole('button', { name: 'Spara komponent', exact: true }).click()
  assert.match((await snapshot()).document.presentation.pages[0].content.sv.html, />OWN<\/text>/)
  await page
    .getByRole('button', { name: 'Byt språk till engelska · Startsida', exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Beskrivning', exact: true }).fill('Välj språk')
  await page.getByRole('button', { name: 'Spara komponent', exact: true }).click()
  assert.match(
    (await snapshot()).document.presentation.pages[0].content.sv.html,
    /data-knc-required="true"/,
  )
  await page.getByRole('button', { name: 'Telefon · Startsida', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Ersätt med bild', exact: true })
    .selectOption('22222222-2222-4222-8222-222222222222')
  await page.getByRole('button', { name: 'Ersätt komponentbild', exact: true }).click()
  const result = await snapshot()
  for (const lang of ['sv', 'en'])
    assert.match(
      result.document.presentation.pages[0].content[lang].html,
      /\/cms-library\/images\/new.webp/,
    )
  assert.equal(result.error, '')
  await page.screenshot({ path: `${out}/${engine}-site-components.png` })
  await page.setViewportSize({ width: 390, height: 740 })
  await page.screenshot({ path: `${out}/${engine}-site-components-mobile.png` })
  console.log(
    'PASS site resources: existing logo, SVG text, language control and safe icon replacement',
  )
} finally {
  await browser.close()
}
