import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { App, type SitePreviewSnapshot } from '../../app/App'
import { NativeSiteProvider } from '../../cms/NativeSurface'
import { PreviewPorts } from '../../cms/PreviewPorts'
import { sourceReadSnapshot } from './sourceReadCache'
import { readOnlyHomepagePreviewPorts } from '../views/homepageReplicaPorts'
import { mediaUrl, validatePresentation, type CmsPresentation } from '../../../shared/cms'
import { SUPABASE_URL } from '../../backend/config'
import { CmsSceneContext } from '../../cms/Scene'
import { exampleBookingPorts, exampleCustomerPort, exampleBookingId } from './exampleScenes'

interface SourceContext {
  id: string
  lang: 'sv' | 'en'
  mode: 'light' | 'dark'
  device: 'Desktop' | 'Mobile'
  scene:
    | 'home'
    | 'booking'
    | 'my-bookings'
    | 'booking-options'
    | 'booking-details'
    | 'booking-confirmation'
    | 'my-bookings-list'
  path?: string
  presentation?: CmsPresentation
}

/** Renders public components with read-only ports, never private editor or customer state. */
export function NativeSource({ interactive = false }: { interactive?: boolean }): JSX.Element {
  const [context, setContext] = useState<SourceContext>({
    id: 'initial',
    lang: 'sv',
    mode: 'light',
    device: 'Desktop',
    scene: 'home',
  })
  const snapshot = useMemo(() => sourceReadSnapshot(), [])
  const state = useMemo(() => {
    const status = { pending: 0, metadata: false, failed: false }
    const read = interactive ? readOnlyHomepagePreviewPorts() : { ...snapshot.ports }
    const ports = context.scene.startsWith('booking-') ? exampleBookingPorts(read) : read
    for (const key of Object.keys(ports) as (keyof typeof ports)[]) {
      const target = ports[key]
      Object.assign(ports, {
        [key]: new Proxy(target, {
          get(object, property, receiver) {
            const method: unknown = Reflect.get(object, property, receiver)
            if (typeof method !== 'function') return method
            return (...args: unknown[]) => {
              const result: unknown = Reflect.apply(method, object, args)
              if (!(result instanceof Promise)) return result
              status.pending++
              return result
                .catch((error: unknown) => {
                  status.failed = true
                  throw error
                })
                .finally(() => status.pending--)
            }
          },
        }),
      })
    }
    return { status, ports }
  }, [context.id, interactive, snapshot])
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      const value = data as Record<string, unknown>
      if (
        value['type'] !== 'knc-source-context' ||
        typeof value['id'] !== 'string' ||
        !/^[a-zA-Z0-9-]{1,64}$/.test(value['id']) ||
        !['sv', 'en'].includes(String(value['lang'])) ||
        !['light', 'dark'].includes(String(value['mode'])) ||
        !['Desktop', 'Mobile'].includes(String(value['device'])) ||
        ![
          'home',
          'booking',
          'my-bookings',
          'booking-options',
          'booking-details',
          'booking-confirmation',
          'my-bookings-list',
        ].includes(String(value['scene']))
      )
        return
      if (interactive) {
        try {
          validatePresentation(value['presentation'])
        } catch {
          return
        }
        if (!['/', '/about', '/booking', '/my-bookings'].includes(String(value['path']))) return
      }
      delete document.documentElement.dataset['kncSourceReady']
      delete document.documentElement.dataset['kncBookingReady']
      delete document.documentElement.dataset['kncExampleReady']
      setContext({
        id: value['id'],
        lang: value['lang'] as SourceContext['lang'],
        mode: value['mode'] as SourceContext['mode'],
        device: value['device'] as SourceContext['device'],
        scene: value['scene'] as SourceContext['scene'],
        ...(interactive
          ? { path: String(value['path']), presentation: value['presentation'] as CmsPresentation }
          : {}),
      })
    }
    window.addEventListener('message', receive)
    document.documentElement.dataset['kncSourceListening'] = '1'
    if (interactive)
      window.parent.postMessage({ type: 'knc-preview-listening' }, window.location.origin)
    return () => window.removeEventListener('message', receive)
  }, [interactive])
  useEffect(() => {
    let frame = 0
    let stable = 0
    let stopped = false
    const deadline = performance.now() + 18000
    const settle = (): void => {
      if (stopped) return
      if (state.status.failed || performance.now() > deadline) {
        document.documentElement.dataset['kncSourceFailure'] = JSON.stringify({
          context,
          ...state.status,
          surfaces: [...document.querySelectorAll('[data-knc-surface]')].map((node) =>
            node.getAttribute('data-knc-surface'),
          ),
          fonts: document.fonts.status,
          booking: document.documentElement.dataset['kncBookingReady'],
        })
        document.documentElement.dataset['kncSourceError'] = context.id
        if (interactive)
          window.parent.postMessage(
            { type: 'knc-preview-error', id: context.id },
            window.location.origin,
          )
        return
      }
      const surface =
        context.scene.startsWith('my-bookings') || context.scene.startsWith('booking-')
          ? context.scene
          : `${context.device.toLowerCase()}-${context.scene}`
      const bookingReady =
        context.scene !== 'booking' || document.documentElement.dataset['kncBookingReady'] === '1'
      const ready =
        state.status.metadata &&
        (!context.scene.startsWith('booking-') ||
          document.documentElement.dataset['kncExampleReady'] === context.scene) &&
        state.status.pending === 0 &&
        bookingReady &&
        document.fonts.status === 'loaded' &&
        document.querySelector(`[data-knc-surface="${surface}"]`) !== null
      stable = ready ? stable + 1 : 0
      if (stable >= 3) {
        document.documentElement.dataset['kncSourceReady'] = context.id
        if (interactive)
          window.parent.postMessage(
            { type: 'knc-preview-ready', id: context.id },
            window.location.origin,
          )
        if (interactive && context.path === '/about')
          document.getElementById('om-oss-heading')?.scrollIntoView({ block: 'start' })
        return
      }
      frame = window.setTimeout(settle, 20)
    }
    // WebKit may suspend animation frames in a hidden or offscreen preview.
    // Runtime readiness must not depend on the paint we are waiting to reveal.
    frame = window.setTimeout(settle, 20)
    return () => {
      stopped = true
      window.clearTimeout(frame)
    }
  }, [context, state, interactive])
  const ready = (snapshot: SitePreviewSnapshot): void => {
    if (
      snapshot.lang !== context.lang ||
      snapshot.mode !== context.mode ||
      snapshot.mobile !== (context.device === 'Mobile') ||
      snapshot.view !== (context.scene.startsWith('booking') ? 'booking' : 'home') ||
      snapshot.myBookings !== context.scene.startsWith('my-bookings')
    )
      return
    state.status.metadata = true
    document.documentElement.lang = context.lang
    document.title = snapshot.chrome.business.seo[context.lang].title
  }
  if (interactive && !context.presentation) return <p>Förhandsvisningen laddas…</p>
  const fonts = Object.entries(context.presentation?.fonts ?? {})
    .map(
      ([id, font]) =>
        `@font-face{font-family:"CMSFont-${id}";src:url("${mediaUrl(font.ref, SUPABASE_URL ?? '')}") format("woff2");font-display:swap}`,
    )
    .join('\n')
  return (
    <div
      inert={!interactive}
      onClickCapture={
        interactive
          ? (event) => {
              const target = event.target
              const anchor = target instanceof Element ? target.closest('a') : null
              if (!anchor) return
              // Keep all navigation inside the read-only runtime; never enter the live booking app.
              event.preventDefault()
              const url = new URL(anchor.href, window.location.origin)
              if (url.origin === window.location.origin && url.hash) {
                // The existing privacy link's native callback still runs during bubbling.
                try {
                  document
                    .getElementById(decodeURIComponent(url.hash.slice(1)))
                    ?.scrollIntoView({ block: 'start' })
                } catch {
                  /* Malformed fragment. */
                }
                return
              }
              if (
                url.origin !== window.location.origin ||
                !['/', '/about', '/booking', '/my-bookings'].includes(url.pathname)
              ) {
                if (
                  url.origin === window.location.origin &&
                  context.presentation?.pages.some((page) => page.path === url.pathname)
                )
                  window.parent.postMessage(
                    {
                      type: 'knc-preview-page',
                      path: url.pathname,
                      lang: context.lang,
                      mode: context.mode,
                    },
                    window.location.origin,
                  )
                return
              }
              setContext((current) => ({
                ...current,
                id: crypto.randomUUID(),
                path: url.pathname,
                scene:
                  url.pathname === '/booking'
                    ? 'booking'
                    : url.pathname === '/my-bookings'
                      ? 'my-bookings'
                      : 'home',
              }))
            }
          : undefined
      }
    >
      {interactive && <style>{fonts}</style>}
      <NativeSiteProvider source={!interactive} presentation={context.presentation ?? null}>
        <CmsSceneContext.Provider
          value={{
            ...(context.scene.startsWith('booking-')
              ? { booking: context.scene.slice(8) as 'options' | 'details' | 'confirmation' }
              : {}),
            ...(context.scene === 'my-bookings-list'
              ? { customer: { port: exampleCustomerPort, expandedId: exampleBookingId } }
              : {}),
          }}
        >
          <PreviewPorts.Provider value={state.ports}>
            <App
              key={context.id}
              preview={{
                interactive,
                ...(!interactive ? { chromePort: snapshot.chrome } : {}),
                lang: context.lang,
                mode: context.mode,
                view: context.scene.startsWith('booking') ? 'booking' : 'home',
                myBookings: context.scene.startsWith('my-bookings'),
                onReady: ready,
              }}
            />
          </PreviewPorts.Provider>
        </CmsSceneContext.Provider>
      </NativeSiteProvider>
    </div>
  )
}
