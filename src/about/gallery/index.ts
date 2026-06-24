// The gallery swap point. Supabase when configured, the offline mock (empty lists → placeholder
// tiles) otherwise — chosen ONCE at module load. With no `VITE_SUPABASE_*` the gallery is
// byte-identical to today (placeholders) and resolves immediately. The Supabase adapter is reached
// through a LAZY proxy (dynamic import on first call) so supabase-js stays out of the public path.

import { isBackendConfigured } from '../../backend/config'
import type { GalleryKind, GalleryPhoto, GalleryPort } from './port'
import { mockGalleryAdapter } from './mockGallery'

const lazySupabaseGalleryPort: GalleryPort = {
  list: (kind: GalleryKind): Promise<readonly GalleryPhoto[]> =>
    import('./supabaseGallery').then((m) => m.supabaseGalleryAdapter.list(kind)),
}

export const defaultGalleryPort: GalleryPort = isBackendConfigured()
  ? lazySupabaseGalleryPort
  : mockGalleryAdapter

/** True when the gallery comes from the offline mock (i.e. no backend) — render placeholders. */
export const galleryIsMock = !isBackendConfigured()
