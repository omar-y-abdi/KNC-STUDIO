import { siteThemeCss } from '../../../shared/site-theme'
import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { CmsLang, CmsMode, CmsPage, CmsPresentation } from '../../../shared/cms'
import { nativeCanvas } from './nativeCanvas'
import { isSitePage, renderSitePage } from '../../../shared/site-page'
import type { CmsScene } from '../../cms/Scene'

/** Isolated, read-only native runtime, using the same validated draft as publication. */
export function LivePreview({
  page,
  presentation,
  lang,
  mode,
  device,
  fontCss,
  onNavigate,
  scene = 'default',
}: {
  scene?: CmsScene
  page: CmsPage
  presentation: CmsPresentation
  lang: CmsLang
  mode: CmsMode
  device: 'Desktop' | 'Mobile'
  fontCss: string
  onNavigate: (path: string, lang: CmsLang, mode: CmsMode) => void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [connected, setConnected] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hasContent, setHasContent] = useState(false)
  const request = useRef('')
  const deadline = useRef<ReturnType<typeof setTimeout>>()
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
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return
      if (
        event.data?.id === request.current &&
        (event.data.type === 'knc-preview-ready' || event.data.type === 'knc-preview-error')
      ) {
        clearTimeout(deadline.current)
        const ready = event.data.type === 'knc-preview-ready'
        setStatus(ready ? 'ready' : 'error')
        if (ready) setHasContent(true)
        return
      }
      if (
        event.data?.type === 'knc-preview-page' &&
        presentation.pages.some((item) => item.path === event.data.path)
      ) {
        onNavigate(
          event.data.path,
          event.data.lang === 'en' ? 'en' : 'sv',
          event.data.mode === 'dark' ? 'dark' : 'light',
        )
        return
      }
      if (
        event.origin === location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === 'knc-preview-listening'
      )
        setConnected((value) => value + 1)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [presentation.pages, onNavigate])
  useEffect(() => {
    if (!native) return
    const id = crypto.randomUUID()
    request.current = id
    setStatus('loading')
    // Covers a frame that never boots as well as a native render that never settles.
    deadline.current = setTimeout(() => setStatus('error'), 22000)
    if (connected)
      frame.current?.contentWindow?.postMessage(
        {
          type: 'knc-source-context',
          id,
          lang,
          mode,
          device,
          path: page.path,
          presentation,
          scene:
            scene !== 'default'
              ? scene
              : page.path === '/booking'
                ? 'booking'
                : page.path === '/my-bookings'
                  ? 'my-bookings'
                  : 'home',
        },
        location.origin,
      )
    return () => clearTimeout(deadline.current)
  }, [connected, native, page.path, presentation, lang, mode, device, scene, attempt])
  const content = native
    ? null
    : isSitePage(page)
      ? renderSitePage(presentation, page, lang, mode)
      : nativeCanvas(page.content[lang], mode)
  return (
    <div ref={host} class="cms-live-preview" aria-busy={native && status === 'loading'}>
      <div
        inert={native && status !== 'ready'}
        style={{
          width: `${width * scale}px`,
          height: `${height * scale}px`,
          visibility: native && !hasContent ? 'hidden' : undefined,
        }}
      >
        <iframe
          key={native ? `native-${attempt}` : page.id}
          ref={frame}
          title="Förhandsvisning av sidan"
          sandbox={native ? 'allow-scripts allow-same-origin' : 'allow-same-origin'}
          onLoad={() => {
            if (native) return
            frame.current?.contentDocument?.addEventListener('click', (event) => {
              const target = event.target as Element | null
              const anchor = target?.closest?.('a')
              if (!anchor) return
              event.preventDefault()
              const url = new URL(anchor.getAttribute('href') ?? '', location.origin)
              if (
                url.origin !== location.origin ||
                !presentation.pages.some((item) => item.path === url.pathname)
              )
                return
              onNavigate(
                url.pathname,
                url.searchParams.get('lang') === 'en'
                  ? 'en'
                  : url.searchParams.get('lang') === 'sv'
                    ? 'sv'
                    : lang,
                url.searchParams.get('mode') === 'dark'
                  ? 'dark'
                  : url.searchParams.get('mode') === 'light'
                    ? 'light'
                    : mode,
              )
            })
          }}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          {...(content
            ? {
                srcDoc: `<!doctype html><html lang="${lang}"><head><style>${fontCss}${siteThemeCss(presentation, mode)}${content.css}</style></head><body>${content.html}</body></html>`,
              }
            : { src: '/cms-public/source?preview=1' })}
        />
      </div>
      {native && status !== 'ready' && (
        <div class="cms-preview-feedback" data-blocking={!hasContent || status === 'error'}>
          {status === 'loading' ? (
            <p role="status">
              {hasContent ? 'Uppdaterar förhandsvisning…' : 'Laddar förhandsvisning…'}
            </p>
          ) : (
            <>
              <p role="alert">Förhandsvisningen kunde inte laddas. Dina ändringar finns kvar.</p>
              <button
                type="button"
                onClick={() => {
                  setConnected(0)
                  setHasContent(false)
                  setStatus('loading')
                  setAttempt((value) => value + 1)
                }}
              >
                Försök igen
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
