// Offline gallery has no published photos.

import type { GalleryPhoto, GalleryPort } from './port'

const EMPTY: readonly GalleryPhoto[] = []

export const mockGalleryAdapter: GalleryPort = {
  // The mock ignores `kind` (no DB photos for either) — implemented with no param, which structurally
  // satisfies `GalleryPort.list(kind)`.
  list(): Promise<readonly GalleryPhoto[]> {
    return Promise.resolve(EMPTY)
  },
}
