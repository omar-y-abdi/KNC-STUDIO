import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { App, type SitePreviewSnapshot } from '../../app/App'
import { NativeSiteProvider } from '../../cms/NativeSurface'
import { PreviewPorts } from '../../cms/PreviewPorts'
import { readOnlyHomepagePreviewPorts } from '../views/homepageReplicaPorts'

interface SourceContext {
  id: string
  lang: 'sv' | 'en'
  mode: 'light' | 'dark'
  device: 'Desktop' | 'Mobile'
  scene: 'home' | 'booking' | 'my-bookings'
}

/** Renders public components with read-only ports, never private editor or customer state. */
export function NativeSource(): JSX.Element {
  const [context, setContext] = useState<SourceContext>({
    id: 'initial',
    lang: 'sv',
    mode: 'light',
    device: 'Desktop',
    scene: 'home',
  })
  const state = useMemo(() => {
    const status = { pending: 0, metadata: false, failed: false }
    const ports = readOnlyHomepagePreviewPorts()
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
  }, [])
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
        !['home', 'booking', 'my-bookings'].includes(String(value['scene']))
      )
        return
      delete document.documentElement.dataset['kncSourceReady']
      delete document.documentElement.dataset['kncBookingReady']
      state.status.metadata = false
      setContext({
        id: value['id'],
        lang: value['lang'] as SourceContext['lang'],
        mode: value['mode'] as SourceContext['mode'],
        device: value['device'] as SourceContext['device'],
        scene: value['scene'] as SourceContext['scene'],
      })
    }
    window.addEventListener('message', receive)
    document.documentElement.dataset['kncSourceListening'] = '1'
    return () => window.removeEventListener('message', receive)
  }, [state])
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
        return
      }
      const surface =
        context.scene === 'my-bookings'
          ? 'my-bookings'
          : `${context.device.toLowerCase()}-${context.scene}`
      const bookingReady =
        context.scene !== 'booking' || document.documentElement.dataset['kncBookingReady'] === '1'
      const ready =
        state.status.metadata &&
        state.status.pending === 0 &&
        bookingReady &&
        document.fonts.status === 'loaded' &&
        document.querySelector(`[data-knc-surface="${surface}"]`) !== null
      stable = ready ? stable + 1 : 0
      if (stable >= 3) {
        document.documentElement.dataset['kncSourceReady'] = context.id
        return
      }
      frame = requestAnimationFrame(settle)
    }
    frame = requestAnimationFrame(settle)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [context, state])
  const ready = (snapshot: SitePreviewSnapshot): void => {
    if (
      snapshot.lang !== context.lang ||
      snapshot.mode !== context.mode ||
      snapshot.mobile !== (context.device === 'Mobile') ||
      snapshot.view !== (context.scene === 'booking' ? 'booking' : 'home') ||
      snapshot.myBookings !== (context.scene === 'my-bookings')
    )
      return
    state.status.metadata = true
    document.documentElement.lang = context.lang
    document.title = snapshot.chrome.business.seo[context.lang].title
  }
  return (
    <div inert>
      <NativeSiteProvider source>
        <PreviewPorts.Provider value={state.ports}>
          <App
            preview={{
              lang: context.lang,
              mode: context.mode,
              view: context.scene === 'booking' ? 'booking' : 'home',
              myBookings: context.scene === 'my-bookings',
              onReady: ready,
            }}
          />
        </PreviewPorts.Provider>
      </NativeSiteProvider>
    </div>
  )
}
