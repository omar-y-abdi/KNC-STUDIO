// Choose the live public gallery or an empty offline gallery; load Supabase lazily.

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
