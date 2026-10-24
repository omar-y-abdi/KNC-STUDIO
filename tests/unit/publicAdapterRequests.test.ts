import { afterEach, describe, expect, it, vi } from 'vitest'
import { asBarberId } from '../../src/booking/domain'

// The public adapters used to read through the full supabase-js client. These are the requests
// that client made for each adapter call, recorded from the unchanged adapters; the slim clients
// have to issue the same calls: URL, method, body and headers (X-Client-Info aside, which only
// names the library).

const PROJECT_URL = 'https://example.supabase.co'
const REST = `${PROJECT_URL}/rest/v1`
const JWT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'
const OPAQUE_KEY = 'e2e-public-anon-key'

interface Recorded {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | null
}

const CATALOG = {
  barbers: [
    {
      id: 'b1',
      name: 'Barber One',
      ig: 'one',
      role_sv: 'Barberare',
      role_en: 'Barber',
      bio_sv: 'Bio',
      bio_en: 'Bio',
      active: true,
      sort_order: 0,
      photo_path: 'photos/b one.webp',
    },
  ],
  services: [],
}

function answerFor(pathname: string): unknown {
  if (pathname.endsWith('/rpc/public_booking_catalog')) return CATALOG
  if (pathname.endsWith('/rpc/public_business_discovery'))
    return { settings: {}, barbers: [], services: [], schedules: [] }
  if (pathname.endsWith('/gallery_images'))
    return [{ id: 'g1', kind: 'salon', storage_path: 'salon/a b.webp', alt: 'Alt', sort_order: 1 }]
  if (pathname.endsWith('/reviews')) return [{ id: 'r1', name: 'Ada', rating: 5, text: 'Bra' }]
  if (pathname.endsWith('/about_content')) return [{ key: 'heading', lang: 'sv', value: 'Rubrik' }]
  if (pathname.includes('/rpc/available_slots')) return ['09:00', '09:30']
  return []
}

/** Every adapter call in a fixed order, against a recording fetch and the given anon key. */
async function runAdapters(key: string) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => {
      if (name !== 'x-client-info') headers[name] = value
    })
    const url = String(input)
    requests.push({
      method: init?.method ?? 'GET',
      url,
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    })
    return Response.json(answerFor(new URL(url).pathname))
  })
  vi.resetModules()
  vi.doMock('../../src/backend/config', () => ({
    SUPABASE_URL: PROJECT_URL,
    SUPABASE_ANON_KEY: key,
    isBackendConfigured: () => true,
  }))
  const { supabaseGalleryAdapter } = await import('../../src/about/gallery/supabaseGallery')
  const { supabaseReviewsAdapter } =
    await import('../../src/about/reviews/adapters/supabaseReviews')
  const { supabaseAboutContentAdapter } =
    await import('../../src/about/content/supabaseAboutContent')
  const { supabaseBookingAdapter } = await import('../../src/booking/adapters/supabaseBooking')
  const { refreshBookingCatalog } =
    await import('../../src/booking/adapters/supabaseBookingCatalog')
  const { supabaseSiteChromeAdapter } = await import('../../src/site/adapters/supabaseSiteChrome')

  const photos = await supabaseGalleryAdapter.list('salon')
  const cuts = await supabaseGalleryAdapter.list('cuts')
  const reviews = await supabaseReviewsAdapter.list()
  const overlay = await supabaseAboutContentAdapter.overlay('sv')
  const barberId = asBarberId('b1')
  const slots = await supabaseBookingAdapter.availability({
    barberId,
    dateIso: '2040-03-18',
    durationMin: 45,
  })
  const serviceSlots = await supabaseBookingAdapter.availability({
    barberId,
    dateIso: '2040-03-18',
    durationMin: 45,
    serviceId: 's1',
  })
  const catalog = await refreshBookingCatalog()
  const chrome = await supabaseSiteChromeAdapter.load('sv')
  return {
    requests,
    values: {
      photos,
      cuts,
      reviews,
      overlay,
      slots,
      serviceSlots,
      photoUrls: catalog.barbers.map((entry) => entry.photoUrl),
      chromeLoaded: chrome !== null,
    },
  }
}

function expectedRequests(key: string, bearer: boolean): readonly Recorded[] {
  const auth = bearer ? { authorization: `Bearer ${key}` } : {}
  const read = { 'accept-profile': 'public', apikey: key, ...auth }
  const rpc = {
    apikey: key,
    'content-profile': 'public',
    'content-type': 'application/json',
    ...auth,
  }
  const raw = { apikey: key, ...auth }
  const gallery = `${REST}/gallery_images?select=id%2Ckind%2Cstorage_path%2Calt%2Csort_order`
  return [
    {
      method: 'GET',
      url: `${gallery}&kind=eq.salon&order=sort_order.asc`,
      headers: read,
      body: null,
    },
    {
      method: 'GET',
      url: `${gallery}&kind=eq.cuts&order=sort_order.asc`,
      headers: read,
      body: null,
    },
    {
      method: 'GET',
      url: `${REST}/reviews?select=id%2Cname%2Crating%2Ctext&published=eq.true&order=created_at.desc`,
      headers: read,
      body: null,
    },
    {
      method: 'GET',
      url: `${REST}/about_content?select=key%2Clang%2Cvalue&lang=eq.sv`,
      headers: read,
      body: null,
    },
    {
      method: 'POST',
      url: `${REST}/rpc/available_slots`,
      headers: rpc,
      body: '{"p_barber_id":"b1","p_date":"2040-03-18","p_duration_min":45}',
    },
    {
      method: 'POST',
      url: `${REST}/rpc/available_slots_for_service`,
      headers: rpc,
      body: '{"p_barber_id":"b1","p_date":"2040-03-18","p_service_id":"s1"}',
    },
    { method: 'POST', url: `${REST}/rpc/public_booking_catalog`, headers: rpc, body: '{}' },
    {
      method: 'GET',
      url: `${REST}/site_content?select=key%2Clang%2Cvalue&lang=eq.sv`,
      headers: raw,
      body: null,
    },
    {
      method: 'POST',
      url: `${REST}/rpc/public_business_discovery`,
      headers: { ...raw, 'content-type': 'application/json' },
      body: '{}',
    },
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('../../src/backend/config')
})

describe.each([
  ['a JWT-shaped key', JWT_KEY, true],
  // supabase-js also put an opaque key in `Authorization: Bearer`. The public clients follow the
  // rule the site chrome reads already used: only a JWT-shaped key is a bearer token.
  ['an opaque key', OPAQUE_KEY, false],
] as const)('public adapters with %s', (_label, key, bearer) => {
  it('issue the requests the supabase-js client made', async () => {
    const { requests } = await runAdapters(key)
    expect(requests).toEqual(expectedRequests(key, bearer))
  })

  it('return the same values, with Storage URLs resolved as before', async () => {
    const { values } = await runAdapters(key)
    const photo = {
      id: 'g1',
      url: `${PROJECT_URL}/storage/v1/object/public/gallery/salon/a%20b.webp`,
      alt: 'Alt',
    }
    expect(values).toEqual({
      photos: [photo],
      cuts: [photo],
      reviews: [{ id: 'r1', name: 'Ada', rating: 5, text: 'Bra' }],
      overlay: { heading: 'Rubrik' },
      slots: ['09:00', '09:30'],
      serviceSlots: ['09:00', '09:30'],
      photoUrls: [`${PROJECT_URL}/storage/v1/object/public/barber-photos/photos/b%20one.webp`],
      chromeLoaded: true,
    })
  })
})
