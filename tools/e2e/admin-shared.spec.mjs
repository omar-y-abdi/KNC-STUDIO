import { test, expect } from './fixtures.mjs'
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

test('staff invitation waits for consent, sets password and rejects replay', async ({ page }) => {
  const token = 'a'.repeat(64)
  const calls = []
  let consumed = false
  const now = Math.floor(Date.now() / 1000)
  const user = {
    id: '75000000-0000-0000-0000-000000000001',
    email: 'staff@example.invalid',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  }
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: now + 3600, iat: now, role: 'authenticated', aud: 'authenticated', email: user.email })}.synthetic-signature`,
    refresh_token: 'synthetic-refresh',
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: 'bearer',
    user,
  }
  await page.route('https://admin-harness.invalid/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers':
        'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers })
    calls.push(path)
    if (path.endsWith('/redeem-staff-invite')) {
      expect(request.postDataJSON()).toEqual({ token })
      if (consumed)
        return route.fulfill({
          status: 400,
          headers,
          json: { ok: false, error: 'invalid_invitation' },
        })
      consumed = true
      return route.fulfill({ headers, json: { ok: true, token_hash: 'fresh-auth-token' } })
    }
    if (path.endsWith('/verify')) {
      expect(request.postDataJSON()).toEqual({
        token_hash: 'fresh-auth-token',
        type: 'invite',
        gotrue_meta_security: {},
      })
      return route.fulfill({ headers, json: session })
    }
    if (path.endsWith('/user')) {
      if (request.method() === 'PUT')
        expect(request.postDataJSON().password).toBe('Staff-Test-123!')
      return route.fulfill({ headers, json: user })
    }
    if (path.endsWith('/logout')) return route.fulfill({ headers, json: {} })
    throw new Error(`Unexpected staff enrollment request: ${path}`)
  })
  const mount = async () => {
    await page.goto('/tools/e2e/admin-harness.html')
    await page.evaluate(async (token) => {
      const { h, render } = await import('/tools/e2e/admin-harness.tsx')
      const { ResetPasswordPage } = await import('/src/admin/ResetPasswordPage.tsx')
      globalThis.history.replaceState({}, '', `/invite#staff_invite=${token}`)
      render(
        h(ResetPasswordPage, { linkType: 'invite', onDone: () => undefined }),
        globalThis.document.getElementById('root'),
      )
    }, token)
  }
  await mount()
  await expect(page.getByRole('button', { name: /Öppna inbjudan|Open invitation/ })).toBeVisible()
  expect(calls).toEqual([])
  await page.getByRole('button', { name: /Öppna inbjudan|Open invitation/ }).click()
  await expect(page.locator('#rp-next')).toBeVisible()
  expect(calls.slice(0, 2)).toEqual(['/functions/v1/redeem-staff-invite', '/auth/v1/verify'])
  await page.locator('#rp-next').fill('Staff-Test-123!')
  await page.locator('#rp-confirm').fill('Staff-Test-123!')
  await page.getByRole('button', { name: /Aktivera konto|Activate account/, exact: true }).click()
  await expect(page.getByRole('status')).toContainText(/aktiverat|active/)
  await mount()
  await page.getByRole('button', { name: /Öppna inbjudan|Open invitation/ }).click()
  await expect(page.getByRole('alert')).toContainText(/ogiltig|invalid/)
  expect(calls.filter((path) => path.endsWith('/verify'))).toHaveLength(1)
})
