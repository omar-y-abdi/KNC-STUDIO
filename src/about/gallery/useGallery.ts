// `useGallery` — the public gallery for one kind as React state, with a graceful, layout-shift-free
// load. Under the MOCK (no backend) the initial (and only) value is an EMPTY list, so the About
// section renders placeholder tiles immediately — byte-identical to today, no fetch, no flash. Under
// a BACKEND it starts empty (placeholders) and fills in once `list(kind)` resolves; because the real
// tiles share the placeholder's wrapper + sizing, the swap causes no layout shift. The effect is
// race-guarded (a stale response is dropped).

import { useEffect, useState } from 'preact/hooks'
import type { GalleryKind, GalleryPhoto, GalleryPort } from './port'
import { defaultGalleryPort, galleryIsMock } from './index'

/**
 * Subscribe to the gallery for `kind`. `port` defaults to the env-selected `defaultGalleryPort`.
 * Returns the photos (empty under the mock → placeholders) — the About section decides real-vs-tile.
 */
export function useGallery(
  kind: GalleryKind,
  port: GalleryPort = defaultGalleryPort,
): readonly GalleryPhoto[] {
  const [photos, setPhotos] = useState<readonly GalleryPhoto[]>([])

  useEffect(() => {
    // Mock: there are no DB photos; keep placeholders (never fetch).
    if (galleryIsMock) return
    let cancelled = false
    void port
      .list(kind)
      .then((rows) => {
        if (cancelled) return
        setPhotos(rows)
      })
      .catch(() => {
        if (cancelled) return
        setPhotos([])
      })
    return () => {
      cancelled = true
    }
  }, [kind, port])

  return photos
}
