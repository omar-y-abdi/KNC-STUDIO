// Public gallery loading state. Disabled sections defer I/O; failed requests are distinct from
// a successful empty gallery. Stale responses cannot replace a newer kind or adapter.
import { useEffect, useState } from 'preact/hooks'
import type { GalleryKind, GalleryPhoto, GalleryPort } from './port'
import { defaultGalleryPort } from './index'

interface GalleryState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly photos: readonly GalleryPhoto[]
}

export function useGallery(
  kind: GalleryKind,
  port: GalleryPort = defaultGalleryPort,
  enabled = true,
): GalleryState {
  const [state, setState] = useState<GalleryState>({ status: 'loading', photos: [] })

  useEffect(() => {
    setState({ status: 'loading', photos: [] })
    if (!enabled) return
    let cancelled = false
    void port.list(kind).then(
      (photos) => {
        if (!cancelled) setState({ status: 'ready', photos })
      },
      () => {
        if (!cancelled) setState({ status: 'error', photos: [] })
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled, kind, port])

  return state
}
