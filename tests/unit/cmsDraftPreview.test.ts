import { expect, it, vi } from 'vitest'
import { emptyDocument } from '../../shared/cms'
import { DEFAULT_CHROME } from '../../src/site/siteChrome'
import { draftReadSnapshot } from '../../src/admin/cms/draftReadSnapshot'
import type { sourceReadSnapshot } from '../../src/admin/cms/sourceReadCache'

it('previews resource assignments from the draft while retaining live roster eligibility and rejecting writes', async () => {
  const document = emptyDocument()
  document.gallery = [
    {
      id: 'test',
      kind: 'cuts',
      storage_path: 'cuts/draft.webp',
      alt: 'Draft image',
      sort_order: 0,
    },
  ]
  document.photos.a = 'a/draft.webp'
  document.barbers = [
    {
      id: 'a',
      name: 'Draft name',
      ig: 'a',
      role_sv: 'Roll',
      role_en: 'Role',
      bio_sv: 'Bio',
      bio_en: 'Bio',
      sort_order: 0,
    },
  ]
  const submit = vi.fn()
  const base = {
    ports: {
      barbers: {
        listActive: async () => [
          { barber: { id: 'a', name: 'Old', ig: 'a' }, photoUrl: null, copy: null },
        ],
      },
      gallery: { list: async () => [] },
      booking: { submit },
      reviews: { list: async () => [], submit },
      services: { listForBarber: async () => [] },
      aboutContent: { overlay: async () => ({}) },
    },
    chrome: { load: async () => DEFAULT_CHROME },
  } as unknown as ReturnType<typeof sourceReadSnapshot>
  const draft = draftReadSnapshot(document, base, 'https://fixture.invalid')
  expect((await draft.ports.gallery.list('cuts'))[0]?.url).toContain('/gallery/cuts/draft.webp')
  expect(await draft.ports.gallery.list('salon')).toEqual([])
  expect((await draft.ports.barbers.listActive())[0]).toMatchObject({
    barber: { name: 'Draft name' },
    photoUrl: 'https://fixture.invalid/storage/v1/object/public/barber-photos/a/draft.webp',
  })
  expect(submit).not.toHaveBeenCalled()
  expect(draft.ports.booking.submit).not.toBe(submit)
  expect((await draft.chrome.load('sv'))?.business.cancellationPolicyHours).toBe(
    DEFAULT_CHROME.business.cancellationPolicyHours,
  )
})

import { resourceLayoutsChanged } from '../../src/admin/cms/captureResourceLayouts'
it('refreshes the editable resource canvas for contact changes but not unrelated settings', () => {
  const before = emptyDocument()
  const after = structuredClone(before)
  after.settings.business_phone_display = '079-111 22 33'
  expect(resourceLayoutsChanged(before, after)).toBe(true)
  after.settings = { seo_description_sv: 'Only metadata' }
  expect(resourceLayoutsChanged(before, after)).toBe(false)
})
