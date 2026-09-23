import type { DesktopSitePreviewPorts } from '../../app/DesktopSite'
import type { SiteChromePort } from '../../site/port'
import { defaultSiteChromePort } from '../../site/adapters'
import { readOnlyHomepagePreviewPorts } from '../views/homepageReplicaPorts'

/** A capture's language/theme/device passes read one consistent public snapshot.
 * This cache is owned by the source frame, never shared with the live site. */
export function memoizeSourceRead<A extends unknown[], T>(
  read: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  const pending = new Map<string, Promise<T>>()
  return (...args) => {
    const key = JSON.stringify(args)
    let result = pending.get(key)
    if (!result) {
      result = read(...args).catch((error: unknown) => {
        pending.delete(key)
        throw error
      })
      pending.set(key, result)
    }
    return result
  }
}

export function sourceReadSnapshot(
  read: DesktopSitePreviewPorts = readOnlyHomepagePreviewPorts(),
  chrome: SiteChromePort = defaultSiteChromePort,
): { ports: DesktopSitePreviewPorts; chrome: SiteChromePort } {
  return {
    ports: {
      ...read,
      barbers: { listActive: memoizeSourceRead(() => read.barbers.listActive()) },
      services: {
        listForBarber: memoizeSourceRead((id, date) => read.services.listForBarber(id, date)),
      },
      gallery: { list: memoizeSourceRead((kind) => read.gallery.list(kind)) },
      aboutContent: { overlay: memoizeSourceRead((lang) => read.aboutContent.overlay(lang)) },
      reviews: { ...read.reviews, list: memoizeSourceRead(() => read.reviews.list()) },
    },
    chrome: { load: memoizeSourceRead((lang) => chrome.load(lang)) },
  }
}
