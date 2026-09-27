import { mediaUrl, type CmsDocument } from '../../../shared/cms'
import {
  parseHomepageLogoPath,
  parseHomepageLogoStyle,
  parseScale,
  resolveBusinessSettings,
} from '../../site/siteChrome'
import { readOnlyHomepagePreviewPorts } from '../views/homepageReplicaPorts'
import type { sourceReadSnapshot } from './sourceReadCache'

type Snapshot = ReturnType<typeof sourceReadSnapshot>

/** Resource assignment is document data, not just presentation HTML. Preview the
 * current draft through read-only adapters; never publish it merely to display it. */
export function draftReadSnapshot(document: CmsDocument, base: Snapshot, origin: string): Snapshot {
  const people = new Map(document.barbers.map((person) => [person.id, person]))
  return {
    ports: readOnlyHomepagePreviewPorts({
      ...base.ports,
      barbers: {
        listActive: async () =>
          (await base.ports.barbers.listActive()).map((entry) => {
            const person = people.get(entry.barber.id)
            const photo = document.photos[entry.barber.id]
            return {
              ...entry,
              barber: person ? { ...entry.barber, name: person.name, ig: person.ig } : entry.barber,
              copy: person
                ? {
                    roleSv: person.role_sv,
                    roleEn: person.role_en,
                    bioSv: person.bio_sv,
                    bioEn: person.bio_en,
                  }
                : entry.copy,
              photoUrl: photo ? mediaUrl({ bucket: 'barber-photos', path: photo }, origin) : null,
            }
          }),
      },
      gallery: {
        list: async (kind) =>
          document.gallery
            .filter((row) => row.kind === kind)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((row) => ({
              id: row.id,
              alt: row.alt,
              url: mediaUrl({ bucket: 'gallery', path: row.storage_path }, origin),
            })),
      },
      aboutContent: {
        overlay: async (lang) =>
          Object.fromEntries(
            Object.entries(document.about).flatMap(([key, value]) =>
              value[lang] === undefined ? [] : [[key, value[lang]]],
            ),
          ),
      },
    }),
    chrome: {
      load: async (lang) => {
        const current = await base.chrome.load(lang)
        if (!current) return null
        const settings = new Map(Object.entries(document.settings))
        const path = parseHomepageLogoPath(settings.get('homepage_logo_path'))
        return {
          ...current,
          text: Object.fromEntries(
            Object.entries(document.site).flatMap(([key, value]) =>
              value[lang] === undefined ? [] : [[key, value[lang]]],
            ),
          ),
          business: {
            ...resolveBusinessSettings(settings),
            // Operational booking policy is deliberately not editable through this document.
            cancellationPolicyHours: current.business.cancellationPolicyHours,
          },
          homepageScale: parseScale(settings.get('homepage_scale')),
          aboutScale: parseScale(settings.get('about_scale')),
          homepageLogo: {
            path,
            url: path ? mediaUrl({ bucket: 'gallery', path }, origin) : null,
            scale: parseScale(settings.get('homepage_logo_scale')),
            style: parseHomepageLogoStyle(settings.get('homepage_logo_style')),
          },
        }
      },
    },
  }
}
