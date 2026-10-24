import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PROJECT_URL = 'https://example.supabase.co'
const JWT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'

async function loadRest(key: string | undefined) {
  vi.resetModules()
  vi.doMock('../../src/backend/config', () => ({
    SUPABASE_URL: key === undefined ? undefined : PROJECT_URL,
    SUPABASE_ANON_KEY: key,
    isBackendConfigured: () => key !== undefined,
  }))
  return import('../../src/backend/publicRest')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../src/backend/config')
})

describe('public REST client', () => {
  it('is created once and shared', async () => {
    const { getPublicRest } = await loadRest(JWT_KEY)
    expect(getPublicRest()).toBe(getPublicRest())
  })

  it('refuses to exist without a configured backend', async () => {
    const { getPublicRest } = await loadRest(undefined)
    expect(() => getPublicRest()).toThrow(/not configured/)
  })

  it('looks fetch up when a request is made, so a later stub or polyfill is honoured', async () => {
    const { getPublicRest } = await loadRest(JWT_KEY)
    const rest = getPublicRest()
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      seen.push(String(input))
      return Response.json([])
    })
    await rest.from('reviews').select('id')
    expect(seen).toEqual([`${PROJECT_URL}/rest/v1/reviews?select=id`])
  })

  it('reports a PostgREST error the way supabase-js did', async () => {
    const problem = { code: 'PGRST100', message: 'bad filter', details: 'why', hint: 'how' }
    vi.stubGlobal('fetch', async () => Response.json(problem, { status: 400 }))
    const previous = await createClient(PROJECT_URL, JWT_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
      .from('reviews')
      .select('id')

    const { getPublicRest } = await loadRest(JWT_KEY)
    const current = await getPublicRest().from('reviews').select('id')

    expect(current.data).toEqual(previous.data)
    expect(current.status).toBe(previous.status)
    expect(current.error).toMatchObject(problem)
    expect(current.error?.message).toBe(previous.error?.message)
  })

  it('returns rows untouched on success', async () => {
    const rows = [{ id: 'r1' }, { id: 'r2' }]
    vi.stubGlobal('fetch', async () => Response.json(rows))
    const { getPublicRest } = await loadRest(JWT_KEY)
    const { data, error } = await getPublicRest().from('reviews').select('id')
    expect(error).toBeNull()
    expect(data).toEqual(rows)
  })
})
