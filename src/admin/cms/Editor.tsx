import { CmsTextarea } from './Textarea'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import grapesjs, { type Component, type Editor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import type { CmsAsset, CmsLang, CmsMode, CmsPage, CmsPresentation } from '../../../shared/cms'
import { mediaUrl } from '../../../shared/cms'
import { SUPABASE_URL } from '../../backend/config'
import { configureComponent, isProtected, isReadOnlyPreview, styleSectors } from './editorPolicy'
import { siteThemeCss } from '../../../shared/site-theme'
import { composedCanvas, stripComposedCanvas } from './composedCanvas'
import { syncResponsiveText } from './responsiveText'
import { syncLayout } from './responsiveStyles'
import { nudgeStyle, resetNudgeStyle } from './position'
import { cloneComponent } from './clone'
import { captureViewState, restoreViewState, type CmsViewState } from './viewState'
import { exportNativeCanvas, parseCanvasCss } from './nativeCanvas'
import { CmsModal } from './Modal'
import { CmsIcon } from './Icon'
import { compactWorkspace } from './useResponsivePanels'
import { labelEditorChrome } from './editorAccessibility'
import { LivePreview } from './LivePreview'
import type { CmsScene } from '../../cms/Scene'
import { canvasBehavior, sceneVisibilityCss } from './canvasBehavior'
import {
  isSitePage,
  renderSitePage,
  sitePageBody,
  sitePageCss,
  normalizeSitePageContent,
} from '../../../shared/site-page'

export interface EditorHandle {
  flush: () => void
  fit: () => number
}

interface Props {
  onClosePanel: () => void
  scene: CmsScene
  pageSettings: ComponentChildren
  page: CmsPage
  lang: CmsLang
  mode: CmsMode
  device: 'Desktop' | 'Mobile'
  compare: boolean
  zoom: number
  locked: boolean
  preview: CmsPresentation | null
  presentation: CmsPresentation
  onOpenPage: (path: string) => void
  onNavigate: (path: string, lang: CmsLang, mode: CmsMode) => void
  assets: CmsAsset[]
  fontCss: string
  tab: 'design' | 'layers' | 'blocks'
  onTab: (tab: 'design' | 'layers' | 'blocks') => void
  onChange: (page: CmsPage) => void
  onReady: (handle: EditorHandle | null) => void
  onZoom: (zoom: number) => void
  onError: (message: string) => void
}

// The comparison frame is static; the editing canvas runs the shared fold behavior.
const canvasScrollCss = '[data-knc-surface^="mobile-"]>div:first-child{position:relative!important}'

function fontFamilyOptions(assets: CmsAsset[]): { id: string; label: string }[] {
  return [
    { id: "'Inter Variable',Inter,system-ui,sans-serif", label: 'Inter' },
    { id: "'Playfair Display',Georgia,serif", label: 'Playfair Display' },
    ...assets
      .filter((asset) => asset.mime === 'font/woff2' && !asset.archived && !asset.trashed_at)
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
  if (!component) return 'Sida'
  const tag = String(component.get('tagName') ?? 'div').toUpperCase()
  const id = String(component.getAttributes()['id'] ?? '')
  return `${tag}${id ? ` · #${id}` : ''}`
}

function fitEditor(editor: Editor): number {
  const mobile = editor.Devices.get('Mobile')
  const bounds = editor.getContainer()?.getBoundingClientRect()
  if (mobile && bounds && bounds.width > 40 && bounds.height > 40) {
    // On a phone, fit the editing aperture to the available screen instead of
    // shrinking an entire 844px page. This is viewport state, never saved content.
    const scale = Math.min(1, (bounds.width - 40) / 390)
    const height =
      compactWorkspace() && editor.getDevice() === 'Mobile'
        ? Math.max(260, Math.min(844, Math.floor((bounds.height - 40) / scale)))
        : 844
    if (mobile.get('height') !== `${height}px`) mobile.set('height', `${height}px`)
  }
  editor.Canvas.fitViewport({
    gap: 16,
    ignoreHeight: false,
    zoom: (value) => Math.min(100, Math.floor(value)),
  })
  return editor.Canvas.getZoom()
}

function editorContextKey(props: Props): string {
  const sharedChromeKey =
    isSitePage(props.page) || props.page.path === '/'
      ? JSON.stringify(
          props.presentation.pages
            .filter((page) => props.page.path !== '/' || page.path === '/about')
            .map((page) =>
              ['/', '/about'].includes(page.path)
                ? [page.path, page.content[props.lang]]
                : [page.path, page.inMenu, page.name[props.lang]],
            ),
        )
      : ''
  return `${props.page.id}:${props.lang}:${props.mode}:${sharedChromeKey}`
}

export function CmsEditor(props: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<Editor | null>(null)
  const latest = useRef(props)
  latest.current = props
  const applying = useRef(false)
  const timer = useRef<number | null>(null)
  const [selected, setSelected] = useState<Component | null>(null)
  const [imageTarget, setImageTarget] = useState<Component | null>(null)
  const [advancedProperty, setAdvancedProperty] = useState('')
  const [advancedValue, setAdvancedValue] = useState('')
  const viewStates = useRef(new Map<string, CmsViewState>())
  const rendered = useRef<{ pageId: string; key: string; html: string; css: string } | null>(null)
  const checkpoint = useRef<{ html: string; css: string } | null>(null)
  const contextKey = editorContextKey(props)
  const variant = props.page.content[props.lang]
  const compareHost = useRef<HTMLDivElement>(null)
  const [compareScale, setCompareScale] = useState(1)
  const compareWidth = props.device === 'Desktop' ? 390 : 1440
  const comparison = useMemo(
    () =>
      props.compare
        ? isSitePage(props.page)
          ? renderSitePage(props.presentation, props.page, props.lang, props.mode)
          : composedCanvas(props.page, props.presentation, props.lang, props.mode)
        : null,
    [props.compare, variant.html, variant.css[props.mode], props.mode, props.presentation],
  )

  useLayoutEffect(() => {
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
      // O-Y-A also disables GrapesJS's default box-sizing reset: it is not site CSS.
      protectedCss: '',
      canvas: {
        scripts: [],
        styles: [],
        frameContent: '<!doctype html><html lang="sv"><head></head><body></body></html>',
        // Default WebKit scrollbar styling reserves 10px that the actual mobile site does not.
        frameStyle: 'body{background-color:#fff}',
      },
      // Pointer-transparent public branding must still be selectable in the editor.
      // Canvas-only CSS is never exported to the published website.
      canvasCss:
        'html{scroll-behavior:auto!important}body{margin:0!important}svg,svg *{pointer-events:auto!important}',
      mediaCondition: 'min-width',
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
      blockManager: {
        appendTo: '#cms-blocks',
        appendOnClick: (block, editor) => {
          const wrapper = editor.getWrapper()
          const surfaces = wrapper?.find('[data-knc-surface]') ?? []
          let target = editor.getSelected()
          if (isSitePage(latest.current.page) && !target?.getEl()?.closest('#cms-site-content'))
            target = wrapper?.find('#cms-site-content')[0]
          while (
            target &&
            (target.get('droppable') === false ||
              !['div', 'main', 'section', 'article', 'aside', 'header', 'footer', 'nav'].includes(
                String(target.get('tagName')).toLowerCase(),
              ))
          )
            target = target.parent()
          target ??= surfaces.find((surface) => surface.getEl()?.getClientRects().length) ?? wrapper
          if (!target || target.get('droppable') === false)
            return latest.current.onError('Välj en redigerbar behållare i sidan först.')
          const content = block.getContent()
          if (content === undefined) return
          const added = target.append(typeof content === 'function' ? content() : content)
          editor.select(added[0])
        },
      },
      deviceManager: {
        devices: [
          { id: 'Desktop', name: 'Desktop', width: '1440px', height: '900px', widthMedia: '769px' },
          { id: 'Mobile', name: 'Mobile', width: '390px', height: '844px', widthMedia: '768px' },
        ],
      },
      assetManager: { assets: [], upload: false, custom: true },
    })
    instance.current = editor
    const stopLabeling = labelEditorChrome(
      host.current.closest<HTMLElement>('.cms-editor-wrap') ?? host.current,
    )
    editor.on('asset:custom', ({ open }: { open: boolean }) => {
      if (open) setImageTarget(editor.getSelected() ?? null)
    })
    for (const [id, blockLabel, content] of blocks)
      editor.BlockManager.add(id, { label: blockLabel, content })

    editor.on('component:create', configureComponent)
    editor.on('component:selected', (component: Component) => setSelected(component))
    editor.on('component:deselected', () => setSelected(editor.getSelected() ?? null))
    editor.on('component:dblclick', (component: Component) => {
      if (isProtected(component) || isReadOnlyPreview(component)) return
      const type = String(component.get('type') ?? '')
      const tag = String(component.get('tagName') ?? '').toLowerCase()
      if (type === 'text' || type === 'link' || ['p', 'h1', 'h2', 'h3', 'span', 'a'].includes(tag))
        component.set('editable', true)
    })
    const keydown = (event: KeyboardEvent): void => {
      if (latest.current.locked || host.current?.closest('[inert]')) return
      if (document.querySelector('dialog:modal')) return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      const component = editor.getSelected()
      if (!component || isProtected(component) || isReadOnlyPreview(component)) return
      const delta: [number, number] =
        event.key === 'ArrowLeft'
          ? [-1, 0]
          : event.key === 'ArrowRight'
            ? [1, 0]
            : event.key === 'ArrowUp'
              ? [0, -1]
              : [0, 1]
      component.setStyle(
        nudgeStyle(component.getStyle(), delta[0], delta[1], event.shiftKey ? 10 : 1),
      )
      event.preventDefault()
    }
    window.addEventListener('keydown', keydown)
    const remember = (): void => {
      if (!applying.current && rendered.current)
        viewStates.current.set(rendered.current.pageId, captureViewState(editor))
    }
    editor.on('component:selected', remember)
    editor.on('canvas:scroll', remember)

    const flush = (): void => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      if (applying.current || !checkpoint.current) return
      // GrapesJS updates its dirty counter asynchronously; a context switch cannot wait for it.
      let html = editor.getHtml({ cleanId: false })
      const css = editor.getCss({ keepUnusedStyles: true }) ?? ''
      if (html === checkpoint.current.html && css === checkpoint.current.css) return
      const current = latest.current
      const next = structuredClone(current.page)
      applying.current = true
      try {
        syncResponsiveText(editor, current.page.content[current.lang].html, html)
      } finally {
        applying.current = false
      }
      html = editor.getHtml({ cleanId: false })
      const baseVariant = isSitePage(current.page)
        ? normalizeSitePageContent(
            current.page.content[current.lang],
            `${current.page.id}-${current.lang}`,
          )
        : current.page.content[current.lang]
      const nativeExport = exportNativeCanvas(html, css, current.mode)
      const exported = stripComposedCanvas(nativeExport.html, nativeExport.css)
      if (isSitePage(current.page)) {
        exported.html = sitePageBody(exported.html)
        exported.css = sitePageCss(exported.css, exported.html)
      }
      next.content[current.lang] = {
        html: exported.html,
        css: {
          ...baseVariant.css,
          [current.mode]: exported.css,
          [current.mode === 'light' ? 'dark' : 'light']: syncLayout(
            baseVariant.css[current.mode],
            exported.css,
            baseVariant.css[current.mode === 'light' ? 'dark' : 'light'],
          ),
        },
      }
      const otherMode = current.mode === 'light' ? 'dark' : 'light'
      next.content[current.lang].css[otherMode] = stripComposedCanvas(
        html,
        next.content[current.lang].css[otherMode],
      ).css
      rendered.current = {
        pageId: current.page.id,
        key: editorContextKey(current),
        ...exported,
      }
      current.onChange(next)
      checkpoint.current = { html, css }
      editor.clearDirtyCount()
    }
    const schedule = (): void => {
      if (applying.current) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 180)
    }
    editor.on('update', schedule)
    editor.Commands.add('tlb-clone', { run: () => duplicate() })
    const fit = (): void => {
      if (editor.Canvas.getBody()) latest.current.onZoom(fitEditor(editor))
    }
    const resize = new ResizeObserver(fit)
    editor.on('load', () => {
      editor.clearDirtyCount()
      resize.observe(editor.Canvas.getFrameEl())
      fit()
    })
    resize.observe(host.current)
    props.onReady({
      flush,
      fit: () => fitEditor(editor),
    })

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      props.onReady(null)
      resize.disconnect()
      window.removeEventListener('keydown', keydown)
      stopLabeling()
      editor.destroy()
      instance.current = null
    }
  }, [])

  // Flush + undo can restore identical props in one render while the canvas has changed.
  // Compare against the last rendered document on every render, not only changed dependencies.
  useLayoutEffect(() => {
    const editor = instance.current
    if (!editor) return
    const previous = rendered.current
    if (
      previous?.key === contextKey &&
      previous.html === variant.html &&
      previous.css === variant.css[props.mode]
    )
      return
    if (previous) viewStates.current.set(previous.pageId, captureViewState(editor))
    const previousState = viewStates.current.get(props.page.id)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    applying.current = true
    const content = isSitePage(props.page)
      ? renderSitePage(props.presentation, props.page, props.lang, props.mode)
      : composedCanvas(props.page, props.presentation, props.lang, props.mode)
    editor.select()
    setSelected(null)
    // Removing the previous tree can remove its ID rules; do that before loading the next CSS.
    editor.setComponents('')
    // Importing HTML extracts inline styles. Load CSS first so it cannot erase them.
    editor.setStyle(parseCanvasCss(content.css, editor))
    editor.setComponents(content.html)
    const configure = (component: Component): void => {
      configureComponent(component)
      component.components().forEach(configure)
    }
    editor.getWrapper()?.components().forEach(configure)
    editor.getWrapper()?.set('droppable', !variant.html.includes('data-knc-native="1"'))
    rendered.current = {
      pageId: props.page.id,
      key: contextKey,
      html: variant.html,
      css: variant.css[props.mode],
    }
    checkpoint.current = {
      html: editor.getHtml({ cleanId: false }),
      css: editor.getCss({ keepUnusedStyles: true }) ?? '',
    }
    applying.current = false
    editor.clearDirtyCount()
    if (previousState) restoreViewState(editor, previousState)
  })

  useLayoutEffect(() => {
    const host = compareHost.current
    if (!host) return
    const resize = (): void => setCompareScale(Math.min(1, host.clientWidth / compareWidth))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [props.compare, compareWidth])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    const frame = editor.Canvas.getDocument()
    if (!frame) return
    let style = frame.getElementById('cms-uploaded-fonts') as HTMLStyleElement | null
    if (!style) {
      style = frame.createElement('style')
      style.id = 'cms-uploaded-fonts'
      frame.head.appendChild(style)
    }
    style.textContent = props.fontCss + siteThemeCss(props.presentation, props.mode)
  }, [props.fontCss, props.presentation.themes, props.mode])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    editor.AssetManager.clear()
    editor.AssetManager.add(
      props.assets
        .filter((asset) => asset.mime.startsWith('image/') && !asset.archived && !asset.trashed_at)
        .map((asset) => ({ src: mediaUrl(asset, SUPABASE_URL ?? ''), name: asset.name })),
    )
  }, [props.assets])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    editor.getConfig().mediaCondition = props.device === 'Desktop' ? 'min-width' : 'max-width'
    editor.setDevice(props.device)
    latest.current.onZoom(fitEditor(editor))
  }, [props.device])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    editor.Canvas.setZoom(props.zoom)
  }, [props.zoom])

  useEffect(() => {
    const editor = instance.current
    return editor ? canvasBehavior(editor, props.scene, props.mode) : undefined
  }, [contextKey, props.scene])

  useLayoutEffect(() => {
    instance.current?.select()
    setSelected(null)
  }, [props.scene])

  const chooseImage = (): void => {
    const editor = instance.current
    const component = editor?.getSelected()
    if (
      !editor ||
      !component ||
      !['img', 'svg'].includes(String(component.get('tagName') ?? '').toLowerCase())
    )
      return props.onError('Välj en bild först.')
    setImageTarget(component)
  }
  const closePicker = (): void => {
    setImageTarget(null)
    instance.current?.AssetManager.close()
  }
  const pickImage = (asset: CmsAsset): void => {
    if (!imageTarget || isReadOnlyPreview(imageTarget)) return
    const src = mediaUrl(asset, SUPABASE_URL ?? '')
    const attrs = imageTarget.getAttributes()
    const alt = asset.alt || String(attrs['alt'] ?? attrs['aria-label'] ?? '')
    if (String(imageTarget.get('tagName')).toLowerCase() === 'svg') {
      // Replace presentation only. The enclosing native component retains its identity and logic.
      if (attrs['role'] !== 'img' || attrs['data-knc-required']) return
      const retained = Object.fromEntries(
        Object.entries(attrs).filter(
          ([name]) => ['id', 'class', 'title'].includes(name) || name.startsWith('data-knc-'),
        ),
      )
      const [image] = imageTarget.replaceWith({
        type: 'image',
        attributes: { ...retained, src, alt },
        style: { ...imageTarget.getStyle(), 'object-fit': 'contain' },
      })
      instance.current?.select(image)
    } else imageTarget.addAttributes({ src, alt })
    closePicker()
  }
  const mutateSelected = (fn: (component: Component) => void): void => {
    const component = instance.current?.getSelected()
    if (!component) return props.onError('Välj ett element först.')
    if (isReadOnlyPreview(component))
      return props.onError('Den här runtime-förhandsvisningen är skrivskyddad.')
    fn(component)
  }
  const nudge = (dx: number, dy: number, step: number): void =>
    mutateSelected((component) =>
      component.setStyle(nudgeStyle(component.getStyle(), dx, dy, step)),
    )
  const duplicate = (): void =>
    mutateSelected((component) => {
      if (isProtected(component) || component.get('copyable') === false)
        return latest.current.onError('Det valda funktionsblocket kan inte dupliceras.')
      const copy = cloneComponent(component)
      component.parent()?.append(copy, { at: component.index() + 1 })
      instance.current?.select(copy)
    })

  const attributes = selected?.getAttributes() ?? {}
  const tag = String(selected?.get('tagName') ?? '').toLowerCase()
  const textLike =
    selected &&
    (['text', 'textnode', 'link'].includes(String(selected.get('type'))) || tag === 'text')
  const hasElementChildren = selected
    ?.components()
    .some((child: Component) => !child.is('textnode') && child.get('tagName') !== 'br')
  const mixedTextNodes =
    selected && hasElementChildren
      ? selected.components().filter((child: Component) => child.is('textnode'))
      : []
  const readOnly = selected ? isReadOnlyPreview(selected) : false
  const logoText = tag === 'svg' ? (selected?.find('text') ?? []) : []

  return (
    <>
      <div
        class="cms-editor-canvas"
        ref={host}
        style={{ visibility: props.locked ? 'hidden' : 'visible' }}
      />
      {props.locked && props.preview && (
        <LivePreview
          scene={props.scene}
          page={props.page}
          presentation={props.preview}
          lang={props.lang}
          mode={props.mode}
          device={props.device}
          fontCss={props.fontCss}
          onNavigate={props.onNavigate}
        />
      )}
      {comparison && !props.locked && (
        <div class="cms-compare-pane">
          <div class="cms-compare-label">
            Jämför · {props.device === 'Desktop' ? '390' : '1440'}
          </div>
          <div ref={compareHost} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <iframe
              title="Jämförelsevy"
              sandbox=""
              style={{
                width: `${compareWidth}px`,
                height: `${100 / compareScale}%`,
                transform: `scale(${compareScale})`,
                transformOrigin: 'top left',
              }}
              srcDoc={`<!doctype html><html lang="${props.lang}"><head><style>html,body{margin:0}${props.fontCss}${siteThemeCss(props.presentation, props.mode)}${comparison.css}${sceneVisibilityCss(props.scene, props.mode)}${canvasScrollCss}</style></head><body>${comparison.html}</body></html>`}
            />
          </div>
        </div>
      )}
      <aside id="cms-inspector" class="cms-inspector" aria-label="Egenskaper" inert={props.locked}>
        <div class="cms-inspector-heading">
          <strong>Egenskaper</strong>
          <button
            type="button"
            class="cms-panel-close"
            aria-label="Stäng panel"
            onClick={props.onClosePanel}
          >
            <CmsIcon name="close" />
          </button>
        </div>
        <div
          class="cms-panel-tabs"
          role="tablist"
          aria-label="Egenskapspanel"
          onKeyDown={(event) => {
            const tabs = ['design', 'layers', 'blocks'] as const
            const index = tabs.indexOf(props.tab)
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : null
            if (next === null) return
            event.preventDefault()
            event.stopPropagation()
            const tab = tabs[next]
            if (tab) props.onTab(tab)
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          }}
        >
          {(['design', 'layers', 'blocks'] as const).map((tab) => (
            <button
              type="button"
              role="tab"
              id={`cms-tab-${tab}`}
              aria-controls={tab === 'design' ? 'cms-design' : `cms-${tab}`}
              tabIndex={props.tab === tab ? 0 : -1}
              aria-selected={props.tab === tab}
              onClick={() => props.onTab(tab)}
            >
              {tab === 'design' ? 'Design' : tab === 'layers' ? 'Lager' : 'Lägg till'}
            </button>
          ))}
        </div>
        <div
          id="cms-design"
          role="tabpanel"
          aria-labelledby="cms-tab-design"
          hidden={props.tab !== 'design'}
          class="cms-inspector-scroll"
        >
          <div class="cms-selection-head">
            <strong>{label(selected)}</strong>
            <p class="cms-style-scope">
              Layout: {props.device === 'Desktop' ? 'bara dator' : 'bara mobil'}. Text delas mellan
              vyerna.
            </p>
          </div>
          {selected && readOnly ? (
            <p class="cms-lock-note">
              {isSitePage(props.page) ? (
                <>
                  Sidhuvud, logotyp och sidfot delas med webbplatsen.
                  <button type="button" onClick={() => props.onOpenPage('/')}>
                    Redigera sidhuvud
                  </button>
                  <button type="button" onClick={() => props.onOpenPage('/about')}>
                    Redigera sidfot
                  </button>
                </>
              ) : (
                <>
                  Det här innehållet delas med Om oss. Ändringar där visas också här.
                  <button type="button" onClick={() => props.onOpenPage('/about')}>
                    Redigera Om oss
                  </button>
                </>
              )}
            </p>
          ) : selected ? (
            <section class="cms-inspector-section">
              <div class="cms-actions-row">
                <button
                  type="button"
                  onClick={() => selected.parent() && instance.current?.select(selected.parent())}
                >
                  Förälder
                </button>
                <button
                  type="button"
                  disabled={isProtected(selected) || selected.get('copyable') === false}
                  onClick={duplicate}
                >
                  Duplicera
                </button>
                <button
                  type="button"
                  disabled={isProtected(selected) || selected.get('removable') === false}
                  onClick={() => {
                    if (!isProtected(selected) && selected.get('removable') !== false)
                      selected.remove()
                  }}
                >
                  Ta bort
                </button>
              </div>
              {textLike && !hasElementChildren && (
                <label>
                  Text
                  <CmsTextarea
                    value={Array.from(selected.getEl()?.childNodes ?? [])
                      .map((node) => (node.nodeName === 'BR' ? '\n' : (node.textContent ?? '')))
                      .join('')}
                    onInput={(event) => {
                      const text = document.createElement('span')
                      text.textContent = event.currentTarget.value
                      // Plain HTML collapses literal newlines. Match the canvas rich-text editor's
                      // line-break markup, after escaping user text so it cannot become HTML.
                      selected.components(
                        tag === 'text' ? text.innerHTML : text.innerHTML.replace(/\r?\n/g, '<br>'),
                      )
                    }}
                  />
                </label>
              )}
              {['input', 'textarea'].includes(tag) && (
                <label>
                  Platshållartext
                  <CmsTextarea
                    value={String(attributes['placeholder'] ?? '')}
                    onInput={(event) =>
                      selected.addAttributes({ placeholder: event.currentTarget.value })
                    }
                  />
                </label>
              )}
              {logoText.map((node, index) => (
                <label>
                  Logotyptext {index + 1}
                  <input
                    value={node.getEl()?.textContent ?? ''}
                    onInput={(event) => {
                      const text = document.createElement('span')
                      text.textContent = event.currentTarget.value
                      node.components(text.innerHTML)
                    }}
                  />
                </label>
              ))}
              {mixedTextNodes.map((node, index) => (
                <label>
                  {mixedTextNodes.length === 1 ? 'Text' : `Text ${index + 1}`}
                  <CmsTextarea
                    value={String(node.get('content') ?? '')}
                    onInput={(event) => {
                      node.set('content', event.currentTarget.value)
                      // GrapesJS's text-node view does not rerender on change:content.
                      node.getView()?.render()
                      // Keep neighboring icons and native actions intact in mixed text elements.
                      if (event.currentTarget.value.includes('\n'))
                        selected.addStyle({ 'white-space': 'pre-wrap' })
                    }}
                  />
                </label>
              ))}
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
              {(tag === 'img' || tag === 'svg') && (
                <>
                  <label>
                    Alternativtext
                    <input
                      value={String(attributes[tag === 'svg' ? 'aria-label' : 'alt'] ?? '')}
                      onInput={(event) =>
                        selected.addAttributes({
                          [tag === 'svg' ? 'aria-label' : 'alt']: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  {(tag === 'img' ||
                    (attributes['role'] === 'img' && !attributes['data-knc-required'])) && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.focus()
                        chooseImage()
                      }}
                    >
                      {tag === 'svg' ? 'Byt logotyp från biblioteket' : 'Byt bild från biblioteket'}
                    </button>
                  )}
                </>
              )}
              <h3>Finjustera</h3>
              <div class="cms-nudge-grid">
                <button
                  type="button"
                  aria-label="Flytta åt vänster"
                  title="Flytta åt vänster · 1 px, Skift 10 px"
                  onClick={(e) => nudge(-1, 0, e.shiftKey ? 10 : 1)}
                >
                  <CmsIcon name="arrowLeft" />
                </button>
                <button
                  type="button"
                  aria-label="Flytta uppåt"
                  title="Flytta uppåt · 1 px, Skift 10 px"
                  onClick={(e) => nudge(0, -1, e.shiftKey ? 10 : 1)}
                >
                  <CmsIcon name="arrowUp" />
                </button>
                <button
                  type="button"
                  aria-label="Flytta nedåt"
                  title="Flytta nedåt · 1 px, Skift 10 px"
                  onClick={(e) => nudge(0, 1, e.shiftKey ? 10 : 1)}
                >
                  <CmsIcon name="arrowDown" />
                </button>
                <button
                  type="button"
                  aria-label="Flytta åt höger"
                  title="Flytta åt höger · 1 px, Skift 10 px"
                  onClick={(e) => nudge(1, 0, e.shiftKey ? 10 : 1)}
                >
                  <CmsIcon name="arrowRight" />
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
            <>
              <p class="cms-help">
                Klicka på text, bild eller logotyp för att redigera. Sidans namn och sökresultat
                ändrar du här.
              </p>
              {props.pageSettings}
            </>
          )}
          <div hidden={!selected || readOnly}>
            <div id="cms-traits" />
            <div id="cms-styles" />
          </div>
          {selected && !readOnly && (
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
        <div
          id="cms-layers"
          tabIndex={0}
          role="tabpanel"
          aria-labelledby="cms-tab-layers"
          hidden={props.tab !== 'layers'}
          class="cms-manager-panel"
        />
        <div
          id="cms-blocks"
          tabIndex={0}
          role="tabpanel"
          aria-labelledby="cms-tab-blocks"
          hidden={props.tab !== 'blocks'}
          class="cms-manager-panel"
        />
      </aside>
      {imageTarget && (
        <CmsModal title="Välj bild" onClose={closePicker}>
          <p class="cms-help">Välj en bild. Ladda upp fler via Resurser.</p>
          {!props.assets.some(
            (asset) => asset.mime.startsWith('image/') && !asset.archived && !asset.trashed_at,
          ) && (
            <div class="cms-resource-empty">
              <CmsIcon name="image" />
              <strong>Inga bilder att välja ännu</strong>
              <p>Ladda upp en bild i Resurser och öppna sedan bildväljaren igen.</p>
            </div>
          )}
          <div class="cms-resource-grid">
            {props.assets
              .filter(
                (asset) => asset.mime.startsWith('image/') && !asset.archived && !asset.trashed_at,
              )
              .map((asset) => (
                <button type="button" class="cms-resource-card" onClick={() => pickImage(asset)}>
                  <img src={mediaUrl(asset, SUPABASE_URL ?? '')} alt={asset.alt} />
                  <span>{asset.name}</span>
                </button>
              ))}
          </div>
        </CmsModal>
      )}
    </>
  )
}
