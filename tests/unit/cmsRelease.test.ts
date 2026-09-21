import { expect, it, vi } from 'vitest'
import { releaseDigest, releaseFiles, verifyBackend } from '../../tools/release/cms-release.mjs'

it.each(releaseFiles)('detects drift in deployed dependency %s', (changed: string) => {
  const baseline = releaseDigest(() => 'original')
  expect(releaseDigest((path: string) => (path === changed ? 'changed' : 'original'))).not.toBe(
    baseline,
  )
})

it('accepts only a healthy backend matching the current source', async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204, headers: { 'x-cms-release': 'current' } }))
  await verifyBackend('https://project.supabase.co', 'current', request)
  expect(request.mock.calls[0]?.[1]).toMatchObject({ method: 'OPTIONS' })
})

it.each([
  new Response(null, { status: 204 }),
  new Response(null, { status: 204, headers: { 'x-cms-release': 'old' } }),
  new Response(null, { status: 503, headers: { 'x-cms-release': 'current' } }),
])('blocks an old, unstamped, or unavailable backend', async (response) => {
  await expect(
    verifyBackend('https://project.supabase.co', 'current', async () => response),
  ).rejects.toThrow('does not match')
})
