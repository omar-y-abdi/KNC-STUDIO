// Public gallery photos, loaded from Storage-backed metadata or an empty offline catalog.

/** Which gallery a set of images belongs to. */
export type GalleryKind = 'salon' | 'cuts'

/** A social handle a photo is credited to. */
export interface GalleryCredit {
  readonly platform: 'instagram' | 'tiktok'
  readonly handle: string
}

/** One public gallery photo: a stable id, its resolved public Storage URL, and alt text. */
export interface GalleryPhoto {
  readonly id: string
  /** Public Storage URL (`${SUPABASE_URL}/storage/v1/object/public/<bucket>/<path>`). */
  readonly url: string
  readonly alt: string
  /** Shown under the photo while it is selected. */
  readonly credit?: GalleryCredit
}

export interface GalleryPort {
  /** Images for `kind` in display order; empty means none published, rejection means unavailable. */
  list(kind: GalleryKind): Promise<readonly GalleryPhoto[]>
}
