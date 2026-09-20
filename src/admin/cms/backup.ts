import type { CmsDocument } from '../../../shared/cms'

interface Backup {
  document: CmsDocument
  savedAt: string
  // Keep backups written by the metadata-free version recoverable.
  revision?: number
  fingerprint?: string
  base?: CmsDocument
}

const tabId = sessionStorage.getItem('knc-cms-tab') ?? crypto.randomUUID()
sessionStorage.setItem('knc-cms-tab', tabId)
const key = `knc-cms-draft:${tabId}`

export function saveBackup(
  document: CmsDocument,
  revision: number,
  fingerprint: string,
  base?: CmsDocument,
): void {
  const value: Backup = {
    document,
    revision,
    fingerprint,
    ...(base ? { base } : {}),
    savedAt: new Date().toISOString(),
  }
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadBackup(): Backup | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Backup | null
    if (!value?.document || typeof value.savedAt !== 'string') return null
    if (value.revision !== undefined && !Number.isSafeInteger(value.revision)) return null
    if (value.fingerprint !== undefined && typeof value.fingerprint !== 'string') return null
    return value
  } catch {
    return null
  }
}

export function clearBackup(): void {
  localStorage.removeItem(key)
}
