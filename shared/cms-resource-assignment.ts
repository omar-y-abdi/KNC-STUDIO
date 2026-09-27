import { validMediaRef, type CmsAsset, type CmsDocument } from './cms'

export type ResourcePurpose = 'library' | 'fonts' | 'salon' | 'cuts' | 'logo' | 'profile'
export type ResourceDestination =
  { purpose: Exclude<ResourcePurpose, 'profile'> } | { purpose: 'profile'; barberId: string }

export const RESOURCE_PURPOSES: Readonly<Record<ResourcePurpose, string>> = {
  library: 'Alla resurser',
  fonts: 'Typsnitt',
  salon: 'I salongen',
  cuts: 'Jobb vi har gjort',
  logo: 'Logotyper',
  profile: 'Profilbilder',
}
export function resourceDestination(
  asset: Pick<CmsAsset, 'bucket' | 'path' | 'mime'>,
): ResourceDestination {
  if (asset.mime === 'font/woff2') return { purpose: 'fonts' }
  if (asset.bucket === 'barber-photos')
    return { purpose: 'profile', barberId: asset.path.split('/')[0] ?? '' }
  if (asset.bucket === 'gallery') {
    if (asset.path.startsWith('salon/')) return { purpose: 'salon' }
    if (asset.path.startsWith('cuts/')) return { purpose: 'cuts' }
    if (asset.path.startsWith('logo/')) return { purpose: 'logo' }
  }
  return { purpose: 'library' }
}

export function matchesDestination(asset: CmsAsset, destination: ResourceDestination): boolean {
  if (destination.purpose === 'library') return true
  const actual = resourceDestination(asset)
  return (
    actual.purpose === destination.purpose &&
    (destination.purpose !== 'profile' ||
      (actual.purpose === 'profile' && actual.barberId === destination.barberId))
  )
}
export function resourceAssigned(
  document: CmsDocument,
  asset: CmsAsset,
  destination: ResourceDestination,
): boolean {
  switch (destination.purpose) {
    case 'salon':
    case 'cuts':
      return document.gallery.some(
        (row) => row.kind === destination.purpose && row.storage_path === asset.path,
      )
    case 'profile':
      return document.photos[destination.barberId] === asset.path
    case 'logo':
      return document.settings['homepage_logo_path'] === asset.path
    case 'fonts':
      return document.presentation.fonts?.[asset.id]?.ref.path === asset.path
    default:
      return false
  }
}

/** Assignments are draft edits. Copy into the required storage scope first; never weaken
 * the same-path/owner rules used by authoritative publication. Inventory stays immutable. */
export function assignResource(
  document: CmsDocument,
  asset: CmsAsset,
  destination: ResourceDestination,
  enabled = true,
): CmsDocument {
  if (!validMediaRef({ bucket: asset.bucket, path: asset.path }))
    throw new Error('Resursens lagringsreferens är ogiltig.')
  if (enabled && (asset.archived || asset.trashed_at))
    throw new Error('Återställ resursen innan den används på en ny plats.')
  if (!matchesDestination(asset, destination))
    throw new Error('Resursen måste kopieras till rätt kategori före tilldelning.')
  if (
    destination.purpose === 'profile' &&
    !document.barbers.some((barber) => barber.id === destination.barberId)
  )
    throw new Error('Välj en befintlig barberare.')
  if (
    destination.purpose !== 'fonts' &&
    destination.purpose !== 'library' &&
    asset.mime !== 'image/webp'
  )
    throw new Error('Denna plats kräver en behandlad bild.')
  const next = structuredClone(document)
  switch (destination.purpose) {
    case 'salon':
    case 'cuts': {
      const present = next.gallery.some(
        (row) => row.kind === destination.purpose && row.storage_path === asset.path,
      )
      if (!enabled)
        next.gallery = next.gallery.filter(
          (row) => !(row.kind === destination.purpose && row.storage_path === asset.path),
        )
      else if (!present) {
        const orders = next.gallery
          .filter((row) => row.kind === destination.purpose)
          .map((row) => row.sort_order)
        next.gallery.push({
          id: asset.id,
          kind: destination.purpose,
          storage_path: asset.path,
          alt: asset.alt,
          sort_order: Math.min(2147483647, Math.max(-1, ...orders) + 1),
        })
      }
      break
    }
    case 'profile':
      if (enabled) next.photos[destination.barberId] = asset.path
      else if (next.photos[destination.barberId] === asset.path)
        Reflect.deleteProperty(next.photos, destination.barberId)
      break
    case 'logo':
      if (enabled) next.settings['homepage_logo_path'] = asset.path
      else if (next.settings['homepage_logo_path'] === asset.path)
        next.settings['homepage_logo_path'] = ''
      break
    case 'fonts':
      next.presentation.fonts ??= {}
      if (enabled)
        next.presentation.fonts[asset.id] = {
          ref: { bucket: asset.bucket, path: asset.path },
          name: asset.name,
        }
      else Reflect.deleteProperty(next.presentation.fonts, asset.id)
      break
  }
  return next
}
