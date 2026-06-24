// The offline (mock) GalleryPort: returns an EMPTY list for either kind, so the About section keeps
// its existing placeholder tiles (PlaceholderPhoto) — byte-identical to today. Resolves
// synchronously-wrapped so the gallery paints immediately (no flash, no layout shift).

import type { GalleryPhoto, GalleryPort } from './port'

const EMPTY: readonly GalleryPhoto[] = []

export const mockGalleryAdapter: GalleryPort = {
  // The mock ignores `kind` (no DB photos for either) — implemented with no param, which structurally
  // satisfies `GalleryPort.list(kind)`.
  list(): Promise<readonly GalleryPhoto[]> {
    return Promise.resolve(EMPTY)
  },
}
