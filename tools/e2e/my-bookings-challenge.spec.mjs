import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend } from './public-fixtures.mjs'

// Cloudflare's turnstile.render runs the challenge at once (a challenge iframe, ~1.5 s of script,
// compositor stalls), so the lookup form must not mount the widget on open. This counting stub
// replaces the fixture's context-level stub: a page route wins over a context route.
const TURNSTILE_COUNTING_STUB =
  'window.turnstile={render:(_node,options)=>{globalThis.__kncTurnstileRenders=(globalThis.__kncTurnstileRenders??0)+1;queueMicrotask(()=>options.callback("local-test-token"));return "local"},remove:()=>{},reset:()=>{}}'
const labels = {
  bookings: 'Mina bokningar',
  email: 'E-post',
  send: 'Skicka säker länk',
}
const renders = (page) => page.evaluate(() => globalThis.__kncTurnstileRenders ?? 0)

for (const width of [390, 1440]) {
  test(`the lookup challenge starts on the first email input, not on open (${width}, sv)`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installStoredBackend(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'functional', url: harnessOrigin },
    ])
    let requests = 0
    // No device receipt: the list call is denied and the dialog lands on the lookup step.
    await context.route('**/api/customer-bookings', (route) => {
      const body = route.request().postDataJSON()
      if (body.action === 'list')
        return route.fulfill({ json: { ok: false, error: 'access_denied' } })
      expect(body.action).toBe('request_access')
      expect(body.email).toBe('customer@example.test')
      requests++
      return route.fulfill({ json: { ok: true } })
    })
    await page.route('https://challenges.cloudflare.com/**', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: TURNSTILE_COUNTING_STUB }),
    )
    await page.goto(`${harnessOrigin}/?mode=light&lang=sv`)
    await page.getByRole('button', { name: labels.bookings, exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: labels.bookings, exact: true })
    await expect(dialog).toBeVisible()
    const email = dialog.getByRole('textbox', { name: labels.email, exact: true })
    const send = dialog.getByRole('button', { name: labels.send, exact: true })
    await expect(email).toBeVisible()
    await expect(email).toBeFocused()
    await expect(send).toBeVisible()
    await expect(send).toBeDisabled()
    // The pinning assertion: no widget on open, and still none 300 ms later.
    expect(await renders(page)).toBe(0)
    await page.evaluate(() => new Promise((resolve) => globalThis.setTimeout(resolve, 300)))
    expect(await renders(page)).toBe(0)
    await email.pressSequentially('k')
    await expect.poll(() => renders(page)).toBe(1)
    // The latch keeps the one widget mounted across a cleared field; its token enables send.
    await email.fill('')
    await email.fill('customer@example.test')
    await expect(send).toBeEnabled()
    expect(await renders(page)).toBe(1)
    await send.click()
    await expect.poll(() => requests).toBe(1)
    await expect(email).toHaveCount(0)
  })
}
