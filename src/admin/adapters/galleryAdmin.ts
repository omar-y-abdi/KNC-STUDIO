import { getAdminClient } from '../adminClient'
import {
  galleryRows,
  imageDeleteResponse,
  parseWith,
  uploadGalleryImageResponse,
} from '../adminSchemas'
import type { AdminResult, GalleryImage, GalleryKind } from '../types'
import { err, ok } from '../types'

const BUCKET = 'gallery'
const READ_ERROR = 'Kunde inte läsa galleriet.'
const WRITE_ERROR = 'Kunde inte ladda upp bilden. Försök igen.'
const DELETE_ERROR = 'Kunde inte ta bort bilden. Försök igen.'
const AUTH_ERROR = 'Din session har gått ut. Logga in igen.'
const VALIDATION_ERROR = 'Bilden uppfyller inte kraven.'
const FORBIDDEN_ERROR = 'Endast ägaren kan ladda upp bilder.'

function publicUrl(storagePath: string): string {
  return getAdminClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
}

function toImage(
  row: { id: string; kind: GalleryKind; storage_path: string; alt: string; sort_order: number },
  url = publicUrl(row.storage_path),
): GalleryImage {
  return {
    id: row.id,
    kind: row.kind,
    storagePath: row.storage_path,
    alt: row.alt,
    sortOrder: row.sort_order,
    url,
  }
}

function uploadError<T>(error: unknown): AdminResult<T> {
  const status =
    typeof error === 'object' && error !== null && 'context' in error
      ? (error as { context?: { status?: unknown } }).context?.status
      : undefined
  if (status === 401) return err('auth', AUTH_ERROR)
  if (status === 403) return err('forbidden', FORBIDDEN_ERROR)
  if (status === 400 || status === 413 || status === 422) return err('validation', VALIDATION_ERROR)
  return err('network', WRITE_ERROR)
}

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
    return ok(parsed.value.map((row) => toImage(row)))
  } catch {
    return err('network', READ_ERROR)
  }
}

export async function uploadImage(
  kind: GalleryKind,
  file: File,
  alt: string,
  sortOrder: number,
): Promise<AdminResult<GalleryImage>> {
  const form = new FormData()
  form.set('kind', 'gallery')
  form.set('file', file)
  form.set('galleryKind', kind)
  form.set('alt', alt)
  form.set('sortOrder', String(sortOrder))

  try {
    const { data, error } = await getAdminClient().functions.invoke('upload-image', { body: form })
    if (error !== null) return uploadError(error)

    const parsed = parseWith(uploadGalleryImageResponse, data)
    if (!parsed.ok) return err('malformed', WRITE_ERROR)
    return ok(toImage(parsed.value.row, parsed.value.publicUrl))
  } catch {
    return err('network', WRITE_ERROR)
  }
}

export async function deleteImage(
  image: GalleryImage,
): Promise<AdminResult<{ readonly pending: boolean }>> {
  try {
    const { data, error } = await getAdminClient().functions.invoke('upload-image', {
      body: {
        action: 'delete',
        kind: 'gallery',
        id: image.id,
        storagePath: image.storagePath,
      },
    })
    if (error !== null && data === null) return err('network', DELETE_ERROR)
    const parsed = parseWith(imageDeleteResponse, data)
    if (!parsed.ok) return err('malformed', DELETE_ERROR)
    return ok({ pending: parsed.value.pending })
  } catch {
    return err('network', DELETE_ERROR)
  }
}
