import { test } from './fixtures.mjs'
import { verifyPrivacy, verifyCmsStudioShell, privacyCases } from './admin-checks.mjs'
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 10000 })
for (const options of privacyCases)
  test('privacy ' + JSON.stringify(options), async ({ page }) => {
    page.setDefaultTimeout(10000)
    await verifyPrivacy(page, options)
  })
test('CMS shell', async ({ page }) => {
  page.setDefaultTimeout(10000)
  await verifyCmsStudioShell(page)
})
