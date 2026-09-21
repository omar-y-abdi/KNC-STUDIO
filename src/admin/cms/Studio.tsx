import type { JSX } from 'preact'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import {
  mediaUrl,
  type CmsAsset,
  type CmsDocument,
  type CmsLang,
  type CmsMode,
  type CmsPage,
  type CmsRevision,
  type CmsState,
} from '../../../shared/cms'
import { ensureCorePages, prepareCorePageSource, isInventedSite, CORE_PAGE_IDS } from './corePages'
import { CmsDraft, mergeCmsDocuments } from './draft'
import { cmsApi } from './api'
import { CmsEditor, type EditorHandle } from './Editor'
import { CmsModal } from './Modal'
import { CmsResources } from './Resources'
import { BusinessPanel, EmailPanel } from './DomainPanels'
import { clearBackup, loadBackup, saveBackup } from './backup'
import { SUPABASE_URL } from '../../backend/config'
import './studio.css'

const protectedIds = new Set<string>(CORE_PAGE_IDS)

type Panel = 'library' | 'inspector' | null

export function CmsStudio({ onExit }: { onExit: () => void }): JSX.Element {
  const [draft, setDraft] = useState<CmsDraft | null>(null)
  const [selectedPage, setSelectedPage] = useState<string>(CORE_PAGE_IDS[0])
  const [lang, setLang] = useState<CmsLang>('sv')
  const [mode, setMode] = useState<CmsMode>('light')
  const [device, setDevice] = useState<'Desktop' | 'Mobile'>('Desktop')
  const [zoom, setZoom] = useState(80)
  const [compare, setCompare] = useState(false)
  const [locked, setLocked] = useState(false)
  const [tab, setTab] = useState<'design' | 'layers' | 'blocks'>('design')
  const [mobilePanel, setMobilePanel] = useState<Panel>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<{ remote: CmsState; base: CmsDocument | null } | null>(
    null,
  )
  const [, setVersion] = useState(0)
  const [dialog, setDialog] = useState<
    'history' | 'resources' | 'business' | 'email' | 'delivery' | null
  >(null)
  const [history, setHistory] = useState<CmsRevision[]>([])
  const [resources, setResources] = useState<CmsAsset[]>([])
  const [newName, setNewName] = useState('Ny sida')
  const [newPath, setNewPath] = useState('/hemsida')
  const editor = useRef<EditorHandle | null>(null)

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const loaded = await cmsApi.state()
      await prepareCorePageSource()
      const document = ensureCorePages(loaded.document)
      const seeded = JSON.stringify(document) !== JSON.stringify(loaded.document)
      const backup = loadBackup()
      const next = new CmsDraft(document, loaded.revision, loaded.fingerprint)
      setConflict(null)
      if (seeded) next.base = structuredClone(loaded.document)
      if (backup && isInventedSite(backup.document)) {
        localStorage.setItem('knc-cms-retained-template-draft', JSON.stringify(backup))
        setError('Det äldre mallutkastet har bevarats lokalt men används inte som din webbplats.')
      }
      if (
        backup &&
        !isInventedSite(backup.document) &&
        JSON.stringify(backup.document) !== JSON.stringify(document)
      ) {
        const local = ensureCorePages(backup.document)
        const sameHead =
          backup.revision === loaded.revision && backup.fingerprint === loaded.fingerprint
        const merged =
          !sameHead && backup.base
            ? mergeCmsDocuments(backup.base, local, document)
            : { document: local, conflicts: sameHead ? [] : [{ path: '' }] }
        next.change(merged.document)
        if (merged.conflicts.length) {
          next.base = structuredClone(backup.base ?? loaded.document)
          next.revision = backup.revision ?? -1
          next.fingerprint = backup.fingerprint ?? ''
          setConflict({ remote: loaded, base: backup.base ?? null })
          setError(
            'Det lokala utkastet och servern har olika ändringar. Välj hur konflikten ska lösas före publicering.',
          )
        } else {
          setError(
            `Ett lokalt utkast från ${new Date(backup.savedAt).toLocaleString('sv-SE')} återställdes.`,
          )
        }
      }
      setDraft(next)
      if (seeded && !backup)
        setError(
          'Originalwebbplatsen har lästs in som ett opublicerat utkast. Granska före publicering.',
        )
      setResources(loaded.assets)
      setVersion((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Studion kunde inte öppnas.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  useLayoutEffect(() => {
    if (!draft) return
    try {
      if (draft.dirty || conflict)
        saveBackup(
          draft.document,
          draft.revision,
          draft.fingerprint,
          conflict ? (conflict.base ?? undefined) : draft.base,
        )
      else clearBackup()
    } catch {
      setError(
        'Lokal backup kunde inte sparas. Utkastet finns i studion; exportera innan du lämnar.',
      )
    }
  }, [draft?.document, draft?.revision, draft?.fingerprint, conflict])

  const commitDraft = (next: CmsDocument, group = ''): void => {
    if (!draft) return
    draft.change(next, group)
    setVersion((value) => value + 1)
  }
  const replacePage = (page: CmsPage): void => {
    if (!draft) return
    const next = structuredClone(draft.document)
    const index = next.presentation.pages.findIndex((item) => item.id === page.id)
    if (index >= 0) next.presentation.pages[index] = page
    commitDraft(next, `page:${page.id}:${lang}:${mode}`)
  }
  const publish = async (): Promise<void> => {
    if (!draft || conflict || busy) return
    editor.current?.flush()
    setBusy(true)
    setError(null)
    try {
      const request = draft.beginSave()
      const checked = await cmsApi.validate(request.document)
      const result = await cmsApi.publish(
        checked.document,
        request.baseRevision,
        request.baseFingerprint,
        request.requestId,
      )
      editor.current?.flush()
      draft.acknowledge(result.document, result.revision, result.fingerprint)
      setVersion((value) => value + 1)
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : 'Publiceringen misslyckades. Utkastet finns kvar.'
      if (reason instanceof FunctionsHttpError && reason.context.status === 409) {
        try {
          const remote = await cmsApi.state()
          editor.current?.flush()
          const merged = mergeCmsDocuments(
            draft.base,
            draft.document,
            ensureCorePages(remote.document),
          )
          const next = new CmsDraft(merged.document, remote.revision, remote.fingerprint)
          next.base = structuredClone(remote.document)
          if (merged.conflicts.length) {
            next.base = structuredClone(draft.base)
            next.revision = draft.revision
            next.fingerprint = draft.fingerprint
            setConflict({ remote, base: draft.base })
          }
          setDraft(next)
          setVersion((value) => value + 1)
          setError(
            merged.conflicts.length
              ? `Konflikt. Oberoende ändringar slogs ihop; ${merged.conflicts.length} område(n) kräver kontroll före ny publicering.`
              : 'Servern hade nya ändringar. De slogs ihop med ditt utkast; granska och publicera igen.',
          )
        } catch {
          setError(message)
        }
      } else setError(message)
    } finally {
      setBusy(false)
    }
  }
  const resolveConflict = (resolution: 'local' | 'remote'): void => {
    if (!draft || !conflict) return
    editor.current?.flush()
    const remote = ensureCorePages(conflict.remote.document)
    const resolved = conflict.base
      ? mergeCmsDocuments(conflict.base, draft.document, remote, resolution).document
      : resolution === 'local'
        ? draft.document
        : remote
    const next = new CmsDraft(
      conflict.remote.document,
      conflict.remote.revision,
      conflict.remote.fingerprint,
    )
    next.change(resolved)
    setDraft(next)
    setConflict(null)
    setError('Konflikten är löst i utkastet. Granska före publicering.')
    setVersion((value) => value + 1)
  }
  const openHistory = async (): Promise<void> => {
    editor.current?.flush()
    setBusy(true)
    setError(null)
    try {
      setHistory(await cmsApi.history())
      setDialog('history')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Historiken kunde inte läsas.')
    } finally {
      setBusy(false)
    }
  }

  if (!draft)
    return (
      <div class="knc-cms-studio">
        <div class="cms-notice">{error ?? 'Laddar Studio…'}</div>
      </div>
    )
  const document = draft.document
  const page =
    document.presentation.pages.find((item) => item.id === selectedPage) ??
    document.presentation.pages[0]
  if (!page) throw new Error('CMS project has no pages')
  const fontCss = Object.entries(document.presentation.fonts ?? {})
    .map(
      ([id, font]) =>
        `@font-face{font-family:"CMSFont-${id}";src:url("${mediaUrl(font.ref, SUPABASE_URL ?? '')}") format("woff2");font-display:swap}`,
    )
    .join('\n')

  const importDraft = async (file: File): Promise<void> => {
    try {
      editor.current?.flush()
      const parsed = JSON.parse(await file.text()) as unknown
      const checked = await cmsApi.validate(parsed as CmsDocument)
      const next = ensureCorePages(checked.document)
      commitDraft(next)
      setSelectedPage(next.presentation.pages[0]?.id ?? CORE_PAGE_IDS[0])
      setError('JSON-utkastet importerades och är ännu inte publicerat.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'JSON-utkastet kunde inte importeras.')
    }
  }

  const createPage = (): void => {
    editor.current?.flush()
    const path = newPath.trim().replace(/\/+$/, '') || '/hemsida'
    if (
      !/^\/[a-z0-9][a-z0-9/_-]*$/i.test(path) ||
      /^\/(?:admin|api|auth|login|reset|invite|assets|icons|fonts|storage|cms-media|cms-public|google-calendar|cdn-cgi)(?:\/|$)/i.test(
        path,
      ) ||
      draft.document.presentation.pages.some((item) => item.path === path)
    )
      return setError('Ange en unik, giltig adress som /hemsida.')
    const id = crypto.randomUUID()
    const created: CmsPage = {
      id,
      kind: 'page',
      path,
      inMenu: true,
      name: { sv: newName.trim() || 'Ny sida', en: newName.trim() || 'New page' },
      title: { sv: newName.trim() || 'Ny sida', en: newName.trim() || 'New page' },
      description: { sv: '', en: '' },
      content: {
        sv: {
          html: '<main style="padding:64px 32px"><h1>Ny sida</h1><p>Börja bygga här.</p></main>',
          css: { light: '', dark: '' },
        },
        en: {
          html: '<main style="padding:64px 32px"><h1>New page</h1><p>Start building here.</p></main>',
          css: { light: '', dark: '' },
        },
      },
    }
    const next = structuredClone(draft.document)
    next.presentation.pages.push(created)
    commitDraft(next)
    setSelectedPage(id)
    setNewName('Ny sida')
    setNewPath('/hemsida')
  }
  const editMeta = (key: 'name' | 'title' | 'description', value: string): void => {
    const next = structuredClone(page)
    next[key][lang] = value
    replacePage(next)
  }

  return (
    <div
      class="knc-cms-studio"
      data-mode={mode}
      data-library-open={mobilePanel === 'library'}
      data-inspector-open={mobilePanel === 'inspector'}
    >
      <header class="cms-topbar">
        <button
          type="button"
          onClick={() => {
            editor.current?.flush()
            onExit()
          }}
        >
          ← Admin
        </button>
        <a href="/" target="_blank" rel="noreferrer">
          BLADE & BLEND · STUDIO
        </a>
        <div class="cms-topbar-spacer" />
        <div class="cms-segment" aria-label="Språk">
          {(['sv', 'en'] as const).map((value) => (
            <button
              type="button"
              aria-pressed={lang === value}
              onClick={() => {
                editor.current?.flush()
                setLang(value)
              }}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
        <div class="cms-segment" aria-label="Tema">
          {(['light', 'dark'] as const).map((value) => (
            <button
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                editor.current?.flush()
                setMode(value)
              }}
            >
              {value === 'light' ? 'Ljus' : 'Mörk'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.focus()
            editor.current?.flush()
            setDialog('resources')
          }}
        >
          Resurser
        </button>
      </header>
      {error && (
        <div class="cms-notice" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setError(null)}>
            Stäng
          </button>
        </div>
      )}
      {conflict && (
        <div class="cms-notice" role="alert">
          Publicering är blockerad tills konflikten är löst.
          <button type="button" onClick={() => resolveConflict('local')}>
            Behåll mina konfliktändringar
          </button>
          <button type="button" onClick={() => resolveConflict('remote')}>
            Använd serverns konfliktändringar
          </button>
        </div>
      )}
      <div class="cms-workspace">
        <aside id="cms-library" class="cms-library">
          <h2>Sidor</h2>
          {document.presentation.pages.map((item) => (
            <button
              type="button"
              class={item.id === page.id ? 'is-active' : ''}
              onClick={() => {
                editor.current?.flush()
                setSelectedPage(item.id)
                setMobilePanel(null)
              }}
            >
              {item.name[lang] || item.path}
            </button>
          ))}
          <div class="cms-page-meta">
            <label>
              Namn
              <input
                value={page.name[lang]}
                onInput={(e) => editMeta('name', e.currentTarget.value)}
              />
            </label>
            <label>
              Adress
              <input value={page.path} disabled />
            </label>
            <label>
              Titel / SEO
              <input
                value={page.title[lang]}
                onInput={(e) => editMeta('title', e.currentTarget.value)}
              />
            </label>
            <label>
              Beskrivning
              <input
                value={page.description[lang]}
                onInput={(e) => editMeta('description', e.currentTarget.value)}
              />
            </label>
            <label>
              <span>
                <input
                  type="checkbox"
                  checked={page.inMenu}
                  onChange={(e) => {
                    const next = structuredClone(page)
                    next.inMenu = e.currentTarget.checked
                    replacePage(next)
                  }}
                />{' '}
                Visa i meny
              </span>
            </label>
            {!protectedIds.has(page.id) && (
              <div class="cms-actions-row">
                <button
                  type="button"
                  onClick={() => {
                    editor.current?.flush()
                    const current = draft.document.presentation.pages.find(
                      (item) => item.id === page.id,
                    )
                    if (!current) return
                    const copy = structuredClone(current)
                    copy.id = crypto.randomUUID()
                    copy.path = `${page.path}-kopia`
                    while (
                      draft.document.presentation.pages.some((item) => item.path === copy.path)
                    )
                      copy.path += '-kopia'
                    copy.name = { sv: `${page.name.sv} kopia`, en: `${page.name.en} copy` }
                    const next = structuredClone(draft.document)
                    next.presentation.pages.push(copy)
                    commitDraft(next)
                    setSelectedPage(copy.id)
                  }}
                >
                  Duplicera
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.current?.flush()
                    const next = structuredClone(draft.document)
                    next.presentation.pages = next.presentation.pages.filter(
                      (item) => item.id !== page.id,
                    )
                    commitDraft(next)
                    setSelectedPage(CORE_PAGE_IDS[0])
                  }}
                >
                  Ta bort
                </button>
              </div>
            )}
          </div>
          <h2>Ny sida</h2>
          <div class="cms-page-meta">
            <label>
              Namn
              <input value={newName} onInput={(e) => setNewName(e.currentTarget.value)} />
            </label>
            <label>
              Adress
              <input value={newPath} onInput={(e) => setNewPath(e.currentTarget.value)} />
            </label>
            <button type="button" onClick={createPage}>
              + Skapa sida
            </button>
          </div>
          <h2>Resurser</h2>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus()
              editor.current?.flush()
              setDialog('resources')
            }}
          >
            Bilder & typsnitt · {resources.length}
          </button>
          <h2>KNC</h2>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus()
              editor.current?.flush()
              setDialog('business')
            }}
          >
            Business / SEO
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus()
              editor.current?.flush()
              setDialog('email')
            }}
          >
            Mejl
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus()
              editor.current?.flush()
              setDialog('delivery')
            }}
          >
            Leveransstatus ↗
          </button>
        </aside>
        <main class="cms-canvas-shell">
          <div class="cms-canvas-toolbar">
            <div class="cms-segment">
              {(['Desktop', 'Mobile'] as const).map((value) => (
                <button
                  type="button"
                  aria-pressed={device === value}
                  onClick={() => setDevice(value)}
                >
                  {value === 'Desktop' ? '1440' : '390'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setZoom(Math.max(30, zoom - 10))}>
              −
            </button>
            <span>{zoom}%</span>
            <button type="button" onClick={() => setZoom(Math.min(120, zoom + 10))}>
              +
            </button>
            <button
              type="button"
              onClick={() => {
                const nextZoom = editor.current?.fit()
                if (nextZoom !== undefined) setZoom(nextZoom)
              }}
            >
              Fit
            </button>
            <button
              type="button"
              aria-pressed={compare}
              onClick={() => {
                editor.current?.flush()
                setCompare((value) => !value)
              }}
            >
              Jämför
            </button>
          </div>
          <div class="cms-editor-wrap">
            <CmsEditor
              page={page}
              lang={lang}
              mode={mode}
              device={device}
              compare={compare}
              zoom={zoom}
              locked={locked}
              assets={resources}
              fontCss={fontCss}
              tab={tab}
              onTab={setTab}
              onZoom={setZoom}
              onChange={replacePage}
              onReady={(value) => {
                editor.current = value
              }}
              onError={setError}
            />
          </div>
        </main>
        <button
          type="button"
          class="cms-backdrop"
          aria-label="Stäng panel"
          onClick={() => setMobilePanel(null)}
        />
      </div>
      <nav class="cms-mobile-tools" aria-label="Mobilverktyg">
        <button
          type="button"
          onClick={() => setMobilePanel((value) => (value === 'library' ? null : 'library'))}
        >
          Sidor
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel((value) => (value === 'inspector' ? null : 'inspector'))}
        >
          Egenskaper
        </button>
      </nav>
      <footer class="cms-bottom">
        <button
          type="button"
          onClick={() => {
            editor.current?.flush()
            if (draft.undo()) setVersion((v) => v + 1)
          }}
        >
          Ångra
        </button>
        <button
          type="button"
          onClick={() => {
            editor.current?.flush()
            if (draft.redo()) setVersion((v) => v + 1)
          }}
        >
          Gör om
        </button>
        <button
          type="button"
          class="cms-publish"
          disabled={busy || Boolean(conflict) || !draft.dirty}
          onClick={() => void publish()}
        >
          Save / Publicera
        </button>
        <button
          type="button"
          disabled={!draft.dirty}
          onClick={() => {
            editor.current?.flush()
            if (conflict) {
              const next = new CmsDraft(
                conflict.remote.document,
                conflict.remote.revision,
                conflict.remote.fingerprint,
              )
              setDraft(next)
              setConflict(null)
            } else draft.revert()
            setVersion((v) => v + 1)
          }}
        >
          Revert
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.focus()
            void openHistory()
          }}
        >
          History
        </button>
        <button
          type="button"
          aria-pressed={locked}
          onClick={() => {
            editor.current?.flush()
            setLocked((value) => !value)
          }}
        >
          {locked ? 'Lås upp' : 'Lås vy'}
        </button>
        <button
          type="button"
          onClick={() => {
            editor.current?.flush()
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(draft.document, null, 2)], { type: 'application/json' }),
            )
            const link = window.document.createElement('a')
            link.href = url
            link.download = 'knc-cms-draft.json'
            link.click()
            window.setTimeout(() => URL.revokeObjectURL(url), 500)
          }}
        >
          Export
        </button>
        <label class="cms-import-button">
          Import
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void importDraft(file)
              event.currentTarget.value = ''
            }}
          />
        </label>
        <span class="cms-status">
          {busy
            ? 'Arbetar…'
            : draft.dirty
              ? 'Opublicerade ändringar'
              : `Publicerad · rev ${draft.revision}`}
        </span>
      </footer>
      {dialog && (
        <CmsModal
          wide={dialog === 'email'}
          onClose={() => setDialog(null)}
          title={
            dialog === 'history'
              ? 'Historik'
              : dialog === 'resources'
                ? 'Resurser'
                : dialog === 'business'
                  ? 'Business / SEO'
                  : dialog === 'delivery'
                    ? 'Leveransstatus'
                    : 'Mejl'
          }
          footer={
            <>
              <span>
                Ändringar i sidinnehåll publiceras med Save / Publicera när panelen stängts.
              </span>
              <button type="button" onClick={() => setDialog(null)}>
                Klar
              </button>
            </>
          }
        >
          {error && (
            <div class="cms-notice" role="alert">
              {error}
              <button type="button" onClick={() => setError(null)}>
                Stäng meddelande
              </button>
            </div>
          )}
          {dialog === 'delivery' ? (
            <div class="cms-domain-panel">
              <h2>Operativ e-postleverans</h2>
              <p>
                Leveransstatus och återförsök är operativ data och ligger därför utanför reversibel
                CMS-historik.
              </p>
              <a href="/admin?tab=operations" class="cms-external-link">
                Öppna leveranspanelen i Admin ↗
              </a>
            </div>
          ) : dialog === 'business' ? (
            <BusinessPanel document={draft.document} onChange={(next) => commitDraft(next)} />
          ) : dialog === 'email' ? (
            <EmailPanel
              document={draft.document}
              lang={lang}
              onChange={(next) => commitDraft(next)}
            />
          ) : dialog === 'history' ? (
            history.map((item) => (
              <div class="cms-history-row">
                <strong>v{item.revision}</strong>
                <span>
                  {new Date(item.created_at).toLocaleString('sv-SE')} · {item.summary}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void cmsApi
                      .revision(item.revision)
                      .then((old) => {
                        commitDraft(ensureCorePages(old.document))
                        setDialog(null)
                      })
                      .catch((reason) =>
                        setError(
                          reason instanceof Error ? reason.message : 'Versionen kunde inte läsas.',
                        ),
                      )
                  }
                >
                  Återställ till utkast
                </button>
              </div>
            ))
          ) : (
            <CmsResources
              assets={resources}
              document={draft.document}
              onAssets={setResources}
              onDocument={(next) => commitDraft(next)}
              onError={setError}
            />
          )}
        </CmsModal>
      )}
    </div>
  )
}
