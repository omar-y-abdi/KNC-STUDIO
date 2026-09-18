import type {
  CmsAsset,
  CmsDocument,
  CmsPublication,
  CmsRevision,
  CmsState,
} from '../../../shared/cms'
import { getAdminClient } from '../adminClient'

interface HistoryResponse {
  items?: CmsRevision[]
  history?: CmsRevision[]
}

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
  history: async (): Promise<CmsRevision[]> => {
    const value = await invoke<HistoryResponse | CmsRevision[]>({ operation: 'history' })
    if (Array.isArray(value)) return value
    return value.items ?? value.history ?? []
  },
  revision: (revision: number): Promise<CmsState> => invoke({ operation: 'revision', revision }),
  asset: (
    asset: Pick<CmsAsset, 'id' | 'version' | 'name' | 'alt' | 'archived'>,
  ): Promise<CmsAsset> => invoke({ operation: 'asset', ...asset }),
}
