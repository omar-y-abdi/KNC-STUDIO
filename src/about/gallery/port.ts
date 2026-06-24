// The "backend-ready" seam for the public PHOTO GALLERY. A `GalleryPort` lists the Storage-backed
// images for a kind (salon | cuts) with their resolved public URLs. The About section's
// `GalleryMarquee` renders real `<img>` tiles from these when present; with none (or no backend) it
// falls back to the existing placeholder tiles. The mock returns EMPTY lists (placeholders), so the
// section is byte-identical to today.

/** Which gallery a set of images belongs to. */
export type GalleryKind = 'salon' | 'cuts'

/** One public gallery photo: a stable id, its resolved public Storage URL, and alt text. */
export interface GalleryPhoto {
  readonly id: string
  /** Public Storage URL (`${SUPABASE_URL}/storage/v1/object/public/gallery/<path>`). */
  readonly url: string
  readonly alt: string
}

export interface GalleryPort {
  /**
   * The images for `kind`, in display order. Resolves to an EMPTY list under the mock (the About
   * section then renders placeholder tiles); reads `gallery_images` (by `sort_order`) under Supabase.
   */
  list(kind: GalleryKind): Promise<readonly GalleryPhoto[]>
}
