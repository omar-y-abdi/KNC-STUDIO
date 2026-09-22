import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { CmsDocument, CmsLang, CmsMode, CmsPage } from '../../../shared/cms'
import { SITE_THEME_DEFAULTS } from '../../../shared/site-theme'
import { LivePreview } from './LivePreview'
import { compactWorkspace } from './useResponsivePanels'

const colors = {
  background: 'Bakgrund',
  surface: 'Ytor',
  text: 'Text',
  muted: 'Sekundär text',
  accent: 'Accent / knappar',
  accentText: 'Text på accent',
  border: 'Kantlinjer',
} as const
const fonts = [
  'Inter Variable, sans-serif',
  'Playfair Display, serif',
  'Arial, sans-serif',
  'Georgia, serif',
  'system-ui, sans-serif',
]

export function ThemePanel({
  document,
  onChange,
  lang,
  fontCss,
  mode,
  onMode: setMode,
}: {
  document: CmsDocument
  onChange: (next: CmsDocument) => void
  lang: CmsLang
  fontCss: string
  mode: CmsMode
  onMode: (mode: CmsMode) => void
}): JSX.Element {
  const [device, setDevice] = useState<'Desktop' | 'Mobile'>(() =>
    compactWorkspace() ? 'Mobile' : 'Desktop',
  )
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  const [path, setPath] = useState('/')
  const page =
    document.presentation.pages.find((page) => page.path === path) ??
    (document.presentation.pages[0] as CmsPage)
  const theme: Record<string, string> = {
    ...SITE_THEME_DEFAULTS[mode],
    ...document.presentation.themes[mode],
  }
  const update = (key: string, value: string): void => {
    const next = structuredClone(document)
    next.presentation.themes[mode][key] = value
    onChange(next)
  }
  return (
    <div class="cms-theme-layout" data-theme-view={mobileView}>
      <div class="cms-theme-mobile-toolbar">
        <div class="cms-segment" role="group" aria-label="Stilverktyg">
          <button
            type="button"
            aria-pressed={mobileView === 'edit'}
            onClick={() => setMobileView('edit')}
          >
            Redigera stil
          </button>
          <button
            type="button"
            aria-pressed={mobileView === 'preview'}
            onClick={() => setMobileView('preview')}
          >
            Förhandsvisa stil
          </button>
        </div>
      </div>
      <section class="cms-theme-controls" aria-label="Webbplatsens stilinställningar">
        <div class="cms-theme-modes" role="group" aria-label="Färgläge att redigera">
          {(['light', 'dark'] as const).map((value) => (
            <button type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
              {value === 'light' ? 'Ljust tema' : 'Mörkt tema'}
            </button>
          ))}
        </div>
        <p>
          Gemensamt för alla sidor och skärmstorlekar. Färger och typsnitt sparas per ljust eller
          mörkt tema. Egna elementstilar har företräde.
        </p>
        <label>
          Typsnitt
          <select
            aria-label="Typsnitt"
            value={theme['fontFamily']}
            onChange={(event) => update('fontFamily', event.currentTarget.value)}
          >
            {fonts.map((font) => (
              <option value={font}>{font.split(',')[0]}</option>
            ))}
            {Object.entries(document.presentation.fonts ?? {}).map(([id, font]) => (
              <option value={`CMSFont-${id}`}>{font.name}</option>
            ))}
          </select>
        </label>
        <h2>Palett</h2>
        {Object.entries(colors).map(([key, label]) => (
          <label class="cms-theme-color">
            {label}
            <span>
              <input
                type="color"
                aria-label={label}
                value={theme[key]}
                onInput={(event) => update(key, event.currentTarget.value)}
              />
              <input
                aria-label={`${label} hex`}
                value={theme[key]}
                maxLength={7}
                onChange={(event) => {
                  if (/^#[0-9a-f]{6}$/i.test(event.currentTarget.value))
                    update(key, event.currentTarget.value)
                  else event.currentTarget.value = theme[key] ?? ''
                }}
              />
            </span>
          </label>
        ))}
        <button
          type="button"
          onClick={() => {
            const next = structuredClone(document)
            next.presentation.themes[mode] = {}
            onChange(next)
          }}
        >
          Återställ {mode === 'light' ? 'ljust' : 'mörkt'} tema
        </button>
      </section>
      <section class="cms-theme-preview" aria-label="Stilförhandsvisning">
        <div class="cms-theme-preview-toolbar">
          <label>
            Sida
            <select
              aria-label="Sida"
              value={page.path}
              onChange={(event) => setPath(event.currentTarget.value)}
            >
              {document.presentation.pages.map((item) => (
                <option value={item.path}>{item.name[lang]}</option>
              ))}
            </select>
          </label>
          <div role="group" aria-label="Skärmstorlek">
            {(['Desktop', 'Mobile'] as const).map((value) => (
              <button
                type="button"
                aria-pressed={device === value}
                onClick={() => setDevice(value)}
              >
                {value === 'Desktop' ? 'Dator' : 'Mobil'}
              </button>
            ))}
          </div>
        </div>
        <div class="cms-theme-preview-frame">
          <LivePreview
            page={page}
            presentation={document.presentation}
            lang={lang}
            mode={mode}
            device={device}
            fontCss={fontCss}
            onNavigate={(path, _lang, mode) => {
              setPath(path)
              setMode(mode)
            }}
          />
        </div>
      </section>
    </div>
  )
}
