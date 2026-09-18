import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import grapesjs, { type Component, type Editor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import type { CmsAsset, CmsLang, CmsMode, CmsPage } from '../../../shared/cms'
import { mediaUrl } from '../../../shared/cms'
import { SUPABASE_URL } from '../../backend/config'
import { configureComponent, isProtected, styleSectors } from './editorPolicy'
import { nudgeStyle, resetNudgeStyle } from './position'
import { cloneComponent } from './clone'
import { captureViewState, restoreViewState, type CmsViewState } from './viewState'

export interface EditorHandle {
  undo: () => void
  redo: () => void
  flush: () => void
}

interface Props {
  page: CmsPage
  lang: CmsLang
  mode: CmsMode
  device: 'Desktop' | 'Mobile'
  compare: boolean
  zoom: number
  locked: boolean
  assets: CmsAsset[]
  fontCss: string
  tab: 'design' | 'layers' | 'blocks'
  onTab: (tab: 'design' | 'layers' | 'blocks') => void
  onChange: (page: CmsPage) => void
  onReady: (handle: EditorHandle | null) => void
  onError: (message: string) => void
}

function fontFamilyOptions(assets: CmsAsset[]): Array<{ id: string; label: string }> {
  return [
    { id: "'Inter Variable',Inter,system-ui,sans-serif", label: 'Inter' },
    { id: "'Playfair Display',Georgia,serif", label: 'Playfair Display' },
    ...assets
      .filter((asset) => asset.mime === 'font/woff2' && !asset.archived)
      .map((asset) => ({ id: `CMSFont-${asset.id}`, label: asset.name })),
  ]
}

const blocks = [
  [
    'section',
    'Sektion',
    '<section style="padding:48px 32px;min-height:160px"><h2>Ny sektion</h2><p>Skriv innehållet här.</p></section>',
  ],
  ['container', 'Behållare', '<div style="padding:24px;min-height:100px"></div>'],
  [
    'columns',
    'Två kolumner',
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:24px"><div><h2>Kolumn ett</h2></div><div><p>Kolumn två</p></div></div>',
  ],
  ['heading', 'Rubrik', '<h2>Ny rubrik</h2>'],
  ['text', 'Text', '<p>Skriv texten här.</p>'],
  ['image', 'Bild', { type: 'image', attributes: { src: '/og-image.png', alt: '' } }],
  [
    'link',
    'Knapp / länk',
    '<a href="/booking" style="display:inline-block;padding:14px 20px;border:1px solid currentColor;border-radius:999px">Boka tid</a>',
  ],
  ['divider', 'Avdelare', '<hr style="border:0;border-top:1px solid currentColor;margin:32px 0">'],
] as const

function label(component: Component | null): string {
  if (!component) return 'Inget valt'
  const tag = String(component.get('tagName') ?? 'div').toUpperCase()
  const id = String(component.getAttributes()['id'] ?? '')
  return `${tag}${id ? ` · #${id}` : ''}`
}

export function CmsEditor(props: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<Editor | null>(null)
  const latest = useRef(props)
  latest.current = props
  const applying = useRef(false)
  const timer = useRef<number | null>(null)
  const [selected, setSelected] = useState<Component | null>(null)
  const [advancedProperty, setAdvancedProperty] = useState('')
  const [advancedValue, setAdvancedValue] = useState('')
  const viewStates = useRef(new Map<string, CmsViewState>())

  useEffect(() => {
    if (!host.current) return
    const editor = grapesjs.init({
      container: host.current,
      height: '100%',
      width: '100%',
      fromElement: false,
      telemetry: false,
      noticeOnUnload: false,
      storageManager: false,
      panels: { defaults: [] },
      avoidInlineStyle: true,
      parser: {
        optionsHtml: { allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false },
      },
      canvas: {
        scripts: [],
        styles: ['/fonts.css'],
        frameContent: '<!doctype html><html lang="sv"><head></head><body></body></html>',
      },
      canvasCss: 'html{scroll-behavior:auto!important}body{margin:0!important}',
      selectorManager: { componentFirst: true },
      layerManager: { appendTo: '#cms-layers' },
      traitManager: { appendTo: '#cms-traits' },
      styleManager: {
        appendTo: '#cms-styles',
        sectors: styleSectors.map((sector) =>
          sector.id !== 'typography'
            ? sector
            : {
                ...sector,
                buildProps: sector.buildProps.filter((property) => property !== 'font-family'),
                properties: [
                  {
                    property: 'font-family',
                    type: 'select',
                    options: fontFamilyOptions(latest.current.assets),
                  },
                ],
              },
        ),
      },
      blockManager: { appendTo: '#cms-blocks', appendOnClick: true },
      deviceManager: {
        devices: [
          { id: 'Desktop', name: 'Desktop', width: '1440px' },
          { id: 'Mobile', name: 'Mobile', width: '390px', widthMedia: '768px' },
        ],
      },
      assetManager: {
        assets: latest.current.assets
          .filter((asset) => asset.mime.startsWith('image/') && !asset.archived)
          .map((asset) => ({ src: mediaUrl(asset, SUPABASE_URL ?? ''), name: asset.name })),
        upload: false,
      },
    })
    instance.current = editor
    for (const [id, blockLabel, content] of blocks)
      editor.BlockManager.add(id, { label: blockLabel, content })

    const configure = (component: Component): void => {
      configureComponent(component)
      component.components().forEach(configure)
    }
    editor.on('component:create', configureComponent)
    editor.on('component:selected', (component: Component) => setSelected(component))
    editor.on('component:deselected', () => setSelected(editor.getSelected() ?? null))
    const remember = (): void => {
      const current = latest.current
      viewStates.current.set(
        current.page.id,
        captureViewState(editor, current.page.id, current.device, current.zoom),
      )
    }
    editor.on('component:selected', remember)
    editor.on('canvas:scroll', remember)

    const flush = (): void => {
      if (applying.current) return
      const current = latest.current
      const next = structuredClone(current.page)
      const authoredCss = editor.getCss({ keepUnusedStyles: true }) ?? ''
      next.content[current.lang] = {
        html: editor.getHtml({ cleanId: false }),
        css: {
          ...next.content[current.lang].css,
          [current.mode]: authoredCss.startsWith(current.fontCss)
            ? authoredCss.slice(current.fontCss.length).trimStart()
            : authoredCss,
        },
      }
      current.onChange(next)
      editor.clearDirtyCount()
    }
    const schedule = (): void => {
      if (applying.current) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 180)
    }
    editor.on('update', schedule)
    editor.on('load', () => editor.clearDirtyCount())
    props.onReady({
      undo: () => editor.UndoManager.undo(),
      redo: () => editor.UndoManager.redo(),
      flush,
    })

    applying.current = true
    editor.setStyle(`${props.fontCss}\n${props.page.content[props.lang].css[props.mode]}`)
    editor.setComponents(props.page.content[props.lang].html)
    editor.getWrapper()?.components().forEach(configure)
    applying.current = false
    editor.clearDirtyCount()

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      props.onReady(null)
      editor.destroy()
      instance.current = null
    }
  }, [])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    const previousState = viewStates.current.get(props.page.id)
    applying.current = true
    editor.setStyle(`${props.fontCss}\n${props.page.content[props.lang].css[props.mode]}`)
    editor.setComponents(props.page.content[props.lang].html)
    editor
      .getWrapper()
      ?.components()
      .forEach((component: Component) => configureComponent(component))
    applying.current = false
    editor.clearDirtyCount()
    if (previousState) restoreViewState(editor, previousState)
  }, [props.page.id, props.lang, props.mode])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    editor.setDevice(props.device)
    editor.Canvas.setZoom(props.zoom)
  }, [props.device, props.zoom])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    if (props.locked) editor.runCommand('preview')
    else editor.stopCommand('preview')
  }, [props.locked])

  const mutateSelected = (fn: (component: Component) => void): void => {
    const component = instance.current?.getSelected()
    if (!component) return props.onError('Välj ett element först.')
    fn(component)
  }
  const nudge = (dx: number, dy: number, step: number): void =>
    mutateSelected((component) =>
      component.setStyle(nudgeStyle(component.getStyle(), dx, dy, step)),
    )
  const duplicate = (): void =>
    mutateSelected((component) => {
      if (isProtected(component) || component.get('copyable') === false)
        return props.onError('Det valda funktionsblocket kan inte dupliceras.')
      const copy = cloneComponent(component)
      component.parent()?.append(copy, { at: component.index() + 1 })
      instance.current?.select(copy)
    })

  const attributes = selected?.getAttributes() ?? {}
  const tag = String(selected?.get('tagName') ?? '').toLowerCase()
  const textLike = selected && ['text', 'textnode', 'link'].includes(String(selected.get('type')))

  return (
    <>
      <div class="cms-editor-canvas" ref={host} />
      {props.compare && (
        <div class="cms-compare-pane">
          <div class="cms-compare-label">Jämför · {props.device === 'Desktop' ? '390' : '1440'}</div>
          <iframe
            title="Jämförelsevy"
            sandbox=""
            srcDoc={`<!doctype html><html><head><style>html,body{margin:0}${props.page.content[props.lang].css[props.mode]}</style></head><body>${props.page.content[props.lang].html}</body></html>`}
          />
        </div>
      )}
      <aside id="cms-inspector" class="cms-inspector" aria-label="Egenskaper">
        <div class="cms-panel-tabs" role="tablist" aria-label="Egenskapspanel">
          {(['design', 'layers', 'blocks'] as const).map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={props.tab === tab}
              onClick={() => props.onTab(tab)}
            >
              {tab === 'design' ? 'Design' : tab === 'layers' ? 'Lager' : 'Lägg till'}
            </button>
          ))}
        </div>
        <div hidden={props.tab !== 'design'} class="cms-inspector-scroll">
          <div class="cms-selection-head">
            <strong>{label(selected)}</strong>
          </div>
          {selected ? (
            <section class="cms-inspector-section">
              <div class="cms-actions-row">
                <button
                  type="button"
                  onClick={() => selected.parent() && instance.current?.select(selected.parent())}
                >
                  Förälder
                </button>
                <button type="button" disabled={isProtected(selected)} onClick={duplicate}>
                  Duplicera
                </button>
                <button
                  type="button"
                  disabled={isProtected(selected)}
                  onClick={() => selected.remove()}
                >
                  Ta bort
                </button>
              </div>
              {textLike && (
                <label>
                  Text
                  <textarea
                    value={selected.getEl()?.textContent ?? ''}
                    onInput={(event) => selected.components(event.currentTarget.value)}
                  />
                </label>
              )}
              {tag === 'a' && (
                <label>
                  Länk
                  <input
                    value={String(attributes['href'] ?? '')}
                    onChange={(event) =>
                      selected.addAttributes({ href: event.currentTarget.value })
                    }
                  />
                </label>
              )}
              {tag === 'img' && (
                <label>
                  Alternativtext
                  <input
                    value={String(attributes['alt'] ?? '')}
                    onInput={(event) => selected.addAttributes({ alt: event.currentTarget.value })}
                  />
                </label>
              )}
              <h3>Finjustera</h3>
              <div class="cms-nudge-grid">
                <button type="button" onClick={(e) => nudge(-1, 0, e.shiftKey ? 10 : 1)}>
                  ←
                </button>
                <button type="button" onClick={(e) => nudge(0, -1, e.shiftKey ? 10 : 1)}>
                  ↑
                </button>
                <button type="button" onClick={(e) => nudge(0, 1, e.shiftKey ? 10 : 1)}>
                  ↓
                </button>
                <button type="button" onClick={(e) => nudge(1, 0, e.shiftKey ? 10 : 1)}>
                  →
                </button>
                <button
                  type="button"
                  onClick={() =>
                    mutateSelected((component) =>
                      component.setStyle(resetNudgeStyle(component.getStyle())),
                    )
                  }
                >
                  Nollställ
                </button>
              </div>
              {isProtected(selected) && (
                <p class="cms-lock-note">
                  Funktionsblocket är skyddat. Utseendet får ändras; kopplingen till runtime
                  bevaras.
                </p>
              )}
            </section>
          ) : (
            <p class="cms-help">Välj ett element i sidan eller i Lager.</p>
          )}
          <div id="cms-traits" />
          <div id="cms-styles" />
          {selected && (
            <details class="cms-advanced">
              <summary>Avancerad CSS</summary>
              <label>
                Egenskap
                <input
                  value={advancedProperty}
                  onInput={(e) => setAdvancedProperty(e.currentTarget.value)}
                  placeholder="aspect-ratio"
                />
              </label>
              <label>
                Värde
                <input
                  value={advancedValue}
                  onInput={(e) => setAdvancedValue(e.currentTarget.value)}
                  placeholder="16 / 9"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const property = advancedProperty.trim()
                  const value = advancedValue.trim()
                  if (
                    !/^(?:--)?[a-z][a-z0-9-]*$/.test(property) ||
                    (value && !CSS.supports(property, value))
                  )
                    return props.onError('CSS-egenskapen eller värdet stöds inte av webbläsaren.')
                  if (value) selected.addStyle({ [property]: value })
                  else selected.removeStyle(property)
                }}
              >
                Tillämpa
              </button>
            </details>
          )}
        </div>
        <div id="cms-layers" hidden={props.tab !== 'layers'} class="cms-manager-panel" />
        <div id="cms-blocks" hidden={props.tab !== 'blocks'} class="cms-manager-panel" />
      </aside>
    </>
  )
}
