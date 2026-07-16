// Barber-photo admin adapter (Task 2 §3). The owner may set any barber's photo; a barber only their
// own — enforced by RLS on both `barber_photos` and the `barber-photos` Storage bucket (the UI only
// ever passes the acting barber's id). Mirrors galleryAdmin's upload discipline.
//
// Path convention `<barber_id>/<uuid>.<ext>` — the folder IS the barber id, which the Storage policy
// matches against current_barber_id() for a barber session. Replacing a photo uploads the new object,
// upserts the row, then best-effort removes the OLD object so a barber keeps a single photo.
//
// Boundary discipline: rows Zod-parsed; failure -> AdminError; never throws to the UI.

import { getAdminClient } from '../adminClient'
import { barberPhotoRowT, parseWith } from '../adminSchemas'
import type { AdminBarberId, AdminResult } from '../types'
import { err, ok } from '../types'

const BUCKET = 'barber-photos'
const READ_ERROR = 'Kunde inte läsa profilbilden.'
const WRITE_ERROR = 'Kunde inte ladda upp bilden. Försök igen.'
const DELETE_ERROR = 'Kunde inte ta bort bilden. Försök igen.'
const FORBIDDEN = 'Du har inte behörighet för detta.'

/** A short, safe file extension (`photo.JPG` -> `jpg`); defaults to `jpg`. */
function safeExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return 'jpg'
  const cleaned = fileName
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return cleaned.length === 0 ? 'jpg' : cleaned.slice(0, 5)
}

function publicUrl(storagePath: string): string {
  return getAdminClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
}

/** The current photo for a barber: its storage path + resolved public URL, or `null` if none. */
export async function getBarberPhoto(
  barberId: AdminBarberId,
): Promise<AdminResult<{ storagePath: string; url: string } | null>> {
  try {
    const { data, error } = await getAdminClient()
      .from('barber_photos')
      .select('barber_id,storage_path')
      .eq('barber_id', barberId)
      .maybeSingle()
    if (error !== null) return err('network', READ_ERROR)
    if (data === null) return ok(null)
    const parsed = parseWith(barberPhotoRowT, data)
    if (!parsed.ok) return err('malformed', READ_ERROR)
    return ok({ storagePath: parsed.value.storage_path, url: publicUrl(parsed.value.storage_path) })
  } catch {
    return err('network', READ_ERROR)
  }
}

/** Upload a new photo for a barber and upsert its row; removes the previous object if any. */
export async function uploadBarberPhoto(
  barberId: AdminBarberId,
  file: File,
  previousPath: string | null,
): Promise<AdminResult<{ storagePath: string; url: string }>> {
  const supabase = getAdminClient()
  const path = `${barberId}/${crypto.randomUUID()}.${safeExt(file.name)}`
  try {
    const up = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type === '' ? 'application/octet-stream' : file.type,
      upsert: false,
    })
    if (up.error !== null) return err('forbidden', FORBIDDEN)

    const { error } = await supabase
      .from('barber_photos')
      .upsert({ barber_id: barberId, storage_path: path }, { onConflict: 'barber_id' })
    if (error !== null) {
      await supabase.storage.from(BUCKET).remove([path])
      if (error.code === '42501') return err('forbidden', FORBIDDEN)
      return err('network', WRITE_ERROR)
    }

    // Best-effort remove the old object so a barber keeps just one photo.
    if (previousPath !== null && previousPath !== path) {
      await supabase.storage.from(BUCKET).remove([previousPath])
    }
    return ok({ storagePath: path, url: publicUrl(path) })
  } catch {
    return err('network', WRITE_ERROR)
  }
}

/** Remove a barber's photo (row first, then the Storage object). */
export async function removeBarberPhoto(
  barberId: AdminBarberId,
  storagePath: string,
): Promise<AdminResult<true>> {
  const supabase = getAdminClient()
  try {
    const { error } = await supabase.from('barber_photos').delete().eq('barber_id', barberId)
    if (error !== null) {
      if (error.code === '42501') return err('forbidden', FORBIDDEN)
      return err('network', DELETE_ERROR)
    }
    await supabase.storage.from(BUCKET).remove([storagePath])
    return ok(true)
  } catch {
    return err('network', DELETE_ERROR)
  }
}
