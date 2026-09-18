import type {
  CmsAsset,
  CmsDocument,
  CmsPublication,
  CmsRevision,
  CmsState,
} from '../../../shared/cms'
import { getAdminClient } from '../adminClient'

export interface AssetUsage {
  currentReferences: number
  historyReferences: number
}
export interface AssetLifecycleResult {
  asset?: CmsAsset
  usage?: AssetUsage
  deleted?: boolean
}
export type CmsAssetPurpose = 'library' | 'salon' | 'cuts' | 'logo' | 'profile'


function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return 'CMS-anropet misslyckades.'
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().functions.invoke('cms-studio', { body })
  if (error) throw new Error(message(error))
  return data as T
}

export const cmsApi = {
  state: (): Promise<CmsState> => invoke({ operation: 'state' }),
  validate: (document: CmsDocument): Promise<{ document: CmsDocument }> =>
    invoke({ operation: 'validate', document }),
  publish: (
    document: CmsDocument,
    baseRevision: number,
    baseFingerprint: string,
    requestId: string,
  ): Promise<CmsPublication> =>
    invoke({ operation: 'publish', document, baseRevision, baseFingerprint, requestId }),
  history: (): Promise<CmsRevision[]> => invoke({ operation: 'history' }),
  revision: (revision: number): Promise<CmsState> => invoke({ operation: 'revision', revision }),
  asset: (
    asset: Pick<CmsAsset, 'id' | 'version' | 'name' | 'alt' | 'archived'>,
  ): Promise<CmsAsset> => invoke({ operation: 'asset', ...asset }),
  assetUsage: (id: string): Promise<AssetUsage> => invoke({ operation: 'asset_usage', id }),
  assetLifecycle: (
    asset: Pick<CmsAsset, 'id' | 'version'>,
    action: 'archive' | 'restore' | 'trash' | 'delete',
  ): Promise<AssetLifecycleResult> =>
    invoke({ operation: 'asset_lifecycle', id: asset.id, version: asset.version, action }),
  uploadAsset: async (
    file: File,
    purpose: CmsAssetPurpose,
    barberId?: string,
  ): Promise<CmsAsset> => {
    const form = new FormData()
    form.set('kind', 'cms_asset')
    form.set('file', file)
    form.set('purpose', purpose)
    if (barberId) form.set('barberId', barberId)
    const { data, error } = await getAdminClient().functions.invoke('upload-image', { body: form })
    if (error) throw new Error(message(error))
    if (!data || typeof data !== 'object' || !('asset' in data))
      throw new Error('Uppladdningen returnerade ingen registrerad resurs.')
    return (data as { asset: CmsAsset }).asset
  },
}
