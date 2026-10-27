// The real (Supabase) GalleryPort adapter. `list` reads `gallery_images` for a kind (anon may select
// all — the public-select RLS policy), ordered by `sort_order`, and resolves each row's
// `storage_path` to a public URL via `publicObjectUrl` (no network, a
// pure string build, the SAME path the admin uploader produced). A malformed row is DROPPED; a
// transport error rejects so the About section can distinguish unavailable data from an empty gallery.
//
// Boundary discipline: every row is Zod-parsed (kind guarded into salon|cuts), never trusted raw.

import { publicObjectUrl } from '../../backend/publicApi'
import { getPublicRest } from '../../backend/publicRest'
import { galleryImageRow, parseWith } from '../../backend/rpcSchemas'
import type { GalleryImageRow } from '../../backend/rpcSchemas'
import type { GalleryKind, GalleryPhoto, GalleryPort } from './port'

const BUCKET = 'gallery'

/** Map a parsed raw `gallery_images` row + resolved URL into a public gallery photo. */
function toPhoto(r: GalleryImageRow): GalleryPhoto {
  return { id: r.id, url: publicObjectUrl(BUCKET, r.storage_path), alt: r.alt }
}

export const supabaseGalleryAdapter: GalleryPort = {
  async list(kind: GalleryKind): Promise<readonly GalleryPhoto[]> {
    const { data, error } = await getPublicRest()
      .from('gallery_images')
      .select('id,kind,storage_path,alt,sort_order')
      .eq('kind', kind)
      .order('sort_order', { ascending: true })
    if (error !== null || data === null) throw new Error('Gallery unavailable')

    const photos: GalleryPhoto[] = []
    for (const raw of data) {
      const parsed = parseWith(galleryImageRow, raw)
      if (parsed.ok) photos.push(toPhoto(parsed.value))
    }
    return photos
  },
}
