import test from 'node:test'
import assert from 'node:assert/strict'
import { localCmsHeaders } from './cms-local-assets.mjs'
const headers =
  "/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' https://*.supabase.co; font-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests\n  X-Frame-Options: DENY\n"
test('local browser fixture uses the configured backend, retaining all other restrictions', () => {
  const result = localCmsHeaders(headers, 'http://127.0.0.1:54321')
  assert.match(result, /connect-src 'self' http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321/)
  assert.match(result, /img-src 'self' http:\/\/127\.0\.0\.1:54321/)
  assert.match(result, /font-src 'self' http:\/\/127\.0\.0\.1:54321/)
  for (const directive of [
    "script-src 'self' https://challenges.cloudflare.com",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    'X-Frame-Options: DENY',
  ])
    assert.ok(result.includes(directive), directive)
  assert.ok(!result.includes('upgrade-insecure-requests'))
  assert.ok(
    !result.includes('unsafe-eval') && !result.includes("script-src 'self' 'unsafe-inline'"),
  )
})
test('production and malformed backend URLs cannot be used by the local fixture builder', () => {
  for (const url of [
    'https://production.supabase.co',
    'http://127.0.0.1.evil.test:54321',
    'http://user:secret@127.0.0.1:54321',
    'http://127.0.0.1:54321/other',
    'http://127.0.0.1:54321/?query=1',
  ])
    assert.throws(() => localCmsHeaders(headers, url))
})
test('an absent CSP or loss of its script/embedding restrictions is not silently accepted', () => {
  assert.throws(() => localCmsHeaders('', 'http://127.0.0.1:54321'))
  assert.throws(() =>
    localCmsHeaders(headers.replace("script-src 'self'", 'script-src *'), 'http://127.0.0.1:54321'),
  )
  assert.throws(() =>
    localCmsHeaders(
      headers.replace("frame-ancestors 'none'", 'frame-ancestors *'),
      'http://127.0.0.1:54321',
    ),
  )
})
