import { describe, expect, it, vi } from 'vitest'
import type { DesktopSitePreviewPorts } from '../../src/app/DesktopSite'
import { readOnlyHomepagePreviewPorts } from '../../src/admin/views/homepageReplicaPorts'
import { asBarberId } from '../../src/booking/domain'

describe('homepage replica preview ports', () => {
  it('keeps production reads but blocks booking and review writes', async () => {
    const availability = vi.fn().mockResolvedValue(['10:00'])
    const bookingSubmit = vi.fn()
    const reviewList = vi.fn().mockResolvedValue([])
    const reviewSubmit = vi.fn()
    const source: DesktopSitePreviewPorts = {
      booking: { availability, submit: bookingSubmit },
      barbers: { listActive: vi.fn().mockResolvedValue([]) },
      services: { listForBarber: vi.fn().mockResolvedValue([]) },
      reviews: { list: reviewList, submit: reviewSubmit },
      aboutContent: { overlay: vi.fn().mockResolvedValue({}) },
      gallery: { list: vi.fn().mockResolvedValue([]) },
    }
    const preview = readOnlyHomepagePreviewPorts(source)
    const params = {
      barberId: asBarberId('preview-barber'),
      dateIso: '2099-01-05',
      durationMin: 30,
    }

    await expect(preview.booking.availability(params)).resolves.toEqual(['10:00'])
    await expect(preview.reviews.list()).resolves.toEqual([])
    expect(availability).toHaveBeenCalledWith(params)
    expect(reviewList).toHaveBeenCalledOnce()
    expect(preview.barbers).toBe(source.barbers)
    expect(preview.services).toBe(source.services)
    expect(preview.aboutContent).toBe(source.aboutContent)
    expect(preview.gallery).toBe(source.gallery)

    await expect(preview.booking.submit({} as never)).resolves.toMatchObject({ ok: false })
    await expect(preview.reviews.submit({} as never, 'token')).resolves.toMatchObject({ ok: false })
    expect(bookingSubmit).not.toHaveBeenCalled()
    expect(reviewSubmit).not.toHaveBeenCalled()
  })
})
