import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  validateDocument,
  type CmsAsset,
  type CmsDocument,
  type CmsRevision,
  type CmsState,
} from '../../../shared/cms'
import { cmsApi, CmsApiError, type CmsApi } from './api'
import {
  CmsDraft,
  mergeDocuments,
  parseBackup,
  type DraftBackup,
  type MergeConflict,
} from './draft'

interface BackupEntry {
  key: string
  raw: string
  savedAt: string
  invalid: boolean
}
export function useStudio(userId: string, api: CmsApi = cmsApi) {
  const [draft, setDraft] = useState<CmsDraft | null>(null),
    [assets, setAssets] = useState<CmsAsset[]>([])
  const [version, tick] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [backupError, setBackupError] = useState(''),
    [backups, setBackups] = useState<BackupEntry[]>([])
  const [remote, setRemote] = useState<CmsState | null>(null),
    [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({})
  const [history, setHistory] = useState<CmsRevision[]>([])
  const alive = useRef(true),
    saving = useRef(false),
    draftRef = useRef(draft)
  draftRef.current = draft
  const [tabId] = useState(() => {
    try {
      const previous = sessionStorage.getItem('knc-cms-tab')
      if (previous) return previous
      const next = crypto.randomUUID()
      sessionStorage.setItem('knc-cms-tab', next)
      return next
    } catch {
      return crypto.randomUUID()
    }
  })
  const prefix = `knc-cms:v1:${userId}:`,
    key = `${prefix}${tabId}`
  const changed = useCallback(() => tick((value) => value + 1), [])
  const backup = useCallback(
    (value: CmsDraft): void => {
      try {
        if (value.dirty || value.pending)
          localStorage.setItem(key, JSON.stringify(value.backup(userId)))
        else localStorage.removeItem(key)
        setBackupError('')
      } catch {
        setBackupError(
          'Reservutkastet kan inte sparas på den här enheten. Exportera en reservkopia innan du lämnar sidan.',
        )
      }
    },
    [key, userId],
  )
  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const state = await api.state()
      if (!alive.current) return
      setDraft(new CmsDraft(state))
      setAssets(state.assets)
      const entries: BackupEntry[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const storedKey = localStorage.key(i)
          if (!storedKey?.startsWith(prefix)) continue
          const raw = localStorage.getItem(storedKey)
          if (!raw) continue
          try {
            const value = parseBackup(raw, userId)
            entries.push({ key: storedKey, raw, savedAt: value.savedAt, invalid: false })
          } catch {
            entries.push({ key: storedKey, raw, savedAt: '', invalid: true })
          }
        }
      } catch {
        setBackupError(
          'Lokal lagring är blockerad. Exportera en reservkopia för att skydda osparade ändringar.',
        )
      }
      setBackups(entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt)))
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : 'Studion kunde inte läsas.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [api, prefix, userId])
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])
  useEffect(() => {
    if (draft && (version > 0 || draft.dirty || draft.pending)) backup(draft)
  }, [draft, version, backup])
  useEffect(() => {
    const before = (event: BeforeUnloadEvent): void => {
      const current = draftRef.current
      if (current && (current.dirty || current.pending)) {
        backup(current)
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [backup])
  const edit = (operation: (document: CmsDocument) => void, group = ''): void => {
    if (!draft) return
    try {
      if (draft.change(operation, group)) {
        setError('')
        changed()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ändringen kunde inte användas.')
    }
  }
  const publish = async (): Promise<void> => {
    if (!draft || saving.current || (!draft.dirty && !draft.pending)) return
    saving.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const request = draft.request()
    backup(draft)
    changed()
    try {
      const result = await api.publish(request)
      if (!alive.current) return
      draft.acknowledge(result)
      backup(draft)
      changed()
      setRemote(null)
      setNotice(
        `Version ${result.revision} är publicerad${draft.dirty ? '. Nyare ändringar finns kvar i utkastet.' : '.'}`,
      )
    } catch (reason) {
      if (!alive.current) return
      draft.rejected(reason instanceof CmsApiError && reason.definitive)
      backup(draft)
      changed()
      setError(reason instanceof Error ? reason.message : 'Publiceringen kunde inte bekräftas.')
      if (reason instanceof CmsApiError && reason.status === 409) {
        try {
          const latest = await api.state()
          if (alive.current) {
            setRemote(latest)
            setChoices({})
            setAssets(latest.assets)
          }
        } catch {
          if (alive.current)
            setNotice(
              'Den nya versionen kunde inte hämtas. Försök jämföra igen när anslutningen fungerar.',
            )
        }
      }
    } finally {
      saving.current = false
      if (alive.current) setBusy(false)
    }
  }
  const compareLatest = async (): Promise<void> => {
    if (busy || !draft || draft.pending) return
    setBusy(true)
    try {
      const latest = await api.state()
      if (alive.current) {
        setRemote(latest)
        setChoices({})
        setAssets(latest.assets)
      }
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : 'Versionen kunde inte hämtas.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  let conflicts: MergeConflict[] = []
  if (draft && remote) {
    try {
      conflicts = mergeDocuments(draft.base, draft.document, remote.document, choices).conflicts
    } catch {
      conflicts = [{ path: 'document', local: draft.document, remote: remote.document }]
    }
  }
  const applyMerge = (): void => {
    if (!draft || !remote) return
    try {
      const result = choices['document']
        ? {
            document: choices['document'] === 'local' ? draft.document : remote.document,
            conflicts: [],
          }
        : mergeDocuments(draft.base, draft.document, remote.document, choices)
      if (result.conflicts.length > 0)
        throw new Error('Välj vilken ändring som ska behållas för varje konflikt.')
      draft.rebase(remote, result.document)
      setRemote(null)
      setChoices({})
      changed()
      setError('')
      setNotice('Jämförelsen är klar. Granska utkastet och publicera det uttryckligen.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ändringarna kunde inte förenas.')
    }
  }
  const importDocument = async (value: unknown): Promise<void> => {
    if (!draft || busy || draft.pending) return
    setBusy(true)
    setError('')
    try {
      validateDocument(value)
      const valid = await api.validate(value)
      if (alive.current) {
        draft.replace(valid)
        changed()
        setNotice('Innehållet är inläst som utkast, inte publicerat.')
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : 'Importen avvisades.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const recover = async (entry: BackupEntry): Promise<void> => {
    if (!draft || busy) return
    setBusy(true)
    setError('')
    try {
      const value: DraftBackup = parseBackup(entry.raw, userId)
      await api.validate(value.document)
      if (value.pending) await api.validate(value.pending.document)
      if (alive.current) {
        draft.restore(value)
        setBackups([])
        changed()
        setNotice('Reservutkastet är återställt. Kontrollera innehållet innan publicering.')
      }
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Reservutkastet avvisades. Originalfilen har inte ändrats.',
        )
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const readHistory = async (before?: number): Promise<void> => {
    setBusy(true)
    try {
      const rows = await api.history(before)
      if (alive.current)
        setHistory((current) => (before === undefined ? rows : [...current, ...rows]))
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : 'Historiken kunde inte läsas.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return {
    draft,
    assets,
    setAssets,
    busy,
    error,
    setError,
    notice,
    setNotice,
    backupError,
    backups,
    setBackups,
    key,
    remote,
    setRemote,
    choices,
    setChoices,
    conflicts,
    history,
    load,
    edit,
    publish,
    compareLatest,
    applyMerge,
    importDocument,
    recover,
    readHistory,
    changed,
    api,
  }
}
