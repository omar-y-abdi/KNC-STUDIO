import { expect, it } from 'vitest'
import { validateMarkup } from '../../shared/cms-markup'
import { cmsFrameResponse } from '../../src/worker'

const policy = {
  siteOrigin: 'https://bladeblendstudio.se',
  storageOrigin: 'https://fixture.supabase.co',
}

it('native metadata cannot introduce executable code, arbitrary hooks or unsafe URLs', () => {
  for (const html of [
    '<div data-knc-secret="x"></div>',
    '<button data-knc-source="knc-desktop-home-0" onclick="alert(1)">Book</button>',
    '<div data-knc-light="background:url(https://attacker.invalid/x)"></div>',
    `<div data-knc-baseline='{"src":"javascript:alert(1)"}'></div>`,
    '<script>alert(1)</script>',
  ])
    expect(() => validateMarkup(html, '', policy, { native: true })).toThrow()
  expect(() =>
    validateMarkup('<form data-knc-source="knc-desktop-home-0"></form>', '', policy),
  ).toThrow()
})

it('allows same-origin source embedding without making the admin frameable', () => {
  const response = new Response('source', {
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    },
  })
  const source = cmsFrameResponse(response, true)
  expect(source.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'")
  expect(source.headers.get('Content-Security-Policy')).not.toContain(
    "script-src 'self' 'unsafe-inline'",
  )
  expect(source.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  const admin = cmsFrameResponse(new Response(), false)
  expect(admin.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  expect(admin.headers.get('X-Frame-Options')).toBe('DENY')
})
