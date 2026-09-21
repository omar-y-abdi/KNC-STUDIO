import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { CmsLang, CmsMode, CmsPage, CmsPresentation } from '../../../shared/cms'
import { nativeCanvas } from './nativeCanvas'

/** Isolated, read-only native runtime, using the same validated draft as publication. */
export function LivePreview({
  page,
  presentation,
  lang,
  mode,
  device,
  fontCss,
}: {
  page: CmsPage
  presentation: CmsPresentation
  lang: CmsLang
  mode: CmsMode
  device: 'Desktop' | 'Mobile'
  fontCss: string
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [connected, setConnected] = useState(0)
  const [scale, setScale] = useState(1)
  const width = device === 'Desktop' ? 1440 : 390
  const height = device === 'Desktop' ? 900 : 844
  const native = ['/', '/about', '/booking', '/my-bookings'].includes(page.path)
  useLayoutEffect(() => {
    const target = host.current
    if (!target) return
    const fit = (): void =>
      setScale(
        Math.max(
          0.1,
          Math.min(1, (target.clientWidth - 24) / width, (target.clientHeight - 24) / height),
        ),
      )
    const resize = new ResizeObserver(fit)
    resize.observe(target)
    fit()
    return () => resize.disconnect()
  }, [width, height])
  useLayoutEffect(() => {
    const receive = (event: MessageEvent): void => {
      if (
        event.origin === location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === 'knc-preview-listening'
      )
        setConnected((value) => value + 1)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  useEffect(() => {
    if (!connected || !native) return
    frame.current?.contentWindow?.postMessage(
      {
        type: 'knc-source-context',
        id: crypto.randomUUID(),
        lang,
        mode,
        device,
        path: page.path,
        presentation,
        scene:
          page.path === '/booking'
            ? 'booking'
            : page.path === '/my-bookings'
              ? 'my-bookings'
              : 'home',
      },
      location.origin,
    )
  }, [connected, native, page.path, presentation, lang, mode, device])
  const content = native ? null : nativeCanvas(page.content[lang], mode)
  return (
    <div ref={host} class="cms-live-preview">
      <div style={{ width: `${width * scale}px`, height: `${height * scale}px` }}>
        <iframe
          key={native ? 'native' : page.id}
          ref={frame}
          title="Förhandsvisning av sidan"
          sandbox={native ? 'allow-scripts allow-same-origin' : ''}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          {...(content
            ? {
                srcDoc: `<!doctype html><html lang="${lang}"><head><style>${fontCss}${content.css}</style></head><body>${content.html}</body></html>`,
              }
            : { src: '/cms-public/source?preview=1' })}
        />
      </div>
    </div>
  )
}
