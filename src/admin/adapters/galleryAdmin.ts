// Gallery admin adapter (owner-only writes). The public `gallery` Storage bucket holds salon/cuts
// photos; rows in `gallery_images` index them. The owner UPLOADS (Storage write + row insert) and
// DELETES (row delete + Storage object remove). Storage write/delete is owner-only (the bucket
// policies check is_owner()); anyone may read (public bucket) — so previews build public URLs.
//
// Upload path convention (ADMIN_SPEC §1.6): `<kind>/<uuid>.<ext>`. We generate the uuid client-side
// (crypto.randomUUID) and derive the extension from the file name (sanitized to a short alnum token).
//
// Ordering: on a failed row insert AFTER a successful upload we best-effort remove the orphaned
// object so a half-write doesn't leave a dangling file; on delete we remove the row first, then the
// object (a leftover row is worse than a leftover object — the row drives the public list).
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { galleryRow, galleryRows, parseWith } from '../adminSchemas'
import type { AdminResult, GalleryImage, GalleryKind } from '../types'
import { err, ok } from '../types'

const BUCKET = 'gallery'
const READ_ERROR = 'Kunde inte läsa galleriet.'
const WRITE_ERROR = 'Kunde inte ladda upp bilden. Försök igen.'
const DELETE_ERROR = 'Kunde inte ta bort bilden. Försök igen.'

/** Resolve a storage path to its public URL via the SDK (no network; pure string build). */
function publicUrl(storagePath: string): string {
  return getAdminClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
}

/** Map a parsed raw gallery row + resolved URL into the domain type. */
function toImage(r: {
  id: string
  kind: GalleryKind
  storage_path: string
  alt: string
  sort_order: number
}): GalleryImage {
  return {
    id: r.id,
    kind: r.kind,
    storagePath: r.storage_path,
    alt: r.alt,
    sortOrder: r.sort_order,
    url: publicUrl(r.storage_path),
  }
}

/** A short, safe file extension from a file name (`photo.JPG` -> `jpg`); defaults to `jpg`. */
function safeExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return 'jpg'
  const raw = fileName.slice(dot + 1).toLowerCase()
  const cleaned = raw.replace(/[^a-z0-9]/g, '')
  return cleaned.length === 0 ? 'jpg' : cleaned.slice(0, 5)
}

/** List gallery rows for a kind, ordered by sort_order (with resolved public URLs). */
export async function listGallery(
  kind: GalleryKind,
): Promise<AdminResult<readonly GalleryImage[]>> {
  try {
    const { data, error } = await getAdminClient()
      .from('gallery_images')
      .select('id,kind,storage_path,alt,sort_order')
      .eq('kind', kind)
      .order('sort_order', { ascending: true })
    if (error !== null || data === null) return err('network', READ_ERROR)

    const parsed = parseWith(galleryRows, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok(parsed.value.map(toImage))
  } catch {
    return err('network', READ_ERROR)
  }
}

/**
 * Upload a file to Storage (owner-only) then insert its row. On a row-insert failure after the upload
 * succeeded, the orphaned object is best-effort removed. Returns the new image row.
 */
export async function uploadImage(
  kind: GalleryKind,
  file: File,
  alt: string,
  sortOrder: number,
): Promise<AdminResult<GalleryImage>> {
  const supabase = getAdminClient()
  const path = `${kind}/${crypto.randomUUID()}.${safeExt(file.name)}`

  try {
    const up = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type === '' ? 'application/octet-stream' : file.type,
      upsert: false,
    })
    if (up.error !== null) {
      // Storage RLS denial surfaces as a 403 on the upload.
      return err('forbidden', 'Endast ägaren kan ladda upp bilder.')
    }

    const { data, error } = await supabase
      .from('gallery_images')
      .insert({ kind, storage_path: path, alt, sort_order: sortOrder })
      .select('id,kind,storage_path,alt,sort_order')
      .single()
    if (error !== null || data === null) {
      // Roll back the just-uploaded object so we don't leave an orphan.
      await supabase.storage.from(BUCKET).remove([path])
      if (error?.code === '42501') return err('forbidden', 'Endast ägaren kan ladda upp bilder.')
      return err('network', WRITE_ERROR)
    }

    const parsed = parseWith(galleryRow, data)
    if (!parsed.ok) {
      await supabase.storage.from(BUCKET).remove([path])
      return err('malformed', WRITE_ERROR)
    }
    return ok(toImage(parsed.value))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Delete an image: remove the row first (drives the public list), then the Storage object. */
export async function deleteImage(image: GalleryImage): Promise<AdminResult<true>> {
  const supabase = getAdminClient()
  try {
    const { error } = await supabase.from('gallery_images').delete().eq('id', image.id)
    if (error !== null) {
      if (error.code === '42501') return err('forbidden', 'Endast ägaren kan ta bort bilder.')
      return err('network', DELETE_ERROR)
    }
    // Object removal is owner-gated too; a failure here only leaves an unreferenced file.
    await supabase.storage.from(BUCKET).remove([image.storagePath])
    return ok(true)
  } catch {
    return err('network', DELETE_ERROR)
  }
}
