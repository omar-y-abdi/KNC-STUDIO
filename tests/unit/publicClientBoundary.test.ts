import { describe, expect, it, vi } from 'vitest'

// The public pages talk to Supabase through the slim REST and Realtime clients. Loading any public
// adapter must never evaluate the full supabase-js client (auth, storage and functions included).
vi.mock('@supabase/supabase-js', () => {
  throw new Error('the public pages must not load @supabase/supabase-js')
})

vi.mock('../../src/backend/config', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ.test.signature',
  isBackendConfigured: () => true,
}))

const PUBLIC_ADAPTERS = {
  gallery: () => import('../../src/about/gallery/supabaseGallery'),
  reviews: () => import('../../src/about/reviews/adapters/supabaseReviews'),
  aboutContent: () => import('../../src/about/content/supabaseAboutContent'),
  booking: () => import('../../src/booking/adapters/supabaseBooking'),
  bookingCatalog: () => import('../../src/booking/adapters/supabaseBookingCatalog'),
  siteChrome: () => import('../../src/site/adapters/supabaseSiteChrome'),
  publicRest: () => import('../../src/backend/publicRest'),
  publicRealtime: () => import('../../src/backend/publicRealtime'),
}

describe('public adapters', () => {
  it.each(Object.entries(PUBLIC_ADAPTERS))('%s loads without supabase-js', async (_name, load) => {
    await expect(load()).resolves.toBeDefined()
  })
})
