import { expect, it, vi } from 'vitest'
import { emptyDocument } from '../../shared/cms'

it('retains backup metadata and recovers metadata-free drafts', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: () => 'regression', setItem: vi.fn() })
  vi.stubGlobal('localStorage', {
    getItem: storage.get.bind(storage),
    setItem: storage.set.bind(storage),
    removeItem: storage.delete.bind(storage),
  })
  try {
    const { saveBackup, loadBackup, clearBackup } = await import('../../src/admin/cms/backup')
    const document = emptyDocument()
    const fingerprint = '0123456789abcdef0123456789abcdef'
    const key = 'knc-cms-draft:regression'
    saveBackup(document, 7, fingerprint)
    expect(loadBackup()).toMatchObject({ document, revision: 7, fingerprint })

    const legacy = { document, savedAt: '2026-09-18T00:00:00Z' }
    storage.set(key, JSON.stringify(legacy))
    expect(loadBackup()).toEqual(legacy)
    storage.set(key, JSON.stringify({ ...legacy, revision: '7' }))
    expect(loadBackup()).toBeNull()
    storage.set(key, JSON.stringify({ ...legacy, fingerprint: 7 }))
    expect(loadBackup()).toBeNull()
    clearBackup()
    expect(loadBackup()).toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
})
