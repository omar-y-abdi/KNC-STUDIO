import { getAdminClient } from '../adminClient'
import { validateDocument, validMediaRef, type CmsAsset, type CmsState, type CmsRevision, type CmsSave, type CmsPublication, type CmsDocument } from '../../../shared/cms'

export class CmsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = 'CmsApiError' }
  get definitive(): boolean { return this.status >= 400 && this.status < 500 }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CmsApiError('Serverns svar kunde inte läsas.', 502, 'invalid_response')
  return value as Record<string, unknown>
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new CmsApiError('Serverns versionsnummer är ogiltigt.', 502, 'invalid_response')
  return value
}
function fingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) throw new CmsApiError('Serverns versionsstämpel är ogiltig.', 502, 'invalid_response')
  return value
}
export function parseAsset(value: unknown): CmsAsset {
  const row = record(value)
  if (!validMediaRef({ bucket: row.bucket, path: row.path }) || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.alt !== 'string' || typeof row.mime !== 'string' || typeof row.archived !== 'boolean' || (row.width !== null && typeof row.width !== 'number') || (row.height !== null && typeof row.height !== 'number')) throw new CmsApiError('Ogiltiga filuppgifter från servern.', 502, 'invalid_response')
  number(row.bytes); number(row.version)
  return row as unknown as CmsAsset
}
async function call(operation: string, fields: Record<string, unknown> = {}): Promise<unknown> {
  const client = getAdminClient()
  const result = await client.functions.invoke('cms-studio', { body: { operation, ...fields } })
  if (result.error) {
    const error = result.error as { context?: unknown; message?: string }
    const response = error.context instanceof Response ? error.context : null
    let body: Record<string, unknown> = {}
    if (response) { try { body = record(await response.clone().json()) } catch { /* Preserve the actual HTTP failure even when its body is unavailable. */ } }
    const status = response?.status ?? 0
    const message = typeof body.message === 'string' ? body.message : status === 401 || status === 403 ? 'Din ägarinloggning behöver förnyas. Ditt utkast är kvar.' : 'Anslutningen avbröts. Ditt utkast och eventuella sparförsök är kvar.'
    throw new CmsApiError(message, status, typeof body.error === 'string' ? body.error : 'transport')
  }
  return result.data as unknown
}
export const cmsApi = {
  async state(): Promise<CmsState> {
    const row = record(await call('state')); validateDocument(row.document)
    if (!Array.isArray(row.assets)) throw new CmsApiError('Filbiblioteket saknas i serversvaret.', 502, 'invalid_response')
    return { revision: number(row.revision), fingerprint: fingerprint(row.fingerprint), document: row.document, assets: row.assets.map(parseAsset) }
  },
  async history(before?: number): Promise<CmsRevision[]> {
    const value = await call('history', before === undefined ? {} : { before })
    if (!Array.isArray(value)) throw new CmsApiError('Historiken kunde inte läsas.', 502, 'invalid_response')
    return value.map(item => {
      const row = record(item)
      if (typeof row.created_at !== 'string' || typeof row.summary !== 'string') throw new CmsApiError('Historiken kunde inte läsas.', 502, 'invalid_response')
      return { revision: number(row.revision), created_at: row.created_at, summary: row.summary }
    })
  },
  async revision(revision: number): Promise<CmsDocument> {
    const row = record(await call('revision', { revision })); validateDocument(row.document); return row.document
  },
  async validate(document: CmsDocument): Promise<CmsDocument> {
    const row = record(await call('validate', { document })); validateDocument(row.document); return row.document
  },
  async publish(request: CmsSave): Promise<CmsPublication> {
    const row = record(await call('publish', { ...request })); validateDocument(row.document)
    if (row.requestId !== request.requestId) throw new CmsApiError('Svaret tillhör ett annat sparförsök.', 502, 'invalid_response')
    return { revision: number(row.revision), fingerprint: fingerprint(row.fingerprint), requestId: request.requestId, document: row.document }
  },
  async asset(asset: CmsAsset): Promise<CmsAsset> {
    return parseAsset(await call('asset', { id: asset.id, version: asset.version, name: asset.name, alt: asset.alt, archived: asset.archived }))
  },
  async upload(file: File, purpose: 'library' | 'salon' | 'cuts' | 'logo' | 'profile', barberId?: string): Promise<CmsAsset> {
    const body = new FormData(); body.append('kind', 'cms_asset'); body.append('file', file); body.append('purpose', purpose)
    if (barberId) body.append('barberId', barberId)
    const result = await getAdminClient().functions.invoke('upload-image', { body })
    if (result.error) {
      const context = (result.error as { context?: unknown }).context
      let code = 'upload_failed'
      if (context instanceof Response) { try { const data: unknown = await context.clone().json(); const row = record(data); if (typeof row.error === 'string') code = row.error } catch { /* Keep the upload rejected. */ } }
      throw new CmsApiError(`Filen kunde inte laddas upp (${code}).`, context instanceof Response ? context.status : 0, code)
    }
    return parseAsset(record(result.data).asset)
  },
}
export type CmsApi = typeof cmsApi
