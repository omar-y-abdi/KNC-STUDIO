import type { JSX } from 'preact'
import { lazy, Suspense } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { palette } from '../../booking/bookingStyles'
import { buildAdminStyles } from '../adminStyles'
import type { AdminProfile } from '../types'
import { CMS_BUILT_ASSETS } from '../../../shared/cms-built-assets'
import { LEGAL_DEFAULTS } from '../../../shared/cms-legal-defaults'
import { replaceDocumentResource } from '../../../shared/cms-resources'
import {
  EMAIL_NAMES,
  REGION_NAMES,
  isPagePath,
  mediaUrl,
  type CmsDocument,
  type CmsLang,
  type CmsMode,
  type CmsPage,
  type CmsAsset,
  type CmsRegion,
} from '../../../shared/cms'
import { SUPABASE_URL } from '../../backend/config'
import { CmsMarkup } from '../../cms/Markup'
import { NativeCanvas } from './NativeCanvas'
import type { NativeSurface, CanvasNode } from './Preview'
import type { AuthoredControls } from './AuthoredEditor'
import { AssetLibrary } from './Assets'
import { EmailCanvas, EmailInspector, EmailDeliveryPanel } from './Mail'
import { NativeInspector, CopyInspector, BusinessInspector, ThemeInspector } from './Inspector'
import { BarberInspector, GalleryInspector, PageProperties, type PickAsset } from './ContentPanels'
import { Field, Modal, Notice, downloadJson } from './controls'
import { setContent, emailCopy, MAIL_LABELS, newPage } from './catalog'
import { useStudio } from './useStudio'
import { stable } from './draft'
import './studio.css'

const AuthoredEditor = lazy(() =>
  import('./AuthoredEditor').then((module) => ({ default: module.AuthoredEditor })),
)
const BarbersView = lazy(() =>
  import('../views/BarbersView').then((module) => ({ default: module.BarbersView })),
)
type Target =
  | 'home'
  | 'about'
  | 'booking'
  | 'myBookings'
  | 'media'
  | 'copy'
  | 'business'
  | 'theme'
  | 'deliveries'
  | `barber:${string}`
  | `gallery:${'salon' | 'cuts'}`
  | `mail:${(typeof EMAIL_NAMES)[number]}`
  | `page:${string}`
  | `region:${CmsRegion}`
interface Props {
  profile: AdminProfile
  initialLang: CmsLang
  initialMode: CmsMode
}
const NATIVE_LABELS: readonly (readonly [NativeSurface, string])[] = [
  ['home', 'Startsida'],
  ['about', 'Om oss'],
  ['booking', 'Bokning'],
  ['myBookings', 'Kundens bokningar'],
]
const REGIONS: Record<CmsRegion, string> = {
  'home-before': 'Ovanför startsidan',
  'home-after': 'Efter startsidan',
  'about-before': 'Före Om oss',
  'about-after': 'Efter Om oss',
}
function initialTarget(): Target {
  const value = new URLSearchParams(location.search).get('section')
  return value === 'mail'
    ? 'mail:customer_confirmation'
    : value === 'about'
      ? 'about'
      : value === 'profile' || value === 'barbers'
        ? 'about'
        : 'home'
}
export default function Studio({ profile, initialLang, initialMode }: Props): JSX.Element {
  const studio = useStudio(profile.userId)
  const [, navigate] = useLocation()
  const [lang, setLang] = useState<CmsLang>(initialLang),
    [mode, setMode] = useState<CmsMode>(initialMode)
  const [target, setTarget] = useState<Target>(initialTarget),
    [library, setLibrary] = useState('pages'),
    [search, setSearch] = useState('')
  const [inspectorTab, setInspectorTab] = useState<'design' | 'layers' | 'blocks'>('design'),
    [mobilePanel, setMobilePanel] = useState<'library' | 'inspector' | null>(null)
  const [width, setWidth] = useState(1440),
    [zoom, setZoom] = useState(60),
    [locked, setLocked] = useState(false),
    [compare, setCompare] = useState(false)
  const [selected, setSelected] = useState<CanvasNode | null>(null),
    [nodes, setNodes] = useState<CanvasNode[]>([]),
    [selectionRequest, setSelectionRequest] = useState<string | null>(null)
  const [assetPicker, setAssetPicker] = useState<{
    choose: (asset: CmsAsset) => void
    purpose: Parameters<PickAsset>[1]
    barberId: string | undefined
  } | null>(null)
  const [dialog, setDialog] = useState<
    'newPage' | 'history' | 'backup' | 'accounts' | 'pageSettings' | null
  >(null)
  const [pageName, setPageName] = useState(''),
    [pagePath, setPagePath] = useState(''),
    [pageError, setPageError] = useState('')
  const [historyPreview, setHistoryPreview] = useState<CmsDocument | null>(null),
    [historyVersion, setHistoryVersion] = useState<number | null>(null)
  const authored = useRef<AuthoredControls | null>(null),
    importInput = useRef<HTMLInputElement>(null)
  const stateRef = useRef(studio)
  stateRef.current = studio
  const flush = (): void => authored.current?.flush()
  const switchTarget = (value: Target): void => {
    flush()
    setTarget(value)
    setSelected(null)
    setLocked(false)
    setInspectorTab('design')
    setMobilePanel(null)
    setHistoryPreview(null)
    setHistoryVersion(null)
  }
  const chooseLang = (value: CmsLang): void => {
    flush()
    setLang(value)
    setSelected(null)
  }
  const chooseMode = (value: CmsMode): void => {
    flush()
    setMode(value)
  }
  const pick: PickAsset = (choose, purpose = 'library', barberId) => {
    flush()
    setAssetPicker({ choose, purpose, barberId })
  }
  const publish = (): void => {
    flush()
    void studio.publish()
  }
  const undo = (): void => {
    flush()
    studio.draft?.undo()
    studio.changed()
  }
  const redo = (): void => {
    flush()
    studio.draft?.redo()
    studio.changed()
  }
  const shortcut = (key: string, shift = false): void => {
    if (key === 's') publish()
    else if (key === 'z' && !shift) undo()
    else if (key === 'z' || key === 'y') redo()
  }
  const actions = useRef({ shortcut })
  actions.current = { shortcut }
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMobilePanel(null)
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      const textInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      if (
        event.key.toLowerCase() === 's' ||
        (!textInput && ['z', 'y'].includes(event.key.toLowerCase()))
      ) {
        event.preventDefault()
        actions.current.shortcut(event.key.toLowerCase(), event.shiftKey)
      }
    }
    window.document.addEventListener('keydown', key)
    return () => window.document.removeEventListener('keydown', key)
  }, [])
  const leave = (path: string): void => {
    flush()
    if (
      studio.draft &&
      (studio.draft.dirty || studio.draft.pending) &&
      !window.confirm(
        'Det finns opublicerade ändringar. De finns kvar i reservutkastet om lokal lagring fungerar. Lämna studion?',
      )
    )
      return
    navigate(path)
  }
  if (profile.role !== 'owner')
    return <p role="alert">Endast ägaren får öppna redigeringsstudion.</p>
  const draft = studio.draft
  if (!draft)
    return (
      <div class="knc-cms cms-start">
        <h1>Redigering</h1>
        {studio.error ? (
          <>
            <Notice error>{studio.error}</Notice>
            <p>
              Studion kräver CMS-migrationen och Edge-funktionen <code>cms-studio</code>. Se{' '}
              <code>docs/CMS-SETUP.md</code>. Inga bokningar eller befintligt innehåll har ändrats.
            </p>
            <button type="button" disabled={studio.busy} onClick={() => void studio.load()}>
              Försök igen
            </button>
          </>
        ) : (
          <Notice>Läser innehåll och filbibliotek…</Notice>
        )}
        <button type="button" onClick={() => leave('/admin')}>
          Till admin
        </button>
      </div>
    )
  const document = draft.document
  const page = target.startsWith('page:')
    ? document.presentation.pages.find((item) => item.id === target.slice(5))
    : undefined
  const region = target.startsWith('region:') ? (target.slice(7) as CmsRegion) : null
  const variant =
    page?.content[lang] ?? (region ? document.presentation.regions[region]?.[lang] : undefined)
  const mail = target.startsWith('mail:')
    ? emailCopy(document, target.slice(5) as (typeof EMAIL_NAMES)[number], lang)
    : null
  const surface: NativeSurface =
    target === 'booking' || target === 'myBookings'
      ? target
      : target === 'about' || target.startsWith('barber:') || target.startsWith('gallery:')
        ? 'about'
        : 'home'
  const selectNode = (node: CanvasNode): void =>
    setSelected((previous) => (previous && stable(previous) === stable(node) ? previous : node))
  const requestSelection = (id: string): void => {
    setLocked(false)
    setSelectionRequest(`${id}|${crypto.randomUUID()}`)
  }
  const updatePage = (next: CmsPage): void =>
    studio.edit((value) => {
      const index = value.presentation.pages.findIndex((item) => item.id === next.id)
      if (index >= 0) value.presentation.pages[index] = next
    })
  const createPage = (): void => {
    if (
      !pageName.trim() ||
      !isPagePath(pagePath) ||
      document.presentation.pages.some((item) => item.path === pagePath)
    ) {
      setPageError('Ange ett namn och en ledig adress, exempelvis /ny-sida.')
      return
    }
    const value = newPage(pagePath, pageName.trim())
    studio.edit((next) => {
      next.presentation.pages.push(value)
    })
    setDialog(null)
    setPageName('')
    setPagePath('')
    switchTarget(`page:${value.id}`)
  }
  const addLegal = (kind: 'privacy' | 'terms'): void => {
    const existing = document.presentation.pages.find((item) => item.kind === kind)
    if (existing) {
      switchTarget(`page:${existing.id}`)
      return
    }
    const title = kind === 'privacy' ? 'Integritetspolicy' : 'Bokningsvillkor'
    const value = newPage(`/${kind}`, title)
    value.kind = kind
    value.inMenu = false
    value.content = structuredClone(LEGAL_DEFAULTS[kind])
    studio.edit((next) => {
      next.presentation.pages.push(value)
    })
    switchTarget(`page:${value.id}`)
  }
  const openRegion = (name: CmsRegion): void => {
    if (!document.presentation.regions[name])
      studio.edit((next) => {
        next.presentation.regions[name] = {
          sv: { html: '', css: { light: '', dark: '' } },
          en: { html: '', css: { light: '', dark: '' } },
        }
      })
    switchTarget(`region:${name}`)
  }
  const accountManagement = (): void => {
    flush()
    if (draft.dirty || draft.pending) {
      studio.setError(
        'Publicera eller återställ utkastet innan du ändrar konton eller personalens medlemskap.',
      )
      return
    }
    setDialog('accounts')
  }
  const exportDraft = (): void => {
    flush()
    downloadJson(`knc-cms-reservkopia-v${draft.revision}.json`, draft.backup(profile.userId))
  }
  const openHistory = (): void => {
    flush()
    void studio.readHistory()
    setDialog('history')
  }
  const openNewPageDialog = (): void => {
    flush()
    setPageError('')
    setDialog('newPage')
  }
  const importFile = async (file: File): Promise<void> => {
    if (file.size > 8 * 1024 * 1024) {
      studio.setError('Importfilen är för stor.')
      return
    }
    try {
      const raw: unknown = JSON.parse(await file.text())
      if (raw && typeof raw === 'object' && 'document' in raw && 'baseRevision' in raw)
        await studio.importDocument(raw.document)
      else await studio.importDocument(raw)
    } catch (reason) {
      studio.setError(reason instanceof Error ? reason.message : 'Importfilen kunde inte läsas.')
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }
  const restoreHistory = async (): Promise<void> => {
    if (
      !historyPreview ||
      draft.pending ||
      !window.confirm(
        'Läsa in denna version som utkast? Det ändrar inte hemsidan förrän du publicerar.',
      )
    )
      return
    const next = structuredClone(historyPreview)
    const currentIds = new Set(document.barbers.map((item) => item.id))
    const oldIds = new Set(next.barbers.map((item) => item.id))
    next.barbers = [
      ...next.barbers.filter((item) => currentIds.has(item.id)),
      ...document.barbers.filter((item) => !oldIds.has(item.id)),
    ]
    for (const id of Object.keys(next.photos))
      if (!currentIds.has(id)) Reflect.deleteProperty(next.photos, id)
    await studio.importDocument(next)
    setHistoryPreview(null)
    setHistoryVersion(null)
    setCompare(false)
    setDialog(null)
  }
  const nav = (key: Target, label: string): JSX.Element | null =>
    search && !label.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ? null : (
      <button
        type="button"
        class={`cms-nav-item${target === key ? ' is-selected' : ''}`}
        key={key}
        aria-current={target === key ? 'page' : undefined}
        onClick={() => switchTarget(key)}
      >
        {label}
      </button>
    )
  const previewProps = (value: CmsDocument) => ({
    document: value,
    lang,
    mode,
    surface,
    width,
    zoom: compare ? Math.min(zoom, 42) : zoom,
    locked,
    selected: selected?.id ?? null,
    selectionRequest,
    onSelect: selectNode,
    onNodes: (value: CanvasNode[]) =>
      setNodes((previous) => (stable(previous) === stable(value) ? previous : value)),
    onText: (binding: string, value: string) =>
      studio.edit((next) => setContent(next, binding, lang, value), `inline:${binding}:${lang}`),
    onLang: chooseLang,
    onMode: chooseMode,
    onShortcut: shortcut,
    onError: studio.setError,
  })
  const inspected =
    target === 'copy' ? (
      <CopyInspector document={document} lang={lang} edit={studio.edit} />
    ) : target === 'business' ? (
      <BusinessInspector document={document} edit={studio.edit} />
    ) : target === 'theme' ? (
      <ThemeInspector document={document} mode={mode} edit={studio.edit} />
    ) : target.startsWith('barber:') ? (
      <BarberInspector
        id={target.slice(7)}
        document={document}
        lang={lang}
        edit={studio.edit}
        pick={pick}
        manage={accountManagement}
      />
    ) : target.startsWith('gallery:') ? (
      <GalleryInspector
        kind={target.slice(8) as 'salon' | 'cuts'}
        document={document}
        edit={studio.edit}
        pick={pick}
      />
    ) : mail ? (
      <EmailInspector
        email={mail}
        mode={mode}
        pickLogo={(choose) => pick(choose)}
        onChange={(value, group) =>
          studio.edit((next) => {
            const index = next.emails.findIndex(
              (item) => item.template === value.template && item.lang === value.lang,
            )
            if (index < 0) next.emails.push(value)
            else next.emails[index] = value
          }, group)
        }
      />
    ) : (
      <NativeInspector
        document={document}
        node={selected}
        lang={lang}
        mode={mode}
        edit={studio.edit}
        select={requestSelection}
        pickImage={(choose) => pick(choose)}
      />
    )
  return (
    <div
      class="knc-cms"
      data-studio-mode={mode}
      data-library-open={mobilePanel === 'library' ? 'true' : 'false'}
      data-inspector-open={mobilePanel === 'inspector' ? 'true' : 'false'}
    >
      <header class="cms-topbar">
        <div class="cms-return">
          <button type="button" onClick={() => leave('/admin')}>
            ← Admin
          </button>
          <button type="button" onClick={() => leave('/')}>
            Hemsidan ↗
          </button>
        </div>
        <div class="cms-title">
          <strong>BLADE & BLEND</strong>
          <span>Redigering</span>
        </div>
        <div class="cms-top-controls">
          <div class="cms-segment" aria-label="Redigeringsspråk">
            {(['sv', 'en'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={lang === value}
                onClick={() => chooseLang(value)}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
          <div class="cms-segment" aria-label="Förhandsvisningens tema">
            {(['light', 'dark'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={mode === value}
                onClick={() => chooseMode(value)}
              >
                {value === 'light' ? 'Ljust' : 'Mörkt'}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportDraft}>
            Exportera utkast
          </button>
        </div>
      </header>
      {(studio.error || studio.backupError || studio.notice || studio.backups.length > 0) && (
        <div class="cms-messages">
          {studio.error && (
            <Notice error>
              {studio.error}
              <button
                type="button"
                onClick={() => studio.setError('')}
                aria-label="Stäng felmeddelande"
              >
                ×
              </button>
            </Notice>
          )}
          {studio.backupError && (
            <Notice error>
              {studio.backupError}
              <button type="button" onClick={exportDraft}>
                Exportera nu
              </button>
            </Notice>
          )}
          {studio.notice && <Notice>{studio.notice}</Notice>}
          {studio.backups.length > 0 && (
            <Notice>
              Det finns {studio.backups.length} tidigare reservutkast.
              <button type="button" onClick={() => setDialog('backup')}>
                Granska och återställ
              </button>
            </Notice>
          )}
        </div>
      )}
      <div class={`cms-workspace${variant ? ' cms-workspace--authored' : ''}`}>
        {mobilePanel && (
          <button
            type="button"
            class="cms-drawer-backdrop"
            aria-label="Stäng sidopanel"
            onClick={() => setMobilePanel(null)}
          />
        )}
        <aside id="cms-library" class="cms-library" aria-label="Sid- och resursbibliotek">
          <div class="cms-segment">
            {[
              ['pages', 'Sidor'],
              ['resources', 'Resurser'],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={library === key}
                onClick={() => setLibrary(key ?? 'pages')}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            class="cms-search"
            type="search"
            aria-label="Sök i biblioteket"
            placeholder="Sök i biblioteket"
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          {library === 'pages' && (
            <>
              <h2>Webbplats</h2>
              {NATIVE_LABELS.map(([key, label]) => nav(key, label))}
              <button type="button" class="cms-nav-item" onClick={() => addLegal('privacy')}>
                Integritetspolicy
              </button>
              <button type="button" class="cms-nav-item" onClick={() => addLegal('terms')}>
                Bokningsvillkor
              </button>
              {document.presentation.pages
                .filter((item) => item.kind === 'page')
                .map((item) => nav(`page:${item.id}`, item.name[lang] || item.path))}
              <button type="button" class="cms-add" onClick={openNewPageDialog}>
                + Ny sida
              </button>
              <h2>Egna sektioner</h2>
              {REGION_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  class={`cms-nav-item${target === `region:${name}` ? ' is-selected' : ''}`}
                  onClick={() => openRegion(name)}
                >
                  {REGIONS[name]}
                </button>
              ))}
            </>
          )}
          {library === 'resources' && (
            <>
              <h2>Innehåll</h2>
              {nav('media', 'Bilder och typsnitt')}
              {nav('gallery:salon', 'Salongens bildgalleri')}
              {nav('gallery:cuts', 'Klippningarnas bildgalleri')}
              {nav('business', 'Varumärke och kontakt')}
              {nav('copy', 'Alla webbplatstexter')}
              {nav('theme', 'Färger och typsnitt')}
              <button
                type="button"
                class="cms-nav-item"
                onClick={() =>
                  pick(
                    (asset) =>
                      studio.edit((next) => {
                        next.settings['homepage_logo_path'] = asset.path
                      }),
                    'logo',
                  )
                }
              >
                Byt sidans logotyp
              </button>
              <h2>Profiler</h2>
              {document.barbers.map((barber) =>
                nav(`barber:${barber.id}`, barber.name || barber.id),
              )}
              <button type="button" class="cms-nav-item" onClick={accountManagement}>
                Hantera personalens konton
              </button>
              <h2>Mejl</h2>
              {EMAIL_NAMES.map((name) => nav(`mail:${name}`, MAIL_LABELS[name]))}
              {nav('deliveries', 'Misslyckade mejlleveranser')}
            </>
          )}
          <div class="cms-library-bottom">
            <span>Version {draft.revision}</span>
            <button type="button" onClick={openHistory}>
              Historik
            </button>
          </div>
        </aside>
        <main class="cms-canvas-area" aria-label="Redigeringsyta">
          <div class="cms-canvas-toolbar">
            <div class="cms-segment" aria-label="Enhetsbredd">
              {[
                [1440, 'Dator'],
                [768, 'Platta'],
                [390, 'Mobil'],
              ].map(([size, label]) => (
                <button
                  type="button"
                  key={size}
                  aria-pressed={width === size}
                  onClick={() => setWidth(Number(size))}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              Zoom{' '}
              <select
                aria-label="Zoom"
                value={zoom}
                onChange={(event) => setZoom(Number(event.currentTarget.value))}
              >
                {[30, 42, 50, 60, 75, 100, 125].map((value) => (
                  <option key={value} value={value}>
                    {value}%
                  </option>
                ))}
              </select>
            </label>
            {page && (
              <button
                type="button"
                onClick={() => {
                  flush()
                  setDialog('pageSettings')
                }}
              >
                Sidans uppgifter
              </button>
            )}
            {region && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Ta bort den egna sektionen ur utkastet?')) {
                    studio.edit((next) => {
                      Reflect.deleteProperty(next.presentation.regions, region)
                    })
                    switchTarget(region.startsWith('about') ? 'about' : 'home')
                  }
                }}
              >
                Ta bort sektionen
              </button>
            )}
          </div>
          {target === 'media' ? (
            <AssetLibrary
              assets={studio.assets}
              document={document}
              onAssets={studio.setAssets}
              onFont={(asset) => {
                studio.edit((value) => {
                  value.presentation.fonts ??= {}
                  value.presentation.fonts[asset.id] = {
                    ref: { bucket: asset.bucket, path: asset.path },
                    name: asset.name,
                  }
                  value.presentation.themes[mode]['fontFamily'] = `CMSFont-${asset.id}`
                })
                switchTarget('theme')
                studio.setNotice(
                  'Typsnittet är valt i utkastet. Publicera för att använda det på hemsidan.',
                )
              }}
              replace={(previous) =>
                pick((next) => {
                  studio.edit((value) =>
                    replaceDocumentResource(value, previous, next, {
                      siteOrigin: location.origin,
                      storageOrigin: new URL(SUPABASE_URL ?? 'https://unconfigured.invalid').origin,
                      builtAssets: CMS_BUILT_ASSETS,
                    }),
                  )
                  studio.setNotice(
                    'Resursen är ersatt i utkastets referenser. Granska före publicering.',
                  )
                })
              }
            />
          ) : target === 'deliveries' ? (
            <EmailDeliveryPanel />
          ) : mail ? (
            <div class="cms-scroll-canvas">
              <EmailCanvas
                document={document}
                email={mail}
                mode={mode}
                onSelect={(field) => {
                  studio.setNotice(
                    `Vald mejldel: ${field}. Redigera dess text eller utseende i högerpanelen.`,
                  )
                }}
              />
            </div>
          ) : variant ? (
            <Suspense fallback={<Notice>Laddar den visuella sidredigeraren…</Notice>}>
              <AuthoredEditor
                key={`${target}:${lang}`}
                identity={`${target}:${lang}`}
                variant={variant}
                presentation={document.presentation}
                mode={mode}
                width={width}
                zoom={zoom}
                locked={locked}
                onReady={(controls) => {
                  authored.current = controls
                }}
                onError={studio.setError}
                pickImage={() =>
                  pick((asset) => {
                    if (!asset.mime.startsWith('image/')) throw new Error('Välj en bild.')
                    authored.current?.selectImage(mediaUrl(asset, SUPABASE_URL ?? ''), asset.alt)
                  })
                }
                onChange={(next, group) =>
                  studio.edit((value) => {
                    if (page) {
                      const found = value.presentation.pages.find((item) => item.id === page.id)
                      if (found) found.content[lang] = next
                    } else if (region && value.presentation.regions[region]) {
                      const content = value.presentation.regions[region]
                      if (content) content[lang] = next
                    }
                  }, group)
                }
              />
            </Suspense>
          ) : (
            <div class={`cms-scroll-canvas${compare ? ' cms-compare' : ''}`}>
              <div>
                <div class="cms-preview-label">
                  Utkast · {lang.toUpperCase()} · {mode === 'dark' ? 'mörkt' : 'ljust'}
                </div>
                <NativeCanvas {...previewProps(document)} />
              </div>
              {compare && (
                <div>
                  <div class="cms-preview-label">
                    {historyVersion !== null
                      ? `Historik · version ${historyVersion}`
                      : `Senast inläst · version ${draft.revision}`}
                  </div>
                  <NativeCanvas
                    {...previewProps(historyPreview ?? draft.base)}
                    locked
                    onText={() => undefined}
                    onSelect={() => undefined}
                    onNodes={() => undefined}
                  />
                </div>
              )}
            </div>
          )}
        </main>
        {!variant && (
          <aside id="cms-inspector" class="cms-inspector" aria-label="Egenskaper">
            <div class="cms-inspector-tabs" role="tablist" aria-label="Egenskapspanel">
              {[
                ['design', 'Design'],
                ['layers', 'Lager'],
                ['blocks', 'Lägg till'],
              ].map(([key, label]) => (
                <button
                  type="button"
                  role="tab"
                  key={key}
                  aria-selected={inspectorTab === key}
                  onClick={() => setInspectorTab(key as 'design' | 'layers' | 'blocks')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div class="cms-inspector-body">
              {inspectorTab === 'layers' ? (
                <>
                  <h2>Lager</h2>
                  {nodes.length > 0 ? (
                    nodes.map((node) => (
                      <button
                        type="button"
                        class={`cms-layer${selected?.id === node.id ? ' is-selected' : ''}`}
                        key={node.id}
                        onClick={() => requestSelection(node.id)}
                      >
                        <small>{node.tag}</small>
                        <span>{node.label || node.id}</span>
                      </button>
                    ))
                  ) : (
                    <p class="cms-help">Välj en sida för att läsa dess lager.</p>
                  )}
                </>
              ) : inspectorTab === 'blocks' ? (
                <>
                  <h2>Lägg till</h2>
                  <p class="cms-help">
                    Skapa en visuell sida här. På GrapesJS-sidor visas sidblock i samma flik.
                  </p>
                  <button type="button" class="cms-add" onClick={openNewPageDialog}>
                    + Ny sida
                  </button>
                </>
              ) : target === 'media' || target === 'deliveries' ? (
                <>
                  <h2>Resurshantering</h2>
                  <p>
                    Välj en sida, profil eller mejlmall i biblioteket för att återgå till visuell
                    redigering.
                  </p>
                </>
              ) : (
                inspected
              )}
            </div>
          </aside>
        )}
      </div>
      <nav class="cms-mobile-tools" aria-label="Mobilverktyg">
        <button
          type="button"
          class="cms-panel-toggle"
          aria-controls="cms-library"
          aria-expanded={mobilePanel === 'library'}
          onClick={() => setMobilePanel((value) => (value === 'library' ? null : 'library'))}
        >
          Sidor
        </button>
        <button
          type="button"
          class="cms-panel-toggle"
          aria-controls="cms-inspector"
          aria-expanded={mobilePanel === 'inspector'}
          onClick={() => setMobilePanel((value) => (value === 'inspector' ? null : 'inspector'))}
        >
          Egenskaper
        </button>
      </nav>
      <footer class="cms-bottom">
        <div
          class="cms-history-tools cms-commandbar"
          role="toolbar"
          aria-label="Redigeringskommandon"
        >
          <button type="button" disabled={!draft.canUndo} onClick={undo}>
            Ångra
          </button>
          <button type="button" disabled={!draft.canRedo} onClick={redo}>
            Gör om
          </button>
          <span class="cms-command-divider" aria-hidden="true" />
          <button
            type="button"
            aria-pressed={!locked}
            onClick={() => {
              flush()
              setLocked(false)
            }}
          >
            Redigera
          </button>
          <button
            type="button"
            class="cms-primary"
            disabled={studio.busy || (!draft.dirty && !draft.pending)}
            onClick={publish}
          >
            {draft.pending ? 'Bekräfta sparförsöket' : 'Publicera'}
          </button>
          <button
            type="button"
            disabled={!draft.dirty || !!draft.pending || studio.busy}
            onClick={() => {
              flush()
              if (window.confirm('Återställ utkastet till den senast inlästa publiceringen?')) {
                draft.revert()
                studio.changed()
              }
            }}
          >
            Återställ
          </button>
          <span class="cms-command-divider" aria-hidden="true" />
          <button type="button" onClick={openHistory}>
            Historik
          </button>
          <button type="button" onClick={openHistory}>
            Återställ version
          </button>
          <button
            type="button"
            aria-pressed={locked}
            onClick={() => {
              flush()
              setLocked((value) => !value)
            }}
          >
            Lås vy
          </button>
          <span class="cms-command-divider" aria-hidden="true" />
          <button
            type="button"
            aria-pressed={compare}
            disabled={!!variant || !!mail || target === 'media' || target === 'deliveries'}
            onClick={() => {
              flush()
              setCompare((value) => !value)
            }}
          >
            Jämför
          </button>
          <button
            type="button"
            disabled={studio.busy || !!draft.pending}
            onClick={() => void studio.compareLatest()}
          >
            Jämför med servern
          </button>
          <button
            type="button"
            disabled={studio.busy || !!draft.pending}
            onClick={() => importInput.current?.click()}
          >
            Importera
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            class="cms-visually-hidden"
            aria-label="Importera CMS-utkast"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void importFile(file)
            }}
          />
        </div>
        <span role="status" class="cms-draft-status">
          {studio.busy
            ? 'Arbetar…'
            : draft.pending
              ? 'Sparförsöket behöver bekräftas'
              : draft.dirty
                ? 'Opublicerade ändringar'
                : 'Alla ändringar publicerade'}
        </span>
      </footer>
      {dialog === 'newPage' && (
        <Modal title="Skapa ny sida" onClose={() => setDialog(null)}>
          <Field label="Sidans namn" value={pageName} onChange={setPageName} maxLength={80} />
          <Field
            label="Adress, till exempel /vanliga-fragor"
            value={pagePath}
            onChange={setPagePath}
            maxLength={100}
          />
          {pageError && <Notice error>{pageError}</Notice>}
          <button type="button" class="cms-primary" onClick={createPage}>
            Skapa som utkast
          </button>
        </Modal>
      )}
      {dialog === 'pageSettings' && page && (
        <Modal title="Sidans uppgifter" onClose={() => setDialog(null)}>
          <PageProperties
            page={page}
            lang={lang}
            update={updatePage}
            duplicate={() => {
              setPageName(`${page.name[lang]} kopia`)
              setPagePath(`${page.path}-kopia`)
              const copy = structuredClone(page)
              copy.id = crypto.randomUUID()
              let path = `${page.path}-kopia`
              while (document.presentation.pages.some((item) => item.path === path)) path += '-2'
              copy.path = path
              copy.kind = 'page'
              copy.name = { sv: `${page.name.sv} kopia`, en: `${page.name.en} copy` }
              studio.edit((next) => {
                next.presentation.pages.push(copy)
              })
              setDialog(null)
              switchTarget(`page:${copy.id}`)
            }}
            remove={() => {
              if (
                window.confirm(
                  'Ta bort denna sida ur utkastet? Historiken behåller tidigare publicerade versioner.',
                )
              ) {
                studio.edit((next) => {
                  next.presentation.pages = next.presentation.pages.filter(
                    (item) => item.id !== page.id,
                  )
                })
                setDialog(null)
                switchTarget('home')
              }
            }}
          />
        </Modal>
      )}
      {assetPicker && (
        <Modal wide title="Välj fil" onClose={() => setAssetPicker(null)}>
          <AssetLibrary
            assets={studio.assets}
            document={document}
            onAssets={studio.setAssets}
            purpose={assetPicker.purpose ?? 'library'}
            {...(assetPicker.barberId ? { barberId: assetPicker.barberId } : {})}
            choose={(asset) => {
              try {
                assetPicker.choose(asset)
                setAssetPicker(null)
              } catch (reason) {
                studio.setError(
                  reason instanceof Error ? reason.message : 'Filen kan inte användas här.',
                )
              }
            }}
          />
        </Modal>
      )}
      {dialog === 'accounts' && (
        <Modal
          wide
          title="Personal och inloggningskonton"
          onClose={() => {
            setDialog(null)
            void studio.load()
          }}
        >
          <Notice>
            Åtgärder i denna panel sparas direkt genom de befintliga personal- och
            kontofunktionerna. De kan inte ångras som sidredigering.
          </Notice>
          <Suspense fallback={<Notice>Laddar personalhantering…</Notice>}>
            <BarbersView
              lang={lang}
              dark={mode === 'dark'}
              s={buildAdminStyles(palette(mode === 'dark'), mode === 'dark')}
              onRosterChanged={() => void studio.load()}
            />
          </Suspense>
        </Modal>
      )}
      {dialog === 'backup' && (
        <Modal title="Reservutkast" onClose={() => setDialog(null)}>
          {studio.backups.map((entry) => (
            <article class="cms-backup-entry" key={entry.key}>
              <strong>
                {entry.invalid
                  ? 'Utkastet kan inte tolkas automatiskt'
                  : new Date(entry.savedAt).toLocaleString('sv-SE')}
              </strong>
              <div>
                <button
                  type="button"
                  disabled={entry.invalid || studio.busy}
                  onClick={() => void studio.recover(entry).then(() => setDialog(null))}
                >
                  Återställ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([entry.raw], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const link = window.document.createElement('a')
                    link.href = url
                    link.download = 'knc-original-reservutkast.json'
                    link.click()
                    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
                  }}
                >
                  Exportera originalet
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Radera just detta lokala reservutkast?')) {
                      try {
                        localStorage.removeItem(entry.key)
                        studio.setBackups((items) => items.filter((item) => item.key !== entry.key))
                      } catch {
                        studio.setError('Reservutkastet kunde inte raderas.')
                      }
                    }
                  }}
                >
                  Radera reservutkast
                </button>
              </div>
            </article>
          ))}
        </Modal>
      )}
      {dialog === 'history' && (
        <Modal wide title="Publiceringshistorik" onClose={() => setDialog(null)}>
          <p>
            En äldre version läses först som förhandsvisning. Återställning skapar ett utkast; den
            publicerar aldrig automatiskt och återupplivar inte raderade personalkonton.
          </p>
          {studio.history.map((item) => (
            <article class="cms-history-entry" key={item.revision}>
              <strong>Version {item.revision}</strong>
              <span>
                {new Date(item.created_at).toLocaleString('sv-SE')} · {item.summary}
              </span>
              <button
                type="button"
                disabled={studio.busy}
                onClick={() => {
                  void studio.api
                    .revision(item.revision)
                    .then((value) => {
                      setHistoryPreview(value)
                      setHistoryVersion(item.revision)
                    })
                    .catch((reason) =>
                      studio.setError(
                        reason instanceof Error ? reason.message : 'Versionen kunde inte läsas.',
                      ),
                    )
                }}
              >
                Granska
              </button>
            </article>
          ))}
          {studio.history.length >= 30 && (
            <button
              type="button"
              disabled={studio.busy}
              onClick={() =>
                void studio.readHistory(studio.history[studio.history.length - 1]?.revision)
              }
            >
              Äldre versioner
            </button>
          )}
          {historyPreview && (
            <div class="cms-history-preview">
              <h3>Version {historyVersion}</h3>
              <button
                type="button"
                onClick={() => {
                  setCompare(true)
                  setDialog(null)
                  if (variant || mail || target === 'media') setTarget('home')
                }}
              >
                Jämför visuellt
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadJson(`knc-cms-version-${historyVersion}.json`, historyPreview)
                }
              >
                Exportera versionen
              </button>
              <button
                type="button"
                class="cms-primary"
                disabled={studio.busy || !!draft.pending}
                onClick={() => void restoreHistory()}
              >
                Läs in som utkast
              </button>
              <pre>
                {JSON.stringify(
                  {
                    sidor: historyPreview.presentation.pages.map((item) => item.path),
                    profiler: historyPreview.barbers.map((item) => item.name),
                    bilder: historyPreview.gallery.length,
                    mejlmallar: historyPreview.emails.length,
                  },
                  null,
                  2,
                )}
              </pre>
              {page && historyPreview.presentation.pages.some((item) => item.id === page.id) && (
                <CmsMarkup
                  html={
                    historyPreview.presentation.pages.find((item) => item.id === page.id)?.content[
                      lang
                    ].html ?? ''
                  }
                  css={
                    historyPreview.presentation.pages.find((item) => item.id === page.id)?.content[
                      lang
                    ].css[mode] ?? ''
                  }
                />
              )}
            </div>
          )}
        </Modal>
      )}
      {studio.remote && (
        <Modal
          wide
          title="Jämför med serverns senaste innehåll"
          onClose={() => studio.setRemote(null)}
        >
          <p>
            Serverversion {studio.remote.revision}. Oberoende ändringar förenas. Välj uttryckligen
            för överlappande ändringar; inget skrivs över på servern nu.
          </p>
          {studio.conflicts.length === 0 && (
            <Notice>Inga olösta konflikter. Du kan förena ändringarna i utkastet.</Notice>
          )}
          {studio.conflicts.map((conflict) => (
            <article class="cms-conflict" key={conflict.path}>
              <h3>{conflict.path}</h3>
              <div>
                <section>
                  <strong>Ditt utkast</strong>
                  <pre>{JSON.stringify(conflict.local, null, 2)}</pre>
                  <button
                    type="button"
                    onClick={() =>
                      studio.setChoices((value) => ({ ...value, [conflict.path]: 'local' }))
                    }
                  >
                    Behåll mitt
                  </button>
                </section>
                <section>
                  <strong>Serverns version</strong>
                  <pre>{JSON.stringify(conflict.remote, null, 2)}</pre>
                  <button
                    type="button"
                    onClick={() =>
                      studio.setChoices((value) => ({ ...value, [conflict.path]: 'remote' }))
                    }
                  >
                    Behåll serverns
                  </button>
                </section>
              </div>
            </article>
          ))}
          <button
            type="button"
            class="cms-primary"
            disabled={studio.conflicts.length > 0}
            onClick={studio.applyMerge}
          >
            Förena som utkast
          </button>
        </Modal>
      )}
    </div>
  )
}
