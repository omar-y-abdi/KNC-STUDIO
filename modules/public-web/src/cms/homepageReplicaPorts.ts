// CMS homepage replica ports: keep production reads faithful, but deny both public write paths.

import type { DesktopSitePreviewPorts } from '../app/DesktopSite'
import { defaultAboutContentPort } from '../about/content/index'
import { defaultGalleryPort } from '../about/gallery/index'
import { defaultReviewsPort } from '../about/reviews/adapters/index'
import { defaultBookingPort } from '../booking/adapters/index'
import { defaultBarbersPort } from '../booking/adapters/barbersIndex'
import { defaultServicesPort } from '../booking/adapters/servicesIndex'

export function readOnlyHomepagePreviewPorts(
  read: Pick<
    DesktopSitePreviewPorts,
    'booking' | 'barbers' | 'services' | 'reviews' | 'aboutContent' | 'gallery'
  > = {
    booking: defaultBookingPort,
    barbers: defaultBarbersPort,
    services: defaultServicesPort,
    reviews: defaultReviewsPort,
    aboutContent: defaultAboutContentPort,
    gallery: defaultGalleryPort,
  },
): DesktopSitePreviewPorts {
  return {
    booking: {
      availability: (params) => read.booking.availability(params),
      // A kind of its own: the flow writes its line from the kind, and "could not be sent, try
      // again" would be untrue of a preview that never sends.
      submit: () =>
        Promise.resolve({
          ok: false,
          error: { kind: 'read_only', message: 'Preview is read-only.' },
        }),
    },
    barbers: read.barbers,
    services: read.services,
    reviews: {
      list: () => read.reviews.list(),
      submit: () =>
        Promise.resolve({
          ok: false,
          error: { kind: 'submit', message: 'Preview is read-only.' },
        }),
    },
    aboutContent: read.aboutContent,
    gallery: read.gallery,
  }
}
