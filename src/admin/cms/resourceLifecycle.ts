import { fontOptions } from '../../../shared/cms-fonts'
import { mediaUrl, type CmsAsset, type CmsPresentation } from '../../../shared/cms'

export type ResourceState = 'active' | 'archived' | 'trash'
export type AssetLifecycleAction = 'archive' | 'restore' | 'trash' | 'delete'
export interface CmsAssetUsage {
  currentReferences: number
  historyReferences: number
}
export interface AssetLifecycleResult {
  asset: CmsAsset
  usage: CmsAssetUsage
}
export interface AssetDeleteResult {
  deleted: true
  id: string
  usage: CmsAssetUsage
}
export type CmsAssetLifecycleResult = AssetLifecycleResult | AssetDeleteResult

type LifecycleAsset = CmsAsset & { trashed?: boolean; deleting?: boolean }

export function resourceState(asset: CmsAsset): ResourceState {
  const lifecycle = asset as LifecycleAsset
  return lifecycle.trashed ? 'trash' : asset.archived ? 'archived' : 'active'
}

export function resourceDeleting(asset: CmsAsset): boolean {
  return Boolean((asset as LifecycleAsset).deleting)
}

export function resourceUsable(asset: CmsAsset): boolean {
  return resourceState(asset) === 'active' && !resourceDeleting(asset)
}

export function filterResources(
  assets: CmsAsset[],
  options: {
    state: ResourceState
    kind: 'all' | 'images' | 'fonts'
    query?: string
    eligible?: (asset: CmsAsset) => boolean
  },
): CmsAsset[] {
  const query = (options.query ?? '').toLocaleLowerCase()
  return assets.filter(
    (asset) =>
      resourceState(asset) === options.state &&
      (options.kind === 'all' ||
        asset.mime.startsWith(options.kind === 'fonts' ? 'font/' : 'image/')) &&
      (!query || `${asset.name} ${asset.alt} ${asset.mime}`.toLocaleLowerCase().includes(query)) &&
      (!options.eligible || options.eligible(asset)),
  )
}

export function grapesImageAssets(
  assets: CmsAsset[],
  storageOrigin: string,
): Array<{ src: string; name: string; width?: number; height?: number }> {
  return assets
    .filter((asset) => resourceUsable(asset) && asset.mime.startsWith('image/'))
    .map((asset) => ({
      src: mediaUrl(asset, storageOrigin),
      name: asset.name,
      ...(asset.width === null ? {} : { width: asset.width }),
      ...(asset.height === null ? {} : { height: asset.height }),
    }))
}

export function resourceFontOptions(
  presentation: CmsPresentation,
  assets: CmsAsset[],
): [string, string][] {
  const options = fontOptions(presentation)
  const known = new Set(options.map(([value]) => value))
  for (const asset of assets) {
    if (!resourceUsable(asset) || asset.mime !== 'font/woff2') continue
    const value = `CMSFont-${asset.id}`
    if (!known.has(value)) {
      options.push([value, asset.name])
      known.add(value)
    }
  }
  return options
}

export function fontAssetForFamily(assets: CmsAsset[], value: string): CmsAsset | undefined {
  if (!value.startsWith('CMSFont-')) return undefined
  const id = value.slice('CMSFont-'.length)
  return assets.find(
    (asset) => asset.id === id && asset.mime === 'font/woff2' && resourceUsable(asset),
  )
}
