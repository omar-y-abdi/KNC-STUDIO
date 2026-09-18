import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { CmsDocument, CmsLang, CmsMode } from '../../../shared/cms'
import { contentValue } from './catalog'
import type { CanvasNode, NativeSurface, PreviewSnapshot } from './Preview'

interface Props {
  document: CmsDocument
  lang: CmsLang
  mode: CmsMode
  surface: NativeSurface
  width: number
  zoom: number
  locked: boolean
  selected: string | null
  selectionRequest: string | null
  onSelect: (node: CanvasNode) => void
  onNodes: (nodes: CanvasNode[]) => void
  onText: (binding: string, value: string) => void
  onLang: (lang: CmsLang) => void
  onMode: (mode: CmsMode) => void
  onShortcut: (key: string, shift: boolean) => void
  onError: (message: string) => void
}
function isNode(value: unknown): value is CanvasNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  return (
    typeof node['id'] === 'string' &&
    typeof node['tag'] === 'string' &&
    typeof node['label'] === 'string' &&
    (node['binding'] === null || typeof node['binding'] === 'string') &&
    typeof node['image'] === 'boolean' &&
    !!node['rect'] &&
    typeof node['rect'] === 'object' &&
    ['x', 'y', 'width', 'height'].every(
      (key) =>
        typeof (node['rect'] as Record<string, unknown>)[key] === 'number' &&
        Number.isFinite((node['rect'] as Record<string, unknown>)[key]),
    )
  )
}
export function NativeCanvas(props: Props): JSX.Element {
  const [channel] = useState(() => crypto.randomUUID()),
    [ready, setReady] = useState(false),
    [editing, setEditing] = useState<CanvasNode | null>(null)
  const frame = useRef<HTMLIFrameElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    outer = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const send = (type: string, extra: Record<string, unknown> = {}): void =>
    frame.current?.contentWindow?.postMessage(
      { source: 'knc-cms-studio', channel, type, ...extra },
      location.origin,
    )
  const snapshot = (): PreviewSnapshot => ({
    document: latest.current.document,
    lang: latest.current.lang,
    mode: latest.current.mode,
    surface: latest.current.surface,
    locked: latest.current.locked,
    selected: latest.current.selected,
  })
  useEffect(() => {
    const receive = (event: MessageEvent): void => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        !event.data ||
        typeof event.data !== 'object'
      )
        return
      const data = event.data as Record<string, unknown>
      if (data['source'] !== 'knc-cms-preview' || data['channel'] !== channel) return
      if (data['type'] === 'ready') {
        setReady(true)
        send('snapshot', { payload: snapshot() })
      }
      if ((data['type'] === 'select' || data['type'] === 'edit') && isNode(data['payload'])) {
        latest.current.onSelect(data['payload'])
        setEditing(data['type'] === 'edit' && data['payload'].binding ? data['payload'] : null)
      }
      if (data['type'] === 'bounds' && isNode(data['payload']))
        setEditing((current) =>
          current && current.id === (data['payload'] as CanvasNode).id
            ? (data['payload'] as CanvasNode)
            : current,
        )
      if (
        data['type'] === 'nodes' &&
        Array.isArray(data['payload']) &&
        data['payload'].length <= 2500 &&
        data['payload'].every(isNode)
      )
        latest.current.onNodes(data['payload'])
      if (data['type'] === 'lang' && (data['payload'] === 'sv' || data['payload'] === 'en'))
        latest.current.onLang(data['payload'])
      if (data['type'] === 'mode' && (data['payload'] === 'dark' || data['payload'] === 'light'))
        latest.current.onMode(data['payload'])
      if (data['type'] === 'error' && typeof data['payload'] === 'string')
        latest.current.onError(data['payload'])
      if (
        data['type'] === 'shortcut' &&
        data['payload'] &&
        typeof data['payload'] === 'object' &&
        'key' in data['payload'] &&
        typeof data['payload'].key === 'string'
      )
        latest.current.onShortcut(
          data['payload'].key,
          'shift' in data['payload'] && data['payload'].shift === true,
        )
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [channel])
  useEffect(() => {
    if (ready) send('snapshot', { payload: snapshot() })
  }, [ready, props.document, props.lang, props.mode, props.surface, props.locked, props.selected])
  useEffect(() => {
    if (ready && props.selectionRequest)
      send('select', { id: props.selectionRequest.split('|')[0] })
  }, [ready, props.selectionRequest])
  useEffect(() => {
    setEditing(null)
  }, [props.surface, props.lang, props.locked])
  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing?.id])
  const scale = props.zoom / 100
  const rect = frame.current?.getBoundingClientRect(),
    parent = outer.current?.getBoundingClientRect()
  const editStyle =
    editing && rect && parent
      ? {
          left: rect.left - parent.left + editing.rect.x * scale,
          top: rect.top - parent.top + editing.rect.y * scale,
          width: Math.max(140, editing.rect.width * scale),
          minHeight: Math.max(50, editing.rect.height * scale),
          fontSize: `${parseFloat(editing.styles['fontSize'] || '16') * scale}px`,
          lineHeight: '1.35',
        }
      : undefined
  return (
    <div class="cms-native-canvas" ref={outer}>
      {!ready && (
        <p class="cms-frame-loading" role="status">
          Laddar den autentiserade förhandsvisningen…
        </p>
      )}
      <div class="cms-frame-sizing" style={{ width: props.width * scale, height: 920 * scale }}>
        <iframe
          ref={frame}
          title={`${props.surface} · ${props.lang.toUpperCase()} · ${props.mode}`}
          src={`/admin/cms/preview/?channel=${channel}`}
          onLoad={() => send('ping')}
          style={{
            width: props.width,
            height: 920,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
      {editing?.binding && (
        <textarea
          ref={input}
          class="cms-inline-editor"
          aria-label={`Redigera ${editing.label}`}
          style={editStyle}
          value={contentValue(props.document, editing.binding, props.lang)}
          onInput={(event) => {
            if (editing.binding) props.onText(editing.binding, event.currentTarget.value)
          }}
          onBlur={() => setEditing(null)}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' ||
              (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
            ) {
              event.preventDefault()
              setEditing(null)
            }
          }}
        />
      )}
    </div>
  )
}
