import { updateNativeCanvas, updateSiteHeader } from './updateCanvas'
import {
  canReplaceResourceGraphic,
  connectResourcePicker,
  openResourcePicker,
} from './resourceTargets'
import type { ResourceDestination } from '../../../shared/cms-resource-assignment'
import { connectHierarchicalResize } from './hierarchicalResize'
import { CmsTextarea } from './Textarea'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import grapesjs, { type Component, type Editor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import type {
  CmsAsset,
  CmsDocument,
  CmsLang,
  CmsMode,
  CmsPage,
  CmsPresentation,
} from '../../../shared/cms'
import { mediaUrl } from '../../../shared/cms'
import { SUPABASE_URL } from '../../backend/config'
import {
  configureComponent,
  deniedProperty,
  isProtected,
  isReadOnlyPreview,
  runtimeOwnedRole,
  styleSectors,
} from './editorPolicy'
import { siteThemeCss } from '../../../shared/site-theme'
import {
  composedCanvas,
  composedCanvasPasses,
  installHomeAboutPreview,
  type ComposedCanvasTree,
  stripComposedCanvas,
  extractComposedAbout,
  moveHomeAbout,
  moveBookingScene,
} from './composedCanvas'
import { syncResponsiveText } from './responsiveText'
import {
  canvasDevice,
  connectTextAutoHeight,
  editorDevices,
  syncPageLayout,
} from './responsiveStyles'
import { nudgeStyle, resetNudgeStyle } from './position'
import { cloneComponent } from './clone'
import { captureViewState, restoreViewState, type CmsViewState } from './viewState'
import {
  connectCanvasStyles,
  exportNativeCanvas,
  legalCanvasBase,
  parseCanvasCss,
  parseCanvasSheet,
  readCanvasCss,
  yieldCanvasTask,
  type CanvasTree,
} from './nativeCanvas'
import { bindCmsRootStyles, canonicalizeCmsRootStyles } from './cmsRootStyles'
import { CmsModal } from './Modal'
import { CmsIcon } from './Icon'
import { connectEditorAccessibility } from './editorAccessibility'
import { editorLocale } from './editorLocale'
import { LivePreview } from './LivePreview'
import type { CmsScene } from '../../cms/Scene'
import { canvasBehavior, sceneVisibilityCss } from './canvasBehavior'
import {
  SITE_PAGE_CSS,
  isSitePage,
  renderSitePage,
  siteHeader,
  sitePageBody,
  type SiteContact,
} from '../../../shared/site-page'
import { resolveBusinessSettings } from '../../site/business'

export interface EditorHandle {
  flush: () => void
  /** A canvas edit still waiting for its debounced handoff; safe to read during beforeunload. */
  pending: () => boolean
  /** The fitted zoom; undefined while the canvas has no frame yet. */
  fit: () => number | undefined
}

interface Props {
  active: boolean
  onClosePanel: () => void
  inspectorModal: boolean
  scene: CmsScene
  pageSettings: ComponentChildren
  page: CmsPage
  lang: CmsLang
  mode: CmsMode
  device: 'Desktop' | 'Mobile'
  narrowDesktop: boolean
  compare: boolean
  zoom: number
  locked: boolean
  preview: CmsPresentation | null
  presentation: CmsPresentation
  draft?: CmsDocument
  onOpenResources?: (destination: ResourceDestination) => void
  onOpenPage: (path: string) => void
  onNavigate: (path: string, lang: CmsLang, mode: CmsMode) => void
  assets: CmsAsset[]
  fontCss: string
  tab: 'design' | 'layers' | 'blocks'
  onTab: (tab: 'design' | 'layers' | 'blocks') => void
  onChange: (pages: CmsPage[]) => void
  onReady: (handle: EditorHandle | null) => void
  onZoom: (zoom: number) => void
  onError: (message: string) => void
}

// The comparison frame is static; the editing canvas runs the shared fold behavior.
const canvasScrollCss = '[data-knc-surface^="mobile-"]>div:first-child{position:relative!important}'

/** Schedule derived work only after a visible canvas has had an opportunity to paint. */
function afterCanvasPaint(callback: () => void): () => void {
  let idle: number | undefined
  let timer: number | undefined
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(callback)
      else timer = window.setTimeout(callback, 0)
    })
  })
  return () => {
    cancelAnimationFrame(frame)
    if (idle !== undefined) window.cancelIdleCallback(idle)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

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

const blockGlyphs = {
  section: 'M3 4h18v16H3ZM3 9h18M7 13h10M7 16h6',
  container: 'M4 4h16v16H4ZM8 8h8v8H8Z',
  columns: 'M3 4h7v16H3ZM14 4h7v16h-7Z',
  heading: 'M5 5v14M19 5v14M5 12h14M3 5h4M17 5h4M3 19h4M17 19h4',
  text: 'M4 5h16M4 10h16M4 15h16M4 20h10',
  image: 'M3 3h18v18H3ZM3 16l5-5 5 5 3-3 5 5M16 7h.01',
  link: 'M3 7h18v10H3ZM8 12h8m-3-3 3 3-3 3',
  divider: 'M3 12h18M7 6h10M7 18h10',
} as const

function label(component: Component | null): string {
  if (!component) return 'Sida'
  const tag = String(component.get('tagName') ?? 'div').toUpperCase()
  const id = String(component.getAttributes()['id'] ?? '')
  return `${tag}${id ? ` · #${id}` : ''}`
}

/** Fits the canvas and returns its zoom; undefined before GrapesJS has created the frame. */
function fitEditor(editor: Editor): number | undefined {
  // GrapesJS creates the frame when it loads the project, in a later task; fitViewport reads it.
  if (!editor.Canvas.getBody()) return undefined
  // Device dimensions describe the page, not the space around the editor.
  // Fit changes only scale; changing height also changes vh units and breakpoints.
  editor.Canvas.fitViewport({
    gap: 16,
    ignoreHeight: false,
    zoom: (value) => Math.min(100, Math.floor(value)),
  })
  return editor.Canvas.getZoom()
}

/** `chrome` is a created page's live header: menu, logo and contact changes invalidate its view. */
function editorContextKey(props: Props, chrome: string): string {
  if (isSitePage(props.page)) return `${props.page.id}:${props.lang}:${props.mode}:site:${chrome}`
  const sharedChromeKey =
    props.page.path === '/'
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
  const homeDevice = props.page.path === '/' ? `:${props.device}` : ''
  const bookingContext =
    props.page.path === '/booking' && props.scene !== 'default'
      ? `:${props.scene}:${props.device}`
      : ''
  return `${props.page.id}:${props.lang}:${props.mode}${bookingContext}${homeDevice}:${sharedChromeKey}`
}

/** The live header is edited on the homepage: a created page's canvas shows it, never picks it. */
function lockSiteHeader(editor: Editor): void {
  const lock = (component: Component): void => {
    component.set(
      {
        selectable: false,
        hoverable: false,
        highlightable: false,
        editable: false,
        removable: false,
        copyable: false,
        draggable: false,
        droppable: false,
        stylable: false,
        layerable: false,
        badgable: false,
        resizable: false,
      },
      { silent: true },
    )
    component.components().forEach(lock)
  }
  editor.getWrapper()?.find('#cms-site-header').forEach(lock)
}

/** The comparison frame's created page: the live header, the base sheet and the page's own CSS. */
function comparedSitePage(props: Props, contact: SiteContact): { html: string; css: string } {
  const site = renderSitePage(props.presentation, props.page, props.lang, props.mode, contact)
  return { html: site.html, css: `${SITE_PAGE_CSS}\n${site.css[props.mode]}` }
}

function pageFragment(html: string, wrapperId: string): string {
  if (!wrapperId || !/<body(?:\s|>)/i.test(html)) return html
  const document = new DOMParser().parseFromString(html, 'text/html')
  return document.body.id === wrapperId ? document.body.innerHTML : html
}

export function CmsEditor(props: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const layersHost = useRef<HTMLDivElement>(null)
  const instance = useRef<Editor | null>(null)
  // The initial frame is a pending device layout too, before its first resize.
  const changingDevice = useRef(true)
  const latest = useRef(props)
  latest.current = props
  const applying = useRef(false)
  const flushCanvas = useRef<(() => void) | null>(null)
  const deferredAbout = useRef<(() => CanvasTree) | null>(null)
  const aboutPreviewBuilt = useRef(false)
  const cancelAboutIdle = useRef<(() => void) | null>(null)
  const startup = useRef<{ key: string; html: string; css: string } | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<number | null>(null)
  const [selected, setSelected] = useState<Component | null>(null)
  const [imageTarget, setImageTarget] = useState<Component | null>(null)
  const [advancedProperty, setAdvancedProperty] = useState('')
  const [advancedValue, setAdvancedValue] = useState('')
  const viewStates = useRef(new Map<string, CmsViewState>())
  const rendered = useRef<{
    pageId: string
    device: Props['device']
    scene: CmsScene
    key: string
    chrome: string
    html: string
    css: string
  } | null>(null)
  const compiled = useRef<
    {
      key: string
      sourceHtml: string
      sourceCss: string
      wrapperId: string
      deferAbout: boolean
      content: { html: string; aboutPreview?: () => CanvasTree }
      rules: ReturnType<typeof parseCanvasCss>
    }[]
  >([])
  const checkpoint = useRef<{ html: string; css: string } | null>(null)
  const sitePage = isSitePage(props.page)
  const contact = useMemo(
    () => resolveBusinessSettings(new Map(Object.entries(props.draft?.settings ?? {}))),
    [props.draft?.settings],
  )
  const chrome = useMemo(
    () =>
      isSitePage(props.page)
        ? siteHeader(props.presentation, props.page, props.lang, props.mode, contact)
        : '',
    [props.presentation, props.page, props.lang, props.mode, contact],
  )
  const latestChrome = useRef(chrome)
  latestChrome.current = chrome
  const contextKey = editorContextKey(props, chrome)
  const variant = props.page.content[props.lang]
  const materializeAbout = (): void => {
    cancelAboutIdle.current?.()
    cancelAboutIdle.current = null
    const editor = instance.current
    const create = deferredAbout.current
    if (!editor || !create) return
    // Capture a pending owner edit before advancing the checkpoint for derived-only changes.
    flushCanvas.current?.()
    const wasApplying = applying.current
    applying.current = true
    try {
      installHomeAboutPreview(editor, create)
      aboutPreviewBuilt.current = true
      deferredAbout.current = null
      checkpoint.current = { html: editor.getHtml({ cleanId: false }), css: readCanvasCss(editor) }
      editor.clearDirtyCount()
      // Startup readiness stays separate from completion of the inactive model tree.
      host.current?.setAttribute('data-cms-about-preview-ready', 'true')
    } finally {
      applying.current = wasApplying
    }
  }
  const compareHost = useRef<HTMLDivElement>(null)
  const [compareScale, setCompareScale] = useState(1)
  const compareWidth = props.device === 'Desktop' ? 390 : 1440
  const compareHeight = props.device === 'Desktop' ? 844 : 900
  const canvasBase = useMemo(
    () =>
      sitePage
        ? { styles: ['/tokens.css'], scheme: props.mode }
        : legalCanvasBase(props.page.path, props.mode),
    [sitePage, props.page.path, props.mode],
  )
  const comparison = useMemo(
    () =>
      props.active && props.compare
        ? isSitePage(props.page)
          ? comparedSitePage(props, contact)
          : composedCanvas(
              props.page,
              props.presentation,
              props.lang,
              props.mode,
              props.scene,
              props.device === 'Desktop' ? 'Mobile' : 'Desktop',
            )
        : null,
    [
      props.active,
      props.compare,
      variant.html,
      variant.css[props.mode],
      props.mode,
      props.presentation,
      props.scene,
      props.device,
      contact,
    ],
  )

  useLayoutEffect(() => {
    if (!host.current) return
    const start = performance.now()
    const editor = grapesjs.init({
      container: host.current,
      height: '100%',
      width: '100%',
      fromElement: false,
      telemetry: false,
      cssIcons: '', // The workspace supplies its own icons; no external icon-font stylesheet.
      i18n: editorLocale,
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
        frameStyle: 'body{background-color:inherit;color:inherit}',
      },
      // Pointer-transparent public branding must still be selectable in the editor.
      // Canvas-only CSS is never exported to the published website.
      canvasCss:
        'html{scroll-behavior:auto!important}body{margin:0!important}svg,svg *{pointer-events:auto!important}',
      mediaCondition: 'min-width',
      selectorManager: { componentFirst: true },
      // The hidden Layers tab must not build and update an entire second DOM tree.
      layerManager: { appendTo: '' },
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
          if (isSitePage(latest.current.page) && !target)
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
        devices: editorDevices,
      },
      assetManager: { assets: [], upload: false, custom: true },
    })
    // storageManager:false disables its target, not its autosave serialization in 0.23.6.
    // The CMS draft/backup owns persistence; never build a second project on every update.
    editor.Storage.setAutosave(false)
    const releaseCanvasStyles = connectCanvasStyles(editor)
    instance.current = editor
    const releaseResize = connectHierarchicalResize(
      editor,
      () => applying.current || latest.current.locked,
      () => latest.current.mode,
    )
    const releaseTextHeight = connectTextAutoHeight(
      editor,
      () => applying.current || latest.current.locked,
    )
    const inspector = host.current
      .closest('.cms-editor-wrap')
      ?.querySelector<HTMLElement>('#cms-inspector')
    const releaseAccessibility = inspector
      ? connectEditorAccessibility(host.current, inspector)
      : undefined
    editor.on('asset:custom', ({ open }: { open: boolean }) => {
      const component = editor.getSelected()
      if (open && component && !latest.current.locked)
        openResourcePicker(
          editor,
          component,
          latest.current.draft,
          latest.current.onOpenResources,
          setImageTarget,
        )
    })
    for (const [id, blockLabel, content] of blocks)
      editor.BlockManager.add(id, {
        label: blockLabel,
        content,
        attributes: {
          role: 'button',
          tabindex: '0',
          'aria-label': `Lägg till ${blockLabel.toLowerCase()}`,
        },
        media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${blockGlyphs[id]}" /></svg>`,
      })

    editor.on('component:create', (component: Component) => {
      // Imports configure the complete tree below, once parent identities exist.
      // Avoid repeating that work for every component while the parser builds it.
      if (!applying.current) configureComponent(component)
    })
    editor.on('component:selected', (component: Component) => setSelected(component))
    editor.on('component:deselected', () => setSelected(editor.getSelected() ?? null))
    const releaseResourcePicker = connectResourcePicker(
      editor,
      () => latest.current,
      setImageTarget,
    )
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
      const pending = timer.current !== null
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      if (!pending || applying.current || !checkpoint.current) return
      // GrapesJS updates its dirty counter asynchronously; a context switch cannot wait for it.
      let html = editor.getHtml({ cleanId: false })
      const css = readCanvasCss(editor)
      if (html === checkpoint.current.html && css === checkpoint.current.css) return
      const current = latest.current
      let next = structuredClone(current.page)
      applying.current = true
      try {
        const textHtml =
          current.page.path === '/booking' && current.scene !== 'default'
            ? stripComposedCanvas(html, css, current.scene).html
            : html
        syncResponsiveText(editor, current.page.content[current.lang].html, textHtml)
      } finally {
        applying.current = false
      }
      html = editor.getHtml({ cleanId: false })
      const baseVariant = next.content[current.lang]
      const wrapperId = editor.getWrapper()?.getId() ?? ''
      const composedScene = current.page.path === '/booking' ? current.scene : 'default'
      const nativeExport = exportNativeCanvas(html, css, current.mode)
      const aboutOwner =
        current.page.path === '/'
          ? current.presentation.pages.find((page) => page.path === '/about')
          : undefined
      const aboutExport = aboutOwner
        ? extractComposedAbout(
            nativeExport.html,
            nativeExport.css,
            aboutOwner.content[current.lang].html,
          )
        : null
      const exported = stripComposedCanvas(nativeExport.html, nativeExport.css, composedScene)
      const fragment = pageFragment(exported.html, wrapperId)
      const persisted = {
        // A created page stores only its body; the live header is rendered, never saved.
        html: isSitePage(current.page) ? sitePageBody(fragment) : fragment,
        css: canonicalizeCmsRootStyles(exported.css, wrapperId),
      }
      next.content[current.lang] = {
        html: persisted.html,
        css: {
          ...baseVariant.css,
          [current.mode]: persisted.css,
        },
      }
      next = syncPageLayout(current.page, next, current.lang, current.mode)
      persisted.css = next.content[current.lang].css[current.mode]
      const pages = [next]
      if (aboutOwner && aboutExport) {
        const about = structuredClone(aboutOwner)
        const before = about.content[current.lang]
        about.content[current.lang] = {
          html: aboutExport.html,
          css: {
            ...before.css,
            [current.mode]: aboutExport.css,
          },
        }
        pages.push(syncPageLayout(aboutOwner, about, current.lang, current.mode))
      }
      const updatedPresentation = {
        ...current.presentation,
        pages: current.presentation.pages.map(
          (page) => pages.find((update) => update.id === page.id) ?? page,
        ),
      }
      rendered.current = {
        pageId: current.page.id,
        device: current.device,
        scene: current.scene,
        key: editorContextKey(
          { ...current, presentation: updatedPresentation },
          latestChrome.current,
        ),
        chrome: latestChrome.current,
        ...persisted,
      }
      current.onChange(pages)
      checkpoint.current = { html, css }
      editor.clearDirtyCount()
    }
    const schedule = (): void => {
      if (applying.current) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 180)
    }
    flushCanvas.current = flush
    // Synchronous notification catches immediate edit-then-switch, without delayed
    // import updates scheduling another export after applying has finished.
    editor.on('updateBefore', schedule)
    editor.Commands.add('tlb-clone', { run: () => duplicate() })
    const fit = (): void => {
      const zoom = fitEditor(editor)
      if (zoom === undefined) return
      latest.current.onZoom(zoom)
      const device = editor.Devices.getSelected()
      const frame = editor.Canvas.getWindow()
      if (
        changingDevice.current &&
        latest.current.active &&
        !latest.current.locked &&
        device &&
        frame.innerWidth === parseFloat(device.get('width') ?? '') &&
        frame.innerHeight === parseFloat(device.get('height') ?? '')
      ) {
        changingDevice.current = false
        // GrapesJS pauses selection for its former 350ms animation. Our viewport
        // is already final; resume its normal command now instead of dropping clicks.
        editor.getModel().runDefault({ preserveSelected: 1 })
      }
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
      pending: () => timer.current !== null,
      fit: () => fitEditor(editor),
    })
    performance.measure('cms:startup:work', { start, end: performance.now() })

    return () => {
      // Destruction mutates components too; it must not queue a capture against a dead editor.
      editor.off('updateBefore', schedule)
      cancelAboutIdle.current?.()
      startup.current = null
      deferredAbout.current = null
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      props.onReady(null)
      resize.disconnect()
      releaseAccessibility?.()
      releaseResourcePicker()
      releaseResize()
      releaseTextHeight()
      releaseCanvasStyles()
      window.removeEventListener('keydown', keydown)
      editor.destroy()
      instance.current = null
    }
  }, [])

  // Flush + undo can restore identical props in one render while the canvas has changed.
  // Compare against the last rendered document on every render, not only changed dependencies.
  useLayoutEffect(() => {
    const editor = instance.current
    if (!editor || !props.active) return
    const previous = rendered.current
    if (
      previous?.key === contextKey &&
      previous.html === variant.html &&
      previous.css === variant.css[props.mode]
    )
      return
    if (
      sitePage &&
      previous &&
      previous.key === editorContextKey(props, previous.chrome) &&
      previous.html === variant.html &&
      previous.css === variant.css[props.mode]
    ) {
      // Metadata can change a menu label without changing the authored canvas. Do not cancel
      // pending body edits or clear selection just to update the read-only header.
      applying.current = true
      const reused = updateSiteHeader(editor, chrome)
      if (reused) lockSiteHeader(editor)
      applying.current = false
      if (reused) {
        rendered.current = { ...previous, key: contextKey, chrome }
        if (timer.current === null)
          checkpoint.current = {
            html: editor.getHtml({ cleanId: false }),
            css: readCanvasCss(editor),
          }
        editor.clearDirtyCount()
        return
      }
    }
    if (
      !previous &&
      startup.current?.key === contextKey &&
      startup.current.html === variant.html &&
      startup.current.css === variant.css[props.mode]
    )
      return
    if (previous) viewStates.current.set(previous.pageId, captureViewState(editor))
    const previousState = viewStates.current.get(props.page.id)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    applying.current = true
    if (
      previous &&
      previous.key ===
        editorContextKey({ ...props, device: previous.device, scene: previous.scene }, chrome) &&
      previous.html === variant.html &&
      previous.css === variant.css[props.mode] &&
      ((props.page.path === '/' &&
        previous.device !== props.device &&
        (materializeAbout(), moveHomeAbout(editor, props.device))) ||
        (props.page.path === '/booking' &&
          (previous.scene !== props.scene || previous.device !== props.device) &&
          moveBookingScene(editor, props.scene, props.device)))
    ) {
      editor.select()
      setSelected(null)
      rendered.current = { ...previous, device: props.device, scene: props.scene, key: contextKey }
      checkpoint.current = { html: editor.getHtml({ cleanId: false }), css: readCanvasCss(editor) }
      applying.current = false
      editor.clearDirtyCount()
      if (previousState) restoreViewState(editor, previousState)
      return
    }
    const deferAbout = props.page.path === '/' && !aboutPreviewBuilt.current
    cancelAboutIdle.current?.()
    deferredAbout.current = null
    host.current?.removeAttribute('data-cms-about-preview-ready')
    const request = { key: contextKey, html: variant.html, css: variant.css[props.mode] }
    startup.current = request
    // Only the first, empty canvas loads asynchronously. Subsequent context changes remain
    // atomic with Studio's synchronous flush, so an edit can never land in the wrong language.
    const initial = !previous
    const measure = <T,>(pass: () => T): T => {
      const start = performance.now()
      try {
        return pass()
      } finally {
        if (initial) performance.measure('cms:startup:work', { start, end: performance.now() })
      }
    }
    const load = function* (): Generator<void> {
      const wrapperId = editor.getWrapper()?.getId() ?? ''
      let compilation = compiled.current.find(
        (item) =>
          item.key === contextKey &&
          item.sourceHtml === variant.html &&
          item.sourceCss === variant.css[props.mode] &&
          item.deferAbout === deferAbout &&
          item.wrapperId === wrapperId,
      )
      if (!compilation) {
        const site = sitePage
          ? renderSitePage(props.presentation, props.page, props.lang, props.mode, contact)
          : null
        let content: ComposedCanvasTree
        if (site) content = { html: site.html, sheet: parseCanvasSheet(site.css[props.mode]) }
        else {
          const passes = composedCanvasPasses(
            props.page,
            props.presentation,
            props.lang,
            props.mode,
            props.scene,
            props.device,
            deferAbout,
          )
          let step = passes.next()
          while (!step.done) {
            yield
            step = passes.next()
          }
          content = step.value
        }
        yield
        compilation = {
          key: contextKey,
          sourceHtml: variant.html,
          sourceCss: variant.css[props.mode],
          wrapperId,
          deferAbout,
          content: {
            html: content.html,
            ...(content.aboutPreview ? { aboutPreview: content.aboutPreview } : {}),
          },
          rules: parseCanvasCss(bindCmsRootStyles(content.sheet, wrapperId), editor),
        }
        // Four recent contexts cover language/theme roundtrips without retaining
        // whole draft histories. The exact source strings also invalidate undo and edits.
        compiled.current.unshift(compilation)
        compiled.current.length = Math.min(4, compiled.current.length)
      }
      yield
      const { content } = compilation
      // GrapesJS owns its imported definitions; never hand it the cached originals.
      const rules = structuredClone(compilation.rules)
      editor.select()
      setSelected(null)
      const reused =
        previous?.pageId === props.page.id &&
        previous.device === props.device &&
        updateNativeCanvas(editor, content.html, rules)
      if (!reused) {
        // Structural imports still remove old IDs before installing their replacement rules.
        editor.setComponents('')
        // Definitions are already parsed. Reset once instead of inserting each rule into the live frame.
        editor.Css.getAll().reset(rules)
        yield
        editor.setComponents(content.html)
      }
      yield
      const configure = (component: Component): void => {
        // SVG layerability changes otherwise rerender the same parent subtree per node.
        configureComponent(component, { silent: true })
        component.components().forEach(configure)
      }
      if (!reused) editor.getWrapper()?.components().forEach(configure)
      // After the configure pass, which makes SVG parts selectable, on both import paths.
      if (sitePage) lockSiteHeader(editor)
      deferredAbout.current = content.aboutPreview ?? null
      // Layers and restored IDs may reach the inactive surface before idle completion.
      // The tab can change while the first load yields, so read the current request.
      if (latest.current.tab === 'layers' || previousState?.selectedId) materializeAbout()
      // Reuse the existing layer view once, with the complete policy already applied.
      if (latest.current.tab === 'layers') editor.Layers.getAll()?.render()
      // A created page's blocks belong in #cms-site-content: only its body is saved.
      editor
        .getWrapper()
        ?.set('droppable', !sitePage && !variant.html.includes('data-knc-native="1"'))
      rendered.current = {
        pageId: props.page.id,
        device: props.device,
        scene: props.scene,
        key: contextKey,
        chrome,
        html: variant.html,
        css: variant.css[props.mode],
      }
      checkpoint.current = {
        html: editor.getHtml({ cleanId: false }),
        css: readCanvasCss(editor),
      }
      applying.current = false
      editor.clearDirtyCount()
      if (previousState) restoreViewState(editor, previousState)
      if (deferredAbout.current)
        cancelAboutIdle.current = afterCanvasPaint(() => {
          try {
            materializeAbout()
          } catch (error) {
            setLoadError(error)
          }
        })
      else host.current?.setAttribute('data-cms-about-preview-ready', 'true')
      startup.current = null
      host.current?.setAttribute('data-cms-canvas-ready', 'true')
      setLoading(false)
      if (initial) performance.mark('cms:startup:ready')
    }
    const passes = load()
    if (!initial) {
      while (!passes.next().done) {
        /* Context switches finish in the same task. */
      }
      return
    }
    void (async () => {
      while (startup.current === request && instance.current === editor) {
        if (measure(() => passes.next()).done) return
        await yieldCanvasTask()
      }
    })().catch((error: unknown) => {
      if (startup.current === request && instance.current === editor) {
        applying.current = false
        setLoadError(error)
      }
    })
  })

  useLayoutEffect(() => {
    const editor = instance.current
    const container = layersHost.current
    if (!editor || !container || !props.active || props.tab !== 'layers') return
    let mounted = false
    const mount = (): void => {
      if (mounted || !editor.Layers.getRoot()) return
      materializeAbout()
      mounted = true
      container.replaceChildren(editor.Layers.render())
    }
    editor.on('load', mount)
    mount()
    return () => {
      // Editor destruction already disposes module views and listeners.
      if (instance.current !== editor) return
      editor.off('load', mount)
      if (mounted) editor.Layers.destroy()
    }
  }, [props.tab, props.active])

  useLayoutEffect(() => {
    const host = compareHost.current
    if (!host) return
    const resize = (): void =>
      setCompareScale(
        Math.min(1, host.clientWidth / compareWidth, host.clientHeight / compareHeight),
      )
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [props.compare, props.locked, compareWidth, compareHeight])

  useEffect(() => {
    const editor = instance.current
    if (!editor || !props.active) return
    const css = props.fontCss + siteThemeCss(props.presentation, props.mode)
    // A frame load replaces the document, so the sheet is written again into each new head.
    const apply = (): void => {
      const frame = editor.Canvas.getDocument()
      if (!frame) return
      let style = frame.getElementById('cms-uploaded-fonts') as HTMLStyleElement | null
      if (!style) {
        style = frame.createElement('style')
        style.id = 'cms-uploaded-fonts'
        frame.head.appendChild(style)
      }
      style.textContent = css
    }
    apply()
    editor.on('canvas:frame:load:head', apply)
    return () => {
      editor.off('canvas:frame:load:head', apply)
    }
  }, [props.active, props.fontCss, props.presentation.themes, props.mode])

  useEffect(() => {
    const editor = instance.current
    if (!editor || !props.active) return
    // A created page sits on the token base and SITE_PAGE_CSS the Worker inlines, in the edited
    // scheme, so the tokens follow Ljus/Mörk rather than the editor's OS.
    const base = canvasBase
    // The canvas model's `styles` never reaches a rendered frame, so the links are kept in the frame
    // head directly. Every frame load replaces the document, not only the editor's first one, so the
    // base is applied again once GrapesJS has rendered the new head (before `load:head` it is empty).
    const apply = (): void => {
      const frame = editor.Canvas.getDocument()
      if (!frame) return
      frame.documentElement.style.colorScheme = base.scheme
      const siteStyle = frame.querySelector('style[data-cms-site-base]')
      if (!sitePage) siteStyle?.remove()
      else if (!siteStyle) {
        const style = frame.createElement('style')
        style.dataset['cmsSiteBase'] = ''
        style.textContent = SITE_PAGE_CSS
        frame.head.appendChild(style)
      }
      const linked = [...frame.querySelectorAll('link[data-cms-legal-base]')]
      if (linked.map((link) => link.getAttribute('href')).join() === base.styles.join()) return
      linked.forEach((link) => link.remove())
      for (const href of base.styles) {
        const link = frame.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.dataset['cmsLegalBase'] = ''
        frame.head.appendChild(link)
      }
    }
    apply()
    editor.on('canvas:frame:load:head', apply)
    return () => {
      editor.off('canvas:frame:load:head', apply)
    }
  }, [props.active, canvasBase, sitePage])

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
    if (!editor || !props.active) return
    editor.getConfig().mediaCondition = props.device === 'Desktop' ? 'min-width' : 'max-width'
    const device = canvasDevice(props.device, props.narrowDesktop && !props.locked)
    changingDevice.current ||= editor.getDevice() !== device
    editor.setDevice(device)
    // Before the frame exists, the editor's load handler fits it.
    const zoom = fitEditor(editor)
    if (zoom !== undefined) latest.current.onZoom(zoom)
  }, [props.active, props.device, props.narrowDesktop, props.locked])

  useEffect(() => {
    const editor = instance.current
    if (!editor) return
    editor.Canvas.setZoom(props.zoom)
  }, [props.zoom])

  useLayoutEffect(() => {
    const editor = instance.current
    return editor && props.active ? canvasBehavior(editor, props.scene, props.mode) : undefined
  }, [props.active, props.mode, props.scene])

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
      !openResourcePicker(editor, component, props.draft, props.onOpenResources, setImageTarget)
    )
      props.onError('Välj en redigerbar bild först.')
  }
  const closePicker = (): void => {
    setImageTarget(null)
    instance.current?.AssetManager.close()
  }
  const pickImage = (asset: CmsAsset): void => {
    if (!imageTarget || isReadOnlyPreview(imageTarget)) return
    const src = mediaUrl(asset, SUPABASE_URL ?? '')
    const attrs = imageTarget.getAttributes()
    const alt = String(attrs['alt'] ?? attrs['aria-label'] ?? asset.alt)
    if (String(imageTarget.get('tagName')).toLowerCase() === 'svg') {
      // Replace presentation only. The enclosing native component retains its identity and logic.
      if (!canReplaceResourceGraphic(imageTarget)) return
      const retained = Object.fromEntries(
        Object.entries(attrs).filter(
          ([name]) =>
            [
              'id',
              'class',
              'title',
              'aria-label',
              'aria-hidden',
              'role',
              'width',
              'height',
            ].includes(name) || name.startsWith('data-knc-'),
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

  if (loadError) throw loadError
  return (
    <>
      <div
        class="cms-editor-canvas"
        data-device={props.device}
        inert={props.inspectorModal || loading}
        aria-busy={loading}
        ref={host}
        style={{ visibility: props.locked || loading ? 'hidden' : 'visible' }}
      />
      {props.locked && props.preview && (
        <LivePreview
          scene={props.scene}
          page={props.page}
          presentation={props.preview}
          {...(props.draft ? { draft: props.draft } : {})}
          lang={props.lang}
          mode={props.mode}
          device={props.device}
          fontCss={props.fontCss}
          onNavigate={props.onNavigate}
        />
      )}
      {comparison && !props.locked && (
        <div class="cms-compare-pane" inert={props.inspectorModal}>
          <div class="cms-compare-label">
            Jämför · {props.device === 'Desktop' ? '390' : '1440'}
          </div>
          <div ref={compareHost} class="cms-compare-viewport">
            <div
              style={{
                width: `${compareWidth * compareScale}px`,
                height: `${compareHeight * compareScale}px`,
              }}
            >
              <iframe
                title="Jämförelsevy"
                sandbox="allow-same-origin"
                style={{
                  width: `${compareWidth}px`,
                  height: `${compareHeight}px`,
                  transform: `scale(${compareScale})`,
                  transformOrigin: 'top left',
                }}
                srcDoc={`<!doctype html><html lang="${props.lang}"${canvasBase.scheme ? ` style="color-scheme:${canvasBase.scheme}"` : ''}><head>${canvasBase.styles.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}<style>html,body{margin:0}${props.fontCss}${siteThemeCss(props.presentation, props.mode)}${comparison.css}${sceneVisibilityCss(props.scene, props.mode)}${canvasScrollCss}</style></head><body>${comparison.html}</body></html>`}
              />
            </div>
          </div>
        </div>
      )}
      <aside
        id="cms-inspector"
        class="cms-inspector"
        aria-label="Egenskaper"
        role={props.inspectorModal ? 'dialog' : undefined}
        aria-modal={props.inspectorModal ? true : undefined}
        tabIndex={-1}
        inert={props.locked}
      >
        <div class="cms-inspector-heading">
          <strong>Egenskaper</strong>
          <button
            type="button"
            class="cms-page-settings"
            onClick={() => {
              instance.current?.select()
              setSelected(null)
              props.onTab('design')
            }}
          >
            Sidinställningar
          </button>
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
          tabIndex={0}
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
              Det här innehållet delas med Om oss. Ändringar där visas också här.
              <button type="button" onClick={() => props.onOpenPage('/about')}>
                Redigera Om oss
              </button>
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
                  {canReplaceResourceGraphic(selected) && (
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
              {sitePage && (
                <p class="cms-lock-note">
                  Sidhuvudet med logotyp och meny följer startsidan.
                  <button type="button" onClick={() => props.onOpenPage('/')}>
                    Redigera sidhuvud
                  </button>
                </p>
              )}
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
                  materializeAbout()
                  const property = advancedProperty.trim()
                  const value = advancedValue.trim()
                  if (
                    !/^(?:--)?[a-z][a-z0-9-]*$/.test(property) ||
                    (value && !CSS.supports(property, value))
                  )
                    return props.onError('CSS-egenskapen eller värdet stöds inte av webbläsaren.')
                  // Shorthands such as flex or all expand into the longhands the marquee owns.
                  const expanded = document.createElement('span').style
                  expanded.setProperty(property, value)
                  const role = runtimeOwnedRole(
                    selected.getAttributes(),
                    selected.parent()?.getAttributes(),
                  )
                  const denied = value
                    ? deniedProperty([property, ...Array.from(expanded)], role)
                    : undefined
                  if (denied)
                    return props.onError(
                      `CSS-egenskapen ${denied} styrs av den rörliga karusellen och kan inte ändras här.`,
                    )
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
          ref={layersHost}
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
