import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/backend/config', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ.test.signature',
  isBackendConfigured: () => true,
}))

import {
  isJwtShaped,
  publicApiHeaders,
  publicObjectUrl,
  realtimeUrl,
  restUrl,
  storageObjectUrl,
} from '../../src/backend/publicApi'

const JWT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'

describe('public API headers', () => {
  it('send the key as apikey and, for a JWT-shaped key, as the bearer token', () => {
    expect(publicApiHeaders(JWT_KEY)).toEqual({
      apikey: JWT_KEY,
      Authorization: `Bearer ${JWT_KEY}`,
    })
  })

  it.each(['sb_publishable_abc123', 'e2e-public-anon-key', 'a.b', 'a.b.c.d', ''])(
    'send only apikey for the opaque key %j',
    (key) => {
      expect(isJwtShaped(key)).toBe(false)
      expect(publicApiHeaders(key)).toEqual({ apikey: key })
    },
  )

  it('treat exactly three dot-separated segments as a JWT shape, as the site chrome reads did', () => {
    expect(isJwtShaped('a.b.c')).toBe(true)
    expect(isJwtShaped('..')).toBe(true)
  })
})

describe('project URLs', () => {
  it.each([
    ['https://example.supabase.co', 'https://example.supabase.co'],
    ['https://example.supabase.co/', 'https://example.supabase.co'],
    ['https://127.0.0.1:4197/__supabase', 'https://127.0.0.1:4197/__supabase'],
    ['https://127.0.0.1:4197/__supabase/', 'https://127.0.0.1:4197/__supabase'],
  ])('derive the REST URL from %s', (base, root) => {
    expect(restUrl(base)).toBe(`${root}/rest/v1`)
  })

  it.each([
    ['https://example.supabase.co', 'wss://example.supabase.co/realtime/v1'],
    ['http://localhost:54321/', 'ws://localhost:54321/realtime/v1'],
    ['https://127.0.0.1:4197/__supabase', 'wss://127.0.0.1:4197/__supabase/realtime/v1'],
  ])('derive the Realtime URL from %s', (base, expected) => {
    expect(realtimeUrl(base)).toBe(expected)
  })
})

describe('Storage object URLs', () => {
  const BASES = [
    'https://example.supabase.co',
    'https://example.supabase.co/',
    'https://127.0.0.1:4197/__supabase',
    'https://127.0.0.1:4197/__supabase/',
    'http://localhost:54321',
  ]
  const BUCKETS = ['gallery', 'barber-photos']
  const PATHS = [
    'a.webp',
    'logo/123e4567-e89b-42d3-a456-426614174000.webp',
    '/leading/slash.png',
    '//two/slashes.png',
    'a b/ü#?%x[1]^|.png',
    'ångström/βeta.jpg',
    'plus+and&amp=eq.png',
    '',
    'trailing/',
    'a//b.png',
    'emoji-😀.png',
    `quote"apostrophe'.png`,
    '<angle>.png',
    'back\\slash.png',
    '100%.png',
    '%41.png',
  ]

  // The URLs were built by `storage.from(bucket).getPublicUrl(path)` of supabase-js; the plain
  // function has to reproduce that output byte for byte.
  it.each(BASES)('equal what supabase-js builds for %s', (base) => {
    const client = createClient(base, JWT_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    for (const bucket of BUCKETS)
      for (const path of PATHS)
        expect(storageObjectUrl(base, bucket, path), JSON.stringify({ bucket, path })).toBe(
          client.storage.from(bucket).getPublicUrl(path).data.publicUrl,
        )
  })

  it('resolves gallery and barber-photo paths against the configured project', () => {
    expect(publicObjectUrl('gallery', 'salon/a b.webp')).toBe(
      'https://example.supabase.co/storage/v1/object/public/gallery/salon/a%20b.webp',
    )
    expect(publicObjectUrl('barber-photos', 'photos/b one.webp')).toBe(
      'https://example.supabase.co/storage/v1/object/public/barber-photos/photos/b%20one.webp',
    )
  })
})

describe('without a configured backend', () => {
  afterEach(() => {
    vi.doUnmock('../../src/backend/config')
    vi.resetModules()
  })

  it('refuses to build an object URL instead of inventing a project', async () => {
    vi.resetModules()
    vi.doMock('../../src/backend/config', () => ({
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      isBackendConfigured: () => false,
    }))
    const unconfigured = await import('../../src/backend/publicApi')
    expect(() => unconfigured.publicObjectUrl('gallery', 'a.webp')).toThrow(/not configured/)
  })
})
