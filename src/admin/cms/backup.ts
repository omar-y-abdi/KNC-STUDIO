import type { CmsDocument } from '../../../shared/cms'

interface Backup {
  document: CmsDocument
  savedAt: string
}

const tabId = sessionStorage.getItem('knc-cms-tab') ?? crypto.randomUUID()
sessionStorage.setItem('knc-cms-tab', tabId)
const key = `knc-cms-draft:${tabId}`

export function saveBackup(document: CmsDocument): void {
  const value: Backup = { document, savedAt: new Date().toISOString() }
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadBackup(): Backup | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Backup | null
    return value?.document && typeof value.savedAt === 'string' ? value : null
  } catch {
    return null
  }
}

export function clearBackup(): void {
  localStorage.removeItem(key)
}
