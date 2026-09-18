import { fontFaceCss, fontOptions } from '../../../shared/cms-fonts'
import type { CmsPresentation } from '../../../shared/cms'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import grapesjs, { type Editor, type Component } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import { validateMarkup } from '../../../shared/cms-markup'
import { CMS_BUILT_ASSETS } from '../../../shared/cms-built-assets'
import { SUPABASE_URL } from '../../backend/config'
import type { CmsMode, PageVariant } from '../../../shared/cms'
import { nudgeComponent, resetComponentPosition } from './position'

interface LiveView {
  el: HTMLElement
  model: Component
  getChildrenContainer: () => HTMLElement
}
export interface AuthoredControls {
  flush: () => void
  selectImage: (src: string, alt: string) => void
  nudge: (dx: number, dy: number, step?: number) => boolean
  resetPosition: () => boolean
  remove: () => void
}
interface Props {
  identity: string
  presentation: CmsPresentation
  variant: PageVariant
  mode: CmsMode
  width: number
  zoom: number
  locked: boolean
  onChange: (variant: PageVariant, group?: string) => void
  onReady: (controls: AuthoredControls | null) => void
  onError: (message: string) => void
  pickImage: () => void
}
function cleanEditorHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const element of parsed.body.querySelectorAll('*')) {
    for (const attr of [...element.attributes])
      if (
        attr.name.startsWith('data-gjs-') ||
        ['contenteditable', 'draggable', 'data-cms-capture'].includes(attr.name)
      )
        element.removeAttribute(attr.name)
    for (const name of [...element.classList])
      if (name.startsWith('gjs-')) element.classList.remove(name)
  }
  return parsed.body.innerHTML
}
function liveHtml(editor: Editor, view: LiveView | null): string {
  const wrapper = editor.getWrapper()
  if (!wrapper) return ''
  if (!view?.el.isConnected) return cleanEditorHtml(wrapper.getInnerHTML())
  const html = wrapper.getInnerHTML({
    attributes(component, attributes) {
      return component === view.model ? { ...attributes, 'data-cms-capture': '' } : attributes
    },
  })
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const target = parsed.querySelector('[data-cms-capture]')
  if (target)
    target.replaceChildren(
      ...[...view.getChildrenContainer().childNodes].map((node) => node.cloneNode(true)),
    )
  return cleanEditorHtml(parsed.body.innerHTML)
}
export function AuthoredEditor(props: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<Editor | null>(null),
    live = useRef<LiveView | null>(null)
  const current = useRef(props)
  current.current = props
  const applying = useRef(false),
    emitted = useRef(''),
    appliedSource = useRef(''),
    [tab, setTab] = useState('style')
  const fontCss = fontFaceCss(props.presentation, SUPABASE_URL ?? 'https://unconfigured.invalid')
  const applyFonts = (): void => {
    const document = editor.current?.Canvas.getDocument()
    if (!document?.head) return
    let style = document.head.querySelector<HTMLStyleElement>('style[data-cms-fonts]')
    if (!style) {
      style = document.createElement('style')
      style.dataset['cmsFonts'] = ''
      document.head.appendChild(style)
    }
    style.textContent = fontFaceCss(
      current.current.presentation,
      SUPABASE_URL ?? 'https://unconfigured.invalid',
    )
  }
  useEffect(applyFonts, [fontCss])
  useEffect(() => {
    if (!host.current) return
    const policy = {
      siteOrigin: location.origin,
      storageOrigin: new URL(SUPABASE_URL ?? 'https://unconfigured.invalid').origin,
      builtAssets: CMS_BUILT_ASSETS,
    }
    const gjs = grapesjs.init({
      container: host.current,
      height: '100%',
      width: 'auto',
      fromElement: false,
      storageManager: false,
      telemetry: false,
      noticeOnUnload: false,
      avoidInlineStyle: true,
      parser: {
        optionsHtml: { allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false },
      },
      canvas: {
        scripts: [],
        styles: [],
        frameContent: '<!doctype html><html><head></head><body></body></html>',
      },
      panels: { defaults: [] },
      selectorManager: { appendTo: '#cms-gjs-selectors', componentFirst: true },
      layerManager: { appendTo: '#cms-gjs-layers' },
      traitManager: { appendTo: '#cms-gjs-traits' },
      blockManager: { appendTo: '#cms-gjs-blocks' },
      styleManager: {
        appendTo: '#cms-gjs-styles',
        sectors: [
          {
            name: 'Layout',
            open: true,
            properties: [
              'display',
              'position',
              'width',
              'height',
              'max-width',
              'min-height',
              'flex-direction',
              'justify-content',
              'align-items',
              'gap',
              'grid-template-columns',
            ],
          },
          {
            name: 'Text',
            open: true,
            properties: [
              'font-family',
              'font-size',
              'font-weight',
              'line-height',
              'letter-spacing',
              'text-align',
              'color',
              'text-decoration',
            ],
          },
          { name: 'Avstånd', properties: ['margin', 'padding'] },
          {
            name: 'Utseende',
            properties: ['background-color', 'border', 'border-radius', 'box-shadow', 'opacity'],
          },
          {
            name: 'Position',
            properties: ['top', 'right', 'bottom', 'left', 'z-index', 'transform'],
          },
        ],
      },
      deviceManager: {
        devices: [
          { id: 'Desktop', name: 'Desktop', width: '' },
          { id: 'Mobile', name: 'Mobile', width: '390px', widthMedia: '768px' },
        ],
      },
    })
    editor.current = gjs
    for (const block of [
      { id: 'heading', label: 'Rubrik', content: '<h2>Ny rubrik</h2>' },
      { id: 'text', label: 'Text', content: '<p>Skriv texten här.</p>' },
      {
        id: 'section',
        label: 'Sektion',
        content:
          '<section style="padding:32px"><h2>Ny sektion</h2><p>Skriv innehållet här.</p></section>',
      },
      {
        id: 'columns',
        label: 'Två kolumner',
        content:
          '<div style="display:flex;flex-wrap:wrap;gap:24px"><section style="flex:1;min-width:220px;padding:24px"><h2>Kolumn ett</h2><p>Innehåll</p></section><section style="flex:1;min-width:220px;padding:24px"><h2>Kolumn två</h2><p>Innehåll</p></section></div>',
      },
      {
        id: 'link',
        label: 'Länk',
        content:
          '<a href="/" style="display:inline-block;padding:14px 20px;border:1px solid currentColor;border-radius:8px">Till startsidan</a>',
      },
      { id: 'quote', label: 'Citat', content: '<blockquote><p>Ett citat.</p></blockquote>' },
      { id: 'divider', label: 'Avdelare', content: '<hr>' },
    ])
      gjs.BlockManager.add(block.id, { label: block.label, content: block.content })
    let inputDocument: Document | null = null,
      scheduled: number | null = null
    const flush = (): void => {
      if (applying.current || !gjs.getWrapper()) return
      try {
        const html = liveHtml(gjs, live.current)
        const css = gjs.getCss({ keepUnusedStyles: true }) ?? ''
        const normalized = validateMarkup(html, css, policy)
        const next = {
          html: normalized.html,
          css: { ...current.current.variant.css, [current.current.mode]: css },
        }
        const key = JSON.stringify(next)
        if (key !== emitted.current) {
          emitted.current = key
          appliedSource.current = `${current.current.identity}\0${current.current.mode}\0${key}`
          current.current.onChange(
            next,
            live.current ? `page-input:${current.current.identity}` : '',
          )
        }
      } catch (error) {
        current.current.onError(error instanceof Error ? error.message : 'Sidändringen avvisades.')
      }
    }
    const schedule = (): void => {
      if (scheduled !== null) cancelAnimationFrame(scheduled)
      scheduled = requestAnimationFrame(() => {
        scheduled = null
        flush()
      })
    }
    const enable = (value: unknown): void => {
      if (
        value &&
        typeof value === 'object' &&
        'el' in value &&
        'model' in value &&
        'getChildrenContainer' in value
      )
        live.current = value as LiveView
    }
    const disable = (): void => {
      flush()
      live.current = null
    }
    const hardenFrame = (): void => {
      const frame =
        gjs.Canvas.getFrameEl() ??
        host.current?.querySelector<HTMLIFrameElement>('iframe.gjs-frame') ??
        null
      frame?.setAttribute('sandbox', 'allow-same-origin')
    }
    const frameLoaded = (): void => {
      hardenFrame()
      applyFonts()
      inputDocument?.removeEventListener('input', schedule, true)
      inputDocument = gjs.Canvas.getDocument()
      inputDocument?.addEventListener('input', schedule, true)
    }
    gjs.on('rte:enable', enable)
    gjs.on('rte:disable', disable)
    gjs.on('update', schedule)
    gjs.on('canvas:frame', hardenFrame)
    gjs.on('canvas:frame:load', frameLoaded)
    hardenFrame()
    gjs.on('asset:open', () => {
      gjs.AssetManager.close()
      current.current.pickImage()
    })
    props.onReady({
      flush,
      selectImage(src, alt) {
        const selected = gjs.getSelected()
        if (selected?.is('image')) selected.addAttributes({ src, alt })
        else
          gjs.getWrapper()?.append({
            tagName: 'img',
            attributes: { src, alt },
            style: { 'max-width': '100%', height: 'auto' },
          })
        flush()
      },
      nudge(dx, dy, step = 1) {
        const selected = gjs.getSelected()
        if (!selected || !nudgeComponent(selected, dx, dy, step)) return false
        flush()
        return true
      },
      resetPosition() {
        const selected = gjs.getSelected()
        if (!selected) return false
        const reset = resetComponentPosition(selected)
        if (reset) flush()
        return reset
      },
      remove() {
        const selected = gjs.getSelected()
        if (selected && selected !== gjs.getWrapper()) {
          selected.remove()
          flush()
        }
      },
    })
    return () => {
      if (scheduled !== null) cancelAnimationFrame(scheduled)
      flush()
      props.onReady(null)
      inputDocument?.removeEventListener('input', schedule, true)
      gjs.off('canvas:frame', hardenFrame)
      gjs.off('canvas:frame:load', frameLoaded)
      gjs.destroy()
      editor.current = null
      live.current = null
    }
  }, [])
  useEffect(() => {
    const gjs = editor.current
    if (!gjs) return
    const sourceKey = JSON.stringify(props.variant)
    const prefix = `${props.identity}\0${props.mode}\0`
    const targetKey = prefix + sourceKey
    if (appliedSource.current === targetKey) return
    if (sourceKey === emitted.current && appliedSource.current.startsWith(prefix)) {
      appliedSource.current = targetKey
      return
    }
    try {
      const policy = {
        siteOrigin: location.origin,
        storageOrigin: new URL(SUPABASE_URL ?? 'https://unconfigured.invalid').origin,
        builtAssets: CMS_BUILT_ASSETS,
      }
      const normalized = validateMarkup(props.variant.html, props.variant.css[props.mode], policy)
      applying.current = true
      live.current = null
      gjs.setComponents(normalized.html)
      gjs.setStyle(props.variant.css[props.mode])
      gjs.UndoManager.clear()
      const html = liveHtml(gjs, null)
      const css = gjs.getCss({ keepUnusedStyles: true }) ?? ''
      const editorState = validateMarkup(html, css, policy)
      emitted.current = JSON.stringify({
        html: editorState.html,
        css: { ...props.variant.css, [props.mode]: css },
      })
      appliedSource.current = targetKey
    } catch (error) {
      props.onError(error instanceof Error ? error.message : 'Sidan kunde inte läsas.')
    } finally {
      applying.current = false
    }
  }, [props.identity, props.variant, props.mode])
  useEffect(() => {
    const gjs = editor.current
    if (!gjs) return
    const name = props.width <= 768 ? 'Mobile' : 'Desktop'
    gjs.DeviceManager.get(name)?.set('width', `${props.width}px`)
    gjs.setDevice(name)
    gjs.Canvas.setZoom(props.zoom)
  }, [props.width, props.zoom])
  useEffect(() => {
    const gjs = editor.current
    if (!gjs) return
    if (props.locked) gjs.runCommand('preview')
    else gjs.stopCommand('preview')
  }, [props.locked])
  const moveSelected = (dx: number, dy: number, step: number): void => {
    const selected = editor.current?.getSelected()
    if (!selected) {
      props.onError('Välj ett element först.')
      return
    }
    if (!nudgeComponent(selected, dx, dy, step))
      props.onError('Det valda elementet kan inte flyttas säkert.')
  }
  const resetSelectedPosition = (): void => {
    const selected = editor.current?.getSelected()
    if (!selected) {
      props.onError('Välj ett element först.')
      return
    }
    if (!resetComponentPosition(selected))
      props.onError('Det valda elementet har ingen flytt att återställa.')
  }
  return (
    <div class="cms-authored-layout">
      <div class="cms-authored-canvas" ref={host} />
      <aside class="cms-authored-inspector">
        <label>
          Tilldela typsnitt{' '}
          <select
            aria-label="Tilldela typsnitt"
            value=""
            onChange={(event) => {
              const component = editor.current?.getSelected()
              if (!component) {
                props.onError('Välj ett textlager först.')
                return
              }
              const value = event.currentTarget.value
              if (value) component.addStyle({ 'font-family': value })
              else component.removeStyle('font-family')
            }}
          >
            {fontOptions(props.presentation).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div class="cms-segment">
          {[
            ['style', 'Egenskaper'],
            ['layers', 'Lager'],
            ['blocks', 'Block'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={tab === key}
              onClick={() => setTab(key ?? 'style')}
            >
              {label}
            </button>
          ))}
        </div>
        <div hidden={tab !== 'style'}>
          <div id="cms-gjs-selectors" />
          <div id="cms-gjs-traits" />
          <div id="cms-gjs-styles" />
          <div class="cms-segment" aria-label="Flytta valt element">
            <button
              type="button"
              aria-label="Flytta vänster"
              title="1 px · Shift + klick = 10 px"
              disabled={props.locked}
              onClick={(event) => moveSelected(-1, 0, event.shiftKey ? 10 : 1)}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Flytta uppåt"
              title="1 px · Shift + klick = 10 px"
              disabled={props.locked}
              onClick={(event) => moveSelected(0, -1, event.shiftKey ? 10 : 1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Flytta nedåt"
              title="1 px · Shift + klick = 10 px"
              disabled={props.locked}
              onClick={(event) => moveSelected(0, 1, event.shiftKey ? 10 : 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Flytta höger"
              title="1 px · Shift + klick = 10 px"
              disabled={props.locked}
              onClick={(event) => moveSelected(1, 0, event.shiftKey ? 10 : 1)}
            >
              →
            </button>
            <button type="button" disabled={props.locked} onClick={resetSelectedPosition}>
              Återställ flytt
            </button>
          </div>
          <p class="cms-help">
            Flytta 1 px per klick. Håll Shift för 10 px. Rotation, skala och andra transformeringar
            bevaras.
          </p>
        </div>
        <div id="cms-gjs-layers" hidden={tab !== 'layers'} />
        <div id="cms-gjs-blocks" hidden={tab !== 'blocks'} />
        <button type="button" onClick={props.pickImage}>
          Lägg till bild från biblioteket
        </button>
        <p class="cms-help">
          Dra block till sidan, dubbelklicka för text och använd lagerpanelen för ordning.
          Innehållet valideras igen på servern före publicering.
        </p>
      </aside>
    </div>
  )
}
